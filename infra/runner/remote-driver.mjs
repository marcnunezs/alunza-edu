import { readFile, unlink } from 'node:fs/promises';
import { runCapsule } from './capsule.mjs';
const path = process.argv[2];
if (!/^\/vercel\/sandbox\/alunza-input-[a-f0-9-]{36}\.json$/.test(path ?? ''))
  throw new Error('Invalid private job path');
try {
  const body = await readFile(path);
  if (body.length > 262144) throw new Error('Capsule input too large');
  const result = await runCapsule(JSON.parse(body.toString('utf8')));
  process.stdout.write(JSON.stringify(result));
} finally {
  await unlink(path);
}
