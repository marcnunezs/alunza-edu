// Private parser protocol. This program receives bytes, never URLs or credentials.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
const require = createRequire(
  new URL('../../packages/ai/package.json', import.meta.url),
);
const MAX_FILE = 10_000_000,
  MAX_TEXT = 20 * 1024 * 1024,
  MAX_PAGES = 1000;
const version = 'pdfjs-6.3.289-text-1';
// No parser diagnostics or document fragments are written to general logs.
console.log = console.warn = console.error = () => {};
globalThis.fetch = async () => {
  throw new Error('EXTERNAL_RESOURCE_DENIED');
};
function fail(code) {
  throw Object.assign(new Error(code), { safeCode: code });
}
function normalize(text) {
  return text
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/\p{Cc}/gu, (character) => (character === '\n' ? '\n' : ' '))
    .replace(/[\t\u00a0 ]+/gu, ' ');
}
try {
  const format = process.argv[2];
  if (!['PDF', 'TXT', 'MARKDOWN'].includes(format)) fail('UNSUPPORTED_FORMAT');
  let size = 0;
  const blocks = [];
  for await (const block of process.stdin) {
    size += block.length;
    if (size > MAX_FILE) fail('FILE_TOO_LARGE');
    blocks.push(block);
  }
  if (!size) fail('NO_TEXT');
  const bytes = new Uint8Array(Buffer.concat(blocks));
  const segments = [];
  let normalizedTextBytes = 0;
  function append(text, locator) {
    text = normalize(text);
    normalizedTextBytes +=
      Buffer.byteLength(text, 'utf8') + (segments.length ? 1 : 0);
    if (normalizedTextBytes > MAX_TEXT) fail('EXTRACTION_LIMIT');
    segments.push({ text, locator });
  }
  if (format === 'PDF') {
    if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-')))
      fail('INVALID_PDF');
    const modulePath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const assets = dirname(require.resolve('pdfjs-dist/package.json'));
    const { getDocument } = await import(pathToFileURL(modulePath).href);
    class LocalAssets {
      async fetch({ kind, filename }) {
        const folder = {
          cMapUrl: 'cmaps',
          standardFontDataUrl: 'standard_fonts',
        }[kind];
        if (
          !folder ||
          typeof filename !== 'string' ||
          !/^[a-zA-Z0-9_.-]+$/u.test(filename) ||
          filename.includes('..')
        )
          throw new Error('EXTERNAL_RESOURCE_DENIED');
        return new Uint8Array(await readFile(join(assets, folder, filename)));
      }
    }
    const loading = getDocument({
      data: bytes,
      stopAtErrors: true,
      useWorkerFetch: false,
      useWasm: false,
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
      BinaryDataFactory: LocalAssets,
      verbosity: 0,
    });
    let passwordRequested = false;
    loading.onPassword = () => {
      passwordRequested = true;
      void loading.destroy();
    };
    let pdf;
    try {
      pdf = await loading.promise;
      const metadata = await pdf.getMetadata();
      if (metadata.info?.EncryptFilterName) fail('ENCRYPTED_PDF');
      if (pdf.numPages > MAX_PAGES) fail('EXTRACTION_LIMIT');
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        try {
          const stream = page.streamTextContent({
            includeMarkedContent: false,
          });
          const reader = stream.getReader();
          const parts = [];
          let pageBytes = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const item of value.items) {
              if (typeof item.str !== 'string') continue;
              const part = `${item.str}${item.hasEOL ? '\n' : ' '}`;
              pageBytes += Buffer.byteLength(part, 'utf8');
              if (normalizedTextBytes + pageBytes > MAX_TEXT) {
                await reader.cancel();
                fail('EXTRACTION_LIMIT');
              }
              parts.push(part);
            }
          }
          append(parts.join('').trim(), `Página ${pageNumber}`);
        } finally {
          page.cleanup();
        }
      }
    } catch (error) {
      if (error?.safeCode) throw error;
      if (
        passwordRequested ||
        error?.name === 'PasswordException' ||
        /password/iu.test(error?.message ?? '')
      )
        fail('ENCRYPTED_PDF');
      fail('INVALID_PDF');
    } finally {
      if (!loading.destroyed) await loading.destroy();
    }
  } else {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('INVALID_TEXT');
    }
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13)
        fail('INVALID_TEXT');
    }
    text = normalize(text);
    append(text, `Líneas 1–${1 + (text.match(/\n/gu)?.length ?? 0)}`);
  }
  if (!segments.some((segment) => segment.text.trim())) fail('NO_TEXT');
  const material = {
    segments,
    extractionVersion: version,
    normalizedTextBytes,
  };
  const chunked = process.argv[3] === 'chunks';
  const output = JSON.stringify({
    ok: true,
    material: chunked
      ? {
          chunks: require('./dist/ingestion.js').chunkMaterial(material),
          extractionVersion: version,
          normalizedTextBytes,
        }
      : material,
  });
  if (Buffer.byteLength(output, 'utf8') > 100 * 1024 * 1024)
    fail('EXTRACTION_LIMIT');
  process.stdout.write(output);
} catch (error) {
  const code =
    error?.safeCode ??
    (error?.name === 'MaterialIngestionError' ? error.code : 'INVALID_PDF');
  process.stdout.write(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
}
