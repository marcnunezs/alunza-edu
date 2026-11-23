import { createHash } from 'node:crypto';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100kBase from 'js-tiktoken/ranks/cl100k_base';

export const MATERIAL_INGESTION_LIMITS = Object.freeze({
  maxFileBytes: 10_000_000,
  maxPages: 1000,
  maxExtractedBytes: 20 * 1024 * 1024,
  maxOutputBytes: 100 * 1024 * 1024,
  timeoutMs: 30_000,
  maxRssBytes: 512 * 1024 * 1024,
  maxHeapMiB: 256,
  chunkTokens: 500,
  overlapTokens: 50,
  embeddingBatchSize: 32,
});
export const EXTRACTION_VERSION = 'pdfjs-6.3.289-text-1';
export const TOKENIZER_VERSION = 'js-tiktoken-1.0.21-cl100k_base';
export type MaterialFormat = 'PDF' | 'TXT' | 'MARKDOWN';
export type MaterialIngestionErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'INVALID_TEXT'
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'NO_TEXT'
  | 'EXTRACTION_LIMIT'
  | 'EXTRACTION_TIMEOUT'
  | 'EXTRACTION_UNAVAILABLE'
  | 'CANCELLED'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_EMBEDDING'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REJECTED';
export class MaterialIngestionError extends Error {
  constructor(
    readonly code: MaterialIngestionErrorCode,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'MaterialIngestionError';
  }
}
export interface ExtractedMaterial {
  segments: { text: string; locator: string }[];
  extractionVersion: string;
  normalizedTextBytes: number;
}
export interface MaterialChunk {
  index: number;
  text: string;
  tokenCount: number;
  locator: string;
  contentHash: string;
}
export interface ChunkedMaterial {
  chunks: MaterialChunk[];
  extractionVersion: string;
  normalizedTextBytes: number;
}
let tokenizer: Tiktoken | undefined;
function encoder(): Tiktoken {
  return (tokenizer ??= new Tiktoken(cl100kBase));
}
export function materialTokenCount(text: string): number {
  // Special-token spellings inside documents are ordinary untrusted text.
  return encoder().encode(text, [], []).length;
}
export function detectMaterialFormat(
  bytes: Uint8Array,
  name: string,
): MaterialFormat {
  if (!bytes.length) throw new MaterialIngestionError('NO_TEXT');
  if (bytes.length > MATERIAL_INGESTION_LIMITS.maxFileBytes)
    throw new MaterialIngestionError('FILE_TOO_LARGE');
  const extension = name.split('.').at(-1)?.toLowerCase();
  const pdf = Buffer.from(bytes.subarray(0, 1024)).includes(
    Buffer.from('%PDF-'),
  );
  if (extension === 'pdf' && pdf) return 'PDF';
  if (pdf || !['txt', 'md', 'markdown'].includes(extension ?? ''))
    throw new MaterialIngestionError('UNSUPPORTED_FORMAT');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13)
        throw new Error('binary');
    }
    if (!text.trim()) throw new MaterialIngestionError('NO_TEXT');
  } catch (error) {
    if (error instanceof MaterialIngestionError) throw error;
    throw new MaterialIngestionError('INVALID_TEXT');
  }
  return extension === 'txt' ? 'TXT' : 'MARKDOWN';
}

/** Token windows preserve original Unicode. Overlap is adjusted only when its
 * boundary would split a UTF-8 character; no replacement character is invented. */
export function chunkMaterial(material: ExtractedMaterial): MaterialChunk[] {
  const text = material.segments.map((segment) => segment.text).join('\n');
  if (!text.trim()) throw new MaterialIngestionError('NO_TEXT');
  if (
    Buffer.byteLength(text, 'utf8') >
    MATERIAL_INGESTION_LIMITS.maxExtractedBytes
  )
    throw new MaterialIngestionError('EXTRACTION_LIMIT');
  const tokens = encoder().encode(text, [], []);
  const spans: { start: number; end: number; locator: string }[] = [];
  let offset = 0;
  for (const segment of material.segments) {
    spans.push({
      start: offset,
      end: offset + segment.text.length,
      locator: segment.locator,
    });
    offset += segment.text.length + 1;
  }
  const chunks: MaterialChunk[] = [];
  let start = 0;
  let textOffset = 0;
  let firstLine = 1;
  while (start < tokens.length) {
    let end = Math.min(
      start + MATERIAL_INGESTION_LIMITS.chunkTokens,
      tokens.length,
    );
    let chunkText = encoder().decode(tokens.slice(start, end));
    while (
      end > start &&
      (!text.startsWith(chunkText, textOffset) ||
        materialTokenCount(chunkText) > MATERIAL_INGESTION_LIMITS.chunkTokens)
    ) {
      end--;
      chunkText = encoder().decode(tokens.slice(start, end));
    }
    if (end <= start) throw new MaterialIngestionError('INVALID_TEXT');
    const locators = spans
      .filter(
        (span) =>
          span.start < textOffset + chunkText.length && span.end > textOffset,
      )
      .map((span) => span.locator);
    let locator = [...new Set(locators)].join('; ');
    if (
      locators.length > 1 &&
      locators.every((value) => /^Página \d+$/u.test(value))
    )
      locator = `Páginas ${locators[0]!.slice(7)}–${locators.at(-1)!.slice(7)}`;
    if (material.segments.length === 1 && /^Líneas 1[–-]\d+$/u.test(locator)) {
      const last = firstLine + (chunkText.match(/\n/gu)?.length ?? 0);
      locator = `Líneas ${firstLine}–${last}`;
    }
    if (chunkText.trim())
      chunks.push({
        index: chunks.length,
        text: chunkText,
        tokenCount: materialTokenCount(chunkText),
        locator,
        contentHash: createHash('sha256')
          .update(chunkText, 'utf8')
          .digest('hex'),
      });
    if (end === tokens.length) break;
    let next = Math.max(
      start + 1,
      end - MATERIAL_INGESTION_LIMITS.overlapTokens,
    );
    let advance = encoder().decode(tokens.slice(start, next));
    while (next > start + 1 && !chunkText.startsWith(advance)) {
      next--;
      advance = encoder().decode(tokens.slice(start, next));
    }
    if (!chunkText.startsWith(advance))
      throw new MaterialIngestionError('INVALID_TEXT');
    firstLine += advance.match(/\n/gu)?.length ?? 0;
    textOffset += advance.length;
    start = next;
  }
  if (!chunks.length) throw new MaterialIngestionError('NO_TEXT');
  return chunks;
}
