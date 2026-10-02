/* eslint @typescript-eslint/no-require-imports: "off" */
// Node-only test controls. No product route, document or student code selects a
// fault. The exclusive TEST owner serializes scenarios and clears each control.
const {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} = require('node:fs');
const { resolve, dirname } = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { assertLaboratoryTestState } = require('./laboratory-test-state.cjs');
const {
  setMaterialFault,
  clearMaterialFault,
} = require('./help-fault-materials.cjs');
const controlPath = resolve(__dirname, '../.local/help-fault-control.json');
const scenarios = new Set([
  'generation-unavailable',
  'invalid-output',
  'fake-reference',
  'diagnosis-contradiction',
  'review-unavailable',
  'ambiguous',
  'reject-injection',
  'reject-solution',
  'generation-delay',
  'review-delay',
  'deadline',
  'no-evidence',
  'embedding-unavailable',
  'literal-html',
]);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readHelpFault(attemptId) {
  let value;
  try {
    value = JSON.parse(readFileSync(controlPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Invalid TEST fault control', { cause: error });
  }
  if (
    !uuid.test(value.attemptId) ||
    !scenarios.has(value.scenario) ||
    !Number.isFinite(value.expiresAt)
  )
    throw new Error('Invalid TEST fault control');
  if (
    Date.now() >= value.expiresAt ||
    (attemptId && attemptId !== value.attemptId)
  )
    return null;
  return value;
}
function setHelpFault({ attemptId, scenario }) {
  if (!uuid.test(attemptId) || !scenarios.has(scenario))
    throw new Error('Invalid TEST fault request');
  mkdirSync(dirname(controlPath), { recursive: true });
  const temporary = `${controlPath}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ attemptId, scenario, expiresAt: Date.now() + 300000 }),
    { mode: 0o600 },
  );
  renameSync(temporary, controlPath);
  return null;
}
function clearHelpFault() {
  try {
    unlinkSync(controlPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return null;
}
function helpFaultTasks(state) {
  assertLaboratoryTestState(state);
  const url = new URL(state.migrationUrl);
  if (
    state.projectId !== 'alunza-edu-laboratorio-test' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '18422'
  )
    throw new Error('Fault tasks require isolated LAB TEST.');
  return {
    'materials:fault/set': setMaterialFault,
    'materials:fault/clear': clearMaterialFault,
    'help:fault/set': setHelpFault,
    'help:fault/clear': clearHelpFault,
    'help:events': async ({ attemptId }) => {
      if (!uuid.test(attemptId)) throw new Error('Invalid TEST attempt');
      const db = new Client({ connectionString: state.migrationUrl });
      await db.connect();
      try {
        const result = await db.query(
          'SELECT event_type AS type,hint_level AS level,count(*)::int AS count FROM app_private.help_events WHERE attempt_id=$1 GROUP BY event_type,hint_level ORDER BY event_type,hint_level',
          [attemptId],
        );
        return result.rows;
      } finally {
        await db.end();
      }
    },
  };
}
module.exports = {
  readHelpFault,
  setHelpFault,
  clearHelpFault,
  helpFaultTasks,
};
