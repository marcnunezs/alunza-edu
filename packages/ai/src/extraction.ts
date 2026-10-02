import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { watchWindowsResidentBytes } from './resident-monitor';
import {
  EXTRACTION_VERSION,
  MATERIAL_INGESTION_LIMITS,
  MaterialIngestionError,
} from './ingestion';
import type {
  ExtractedMaterial,
  MaterialFormat,
  MaterialIngestionErrorCode,
  ChunkedMaterial,
} from './ingestion';

const resultSchema = z.strictObject({
  ok: z.literal(true),
  material: z.strictObject({
    segments: z
      .array(
        z.strictObject({
          text: z.string(),
          locator: z.string().min(1).max(200),
        }),
      )
      .min(1)
      .max(1000),
    extractionVersion: z.literal(EXTRACTION_VERSION),
    normalizedTextBytes: z
      .number()
      .int()
      .min(1)
      .max(MATERIAL_INGESTION_LIMITS.maxExtractedBytes),
  }),
});
const chunksResultSchema = z.strictObject({
  ok: z.literal(true),
  material: z.strictObject({
    chunks: z
      .array(
        z.strictObject({
          index: z.number().int().min(0),
          text: z.string().min(1),
          tokenCount: z
            .number()
            .int()
            .min(1)
            .max(MATERIAL_INGESTION_LIMITS.chunkTokens),
          locator: z.string().min(1).max(200),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
        }),
      )
      .min(1),
    extractionVersion: z.literal(EXTRACTION_VERSION),
    normalizedTextBytes: z
      .number()
      .int()
      .min(1)
      .max(MATERIAL_INGESTION_LIMITS.maxExtractedBytes),
  }),
});
const safeCodes = new Set<MaterialIngestionErrorCode>([
  'UNSUPPORTED_FORMAT',
  'FILE_TOO_LARGE',
  'INVALID_TEXT',
  'INVALID_PDF',
  'ENCRYPTED_PDF',
  'NO_TEXT',
  'EXTRACTION_LIMIT',
]);
function parserEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
  };
}
async function residentBytes(pid: number): Promise<number> {
  if (process.platform === 'linux') {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const value = /VmRSS:\s+(\d+)\s+kB/u.exec(status);
    if (!value) throw new Error('Process unavailable');
    return Number(value[1]) * 1024;
  }
  throw new Error('Unsupported memory monitor');
}
export class MaterialExtractor {
  private readonly scriptPath: string;
  private readonly timeoutMs: number;
  private readonly maxRssBytes: number;
  constructor(
    options: {
      scriptPath?: string;
      timeoutMs?: number;
      maxRssBytes?: number;
    } = {},
  ) {
    this.scriptPath =
      options.scriptPath ??
      resolve(__dirname, '../../../infra/materials/extractor.mjs');
    this.timeoutMs = options.timeoutMs ?? MATERIAL_INGESTION_LIMITS.timeoutMs;
    this.maxRssBytes =
      options.maxRssBytes ?? MATERIAL_INGESTION_LIMITS.maxRssBytes;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > MATERIAL_INGESTION_LIMITS.timeoutMs ||
      !Number.isInteger(this.maxRssBytes) ||
      this.maxRssBytes < 1 ||
      this.maxRssBytes > MATERIAL_INGESTION_LIMITS.maxRssBytes
    )
      throw new MaterialIngestionError('INVALID_CONFIGURATION');
  }
  async extract(
    bytes: Uint8Array,
    format: MaterialFormat,
    signal?: AbortSignal,
  ): Promise<ExtractedMaterial> {
    return this.run(bytes, format, signal, false) as Promise<ExtractedMaterial>;
  }
  async extractAndChunk(
    bytes: Uint8Array,
    format: MaterialFormat,
    signal?: AbortSignal,
  ): Promise<ChunkedMaterial> {
    return this.run(bytes, format, signal, true) as Promise<ChunkedMaterial>;
  }
  private async run(
    bytes: Uint8Array,
    format: MaterialFormat,
    signal: AbortSignal | undefined,
    chunked: boolean,
  ): Promise<ExtractedMaterial | ChunkedMaterial> {
    if (!['PDF', 'TXT', 'MARKDOWN'].includes(format))
      throw new MaterialIngestionError('UNSUPPORTED_FORMAT');
    if (bytes.length > MATERIAL_INGESTION_LIMITS.maxFileBytes)
      throw new MaterialIngestionError('FILE_TOO_LARGE');
    if (!bytes.length) throw new MaterialIngestionError('NO_TEXT');
    if (signal?.aborted) throw new MaterialIngestionError('CANCELLED');
    return new Promise((accept, reject) => {
      const child = spawn(
        process.execPath,
        [
          `--max-old-space-size=${MATERIAL_INGESTION_LIMITS.maxHeapMiB}`,
          this.scriptPath,
          format,
          ...(chunked ? ['chunks'] : []),
        ],
        {
          windowsHide: true,
          env: parserEnvironment(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const blocks: Buffer[] = [];
      let outputSize = 0,
        stderrSize = 0,
        done = false,
        checking = false,
        heapExhausted = false;
      let failure: MaterialIngestionError | undefined;
      const stop = (error: MaterialIngestionError) => {
        if (!failure) failure = error;
        child.kill('SIGKILL');
      };
      const cancel = () => stop(new MaterialIngestionError('CANCELLED'));
      signal?.addEventListener('abort', cancel, { once: true });
      const deadline = setTimeout(
        () => stop(new MaterialIngestionError('EXTRACTION_TIMEOUT')),
        this.timeoutMs,
      );
      const sample = (rss: number) => {
        if (!done && rss > this.maxRssBytes)
          stop(new MaterialIngestionError('EXTRACTION_LIMIT'));
      };
      const unavailable = () => {
        if (!done && child.exitCode === null && child.signalCode === null)
          stop(new MaterialIngestionError('EXTRACTION_UNAVAILABLE', true));
      };
      const check = () => {
        if (checking || done || !child.pid) return;
        checking = true;
        void residentBytes(child.pid)
          .then(sample, unavailable)
          .finally(() => {
            checking = false;
          });
      };
      const monitor =
        process.platform !== 'win32' ? setInterval(check, 500) : undefined;
      let closeWindowsMonitor: (() => void) | undefined;
      // Preserve the existing first sampling point. Tiny text parsers often
      // finish before it, so they should not start an unnecessary CLR process.
      const firstWindowsSample =
        process.platform === 'win32'
          ? setTimeout(() => {
              if (done || !child.pid) return;
              closeWindowsMonitor = watchWindowsResidentBytes(
                child.pid,
                parserEnvironment(),
                sample,
                unavailable,
              );
            }, 500)
          : undefined;
      const closeMonitor = () => {
        clearInterval(monitor);
        clearTimeout(firstWindowsSample);
        closeWindowsMonitor?.();
      };
      child.stdout.on('data', (part: Buffer) => {
        outputSize += part.length;
        if (outputSize > MATERIAL_INGESTION_LIMITS.maxOutputBytes)
          stop(new MaterialIngestionError('EXTRACTION_LIMIT'));
        else blocks.push(part);
      });
      child.stderr.on('data', (part: Buffer) => {
        stderrSize += part.length;
        heapExhausted ||= part.includes(Buffer.from('heap out of memory'));
        if (stderrSize > 65536)
          stop(new MaterialIngestionError('EXTRACTION_LIMIT'));
      });
      child.stdin.on('error', () => undefined);
      child.once('error', () => {
        failure ??= new MaterialIngestionError('EXTRACTION_UNAVAILABLE', true);
      });
      child.once('close', (code, termination) => {
        done = true;
        clearTimeout(deadline);
        closeMonitor();
        signal?.removeEventListener('abort', cancel);
        if (failure) {
          reject(failure);
          return;
        }
        if (termination || heapExhausted) {
          reject(new MaterialIngestionError('EXTRACTION_LIMIT'));
          return;
        }
        if (code !== 0 && outputSize === 0) {
          reject(new MaterialIngestionError('EXTRACTION_UNAVAILABLE', true));
          return;
        }
        try {
          const raw = JSON.parse(Buffer.concat(blocks).toString('utf8')) as {
            ok?: boolean;
            code?: MaterialIngestionErrorCode;
          };
          if (raw.ok === false && raw.code && safeCodes.has(raw.code))
            throw new MaterialIngestionError(raw.code);
          if (chunked) {
            const result = chunksResultSchema.safeParse(raw);
            if (code !== 0 || !result.success)
              throw new MaterialIngestionError('INVALID_TEXT');
            if (
              result.data.material.chunks.some(
                (chunk, index) =>
                  chunk.index !== index ||
                  !chunk.text.trim() ||
                  createHash('sha256')
                    .update(chunk.text, 'utf8')
                    .digest('hex') !== chunk.contentHash,
              )
            )
              throw new MaterialIngestionError('INVALID_TEXT');
            accept(result.data.material);
            return;
          }
          const parsed = resultSchema.safeParse(raw);
          if (code !== 0 || !parsed.success)
            throw new MaterialIngestionError('INVALID_PDF');
          const material = parsed.data.material;
          const actual = Buffer.byteLength(
            material.segments.map((segment) => segment.text).join('\n'),
            'utf8',
          );
          if (
            actual !== material.normalizedTextBytes ||
            actual > MATERIAL_INGESTION_LIMITS.maxExtractedBytes
          )
            throw new MaterialIngestionError('EXTRACTION_LIMIT');
          accept(material);
        } catch (error) {
          reject(
            error instanceof MaterialIngestionError
              ? error
              : new MaterialIngestionError('INVALID_PDF'),
          );
        }
      });
      child.stdin.end(bytes);
    });
  }
}
