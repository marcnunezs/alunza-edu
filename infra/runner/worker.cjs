// This process is untrusted after loading solution.cjs. fd3 is DATA, not authority.
const fs = require('node:fs');
const write = fs.writeSync.bind(fs);
const stringify = JSON.stringify.bind(JSON);
const exit = process.exit.bind(process);
const status = fs.readFileSync('/proc/self/status', 'utf8');
const capabilities = status
  .split('\n')
  .filter((line) => /^Cap(Inh|Prm|Eff|Bnd|Amb):/.test(line));
let parentReadable = false;
try {
  fs.accessSync('/proc/1/fd/1', fs.constants.R_OK);
  parentReadable = true;
} catch {
  /* separate UID, expected */
}
if (
  process.getuid() !== 10001 ||
  capabilities.length !== 5 ||
  capabilities.some(
    (line) => line.split(':')[1].trim() !== '0000000000000000',
  ) ||
  !/^NoNewPrivs:\s+1$/m.test(status) ||
  parentReadable
) {
  write(3, '{"kind":"invalid","reason":"CAPABILITY_GAP"}');
  exit(71);
}
function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (
    typeof value !== 'object' ||
    seen.has(value) ||
    (value && typeof value.then === 'function')
  )
    throw new Error('Invalid JSON return');
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    throw new Error('Invalid JSON object');
  seen.add(value);
  for (const key of Object.keys(value)) jsonValue(value[key], seen);
  seen.delete(value);
}
try {
  const args = JSON.parse(fs.readFileSync('/tmp/args.json', 'utf8'));
  const solution = require('/tmp/solution.cjs');
  if (typeof solution.solve !== 'function') throw new Error('Missing solve');
  const value = solution.solve(...args);
  jsonValue(value);
  const encoded = stringify({ kind: 'value', value });
  if (Buffer.byteLength(encoded) > 65536) {
    write(3, '{"kind":"invalid","reason":"RETURN_LIMIT"}');
    exit(65);
  }
  write(3, encoded);
} catch {
  write(3, '{"kind":"exception"}');
  exit(70);
}
