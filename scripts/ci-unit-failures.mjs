import { stripVTControlCharacters } from 'node:util';

const maxFiles = 16;
const maxPathLength = 512;
const maxLineLength = 2048;
const maxOutputLength = 8 * 1024 * 1024;
const testExtension = /\.(?:test|spec)\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
const testRoot = /^(?:apps|packages|tests)\//;

function relativePath(value, workspacePrefix = false) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxPathLength ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code > 126;
    })
  )
    return undefined;
  let path = value.replaceAll('\\', '/');
  if (workspacePrefix) path = path.replace(/^(?:\.{1,2}\/)+/, '');
  if (
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    !testExtension.test(path)
  )
    return undefined;
  return path;
}

/** Publish only versioned suite paths, never assertion text or raw diagnostics. */
export function summarizeUnitFailures(output, trackedFiles) {
  const failedTestFiles = [];
  if (
    typeof output !== 'string' ||
    output.length > maxOutputLength ||
    (!Array.isArray(trackedFiles) && !(trackedFiles instanceof Set))
  )
    return { failedTestFiles };
  const tracked = new Set(
    [...trackedFiles]
      .map((file) => relativePath(file))
      .filter((file) => file !== undefined && testRoot.test(file)),
  );
  const seen = new Set();
  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.length > maxLineLength) continue;
    const line = stripVTControlCharacters(rawLine);
    const match = /^[\t ]*FAIL[\t ]+(.+?)[\t ]*$/.exec(line);
    if (!match) continue;
    const candidate = relativePath(
      match[1].replace(/\s+\(\d+(?:\.\d+)?\s+(?:s|ms)\)$/, ''),
      true,
    );
    if (candidate === undefined) continue;
    let file = tracked.has(candidate) ? candidate : undefined;
    if (file === undefined && candidate.startsWith('src/')) {
      const matches = [...tracked].filter((path) =>
        path.endsWith(`/${candidate}`),
      );
      if (matches.length === 1) file = matches[0];
    }
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    failedTestFiles.push(file);
    if (failedTestFiles.length === maxFiles) break;
  }
  return { failedTestFiles };
}
