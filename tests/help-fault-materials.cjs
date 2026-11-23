/* eslint @typescript-eslint/no-require-imports: "off" */
const fs = require('node:fs');
const { resolve } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { MaterialExtractor } = require('@alunza/ai');
const path = resolve(__dirname, '../.local/material-embedding-fault.json');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const scenarios = new Set(['permanent', 'transient', 'slow']);
async function setMaterialFault({ text, scenario }) {
  if (
    typeof text !== 'string' ||
    !text.length ||
    Buffer.byteLength(text) > 1000000 ||
    !scenarios.has(scenario)
  )
    throw new Error('Invalid material TEST fault');
  const { chunks } = await new MaterialExtractor().extractAndChunk(
    Buffer.from(text),
    'TXT',
  );
  const control = {
    id: randomUUID(),
    fileHash: hash(text),
    chunkHashes: chunks.map((chunk) => hash(chunk.text)),
    scenario,
    expiresAt: Date.now() + 300000,
  };
  fs.mkdirSync(resolve(__dirname, '../.local'), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(control), { mode: 0o600 });
  return null;
}
function materialFaultForTexts(texts) {
  let control;
  try {
    control = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (
    !scenarios.has(control.scenario) ||
    !/^[a-f0-9]{64}$/.test(control.fileHash) ||
    !Array.isArray(control.chunkHashes)
  )
    throw new Error('Invalid material TEST fault');
  return control.expiresAt > Date.now() &&
    texts.some((text) => control.chunkHashes.includes(hash(text)))
    ? control
    : null;
}
function clearMaterialFault() {
  try {
    fs.unlinkSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return null;
}
module.exports = {
  setMaterialFault,
  materialFaultForTexts,
  clearMaterialFault,
};
