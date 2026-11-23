import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run } from './local.mjs';

const require = createRequire(import.meta.url);
const { auditCsv } = require('../apps/api/dist/audit/audit-export-csv.js');
const actions = [
  '=1+1',
  '+1+1',
  '-1+1',
  '@SUM(1)',
  '＝1',
  '＋1',
  '－1',
  '＠1',
  ' \t=1',
  '\u200B=1',
  '\uFEFF+1',
  'acción,"uno"',
  'línea1\r\nlinea2',
  'control\u0000fin',
];
const id = '10000000-0000-4000-8000-000000000001';
const result = auditCsv(
  actions.map((action) => ({
    eventId: id,
    occurredAt: '2026-11-02T00:00:00.123456Z',
    actorId: null,
    action,
    entityType: 'FIXTURE',
    entityId: null,
    organizationId: id,
    outcome: 'SUCCEEDED',
  })),
);
const evidenceRoot = join(
  root,
  '.local/evidence/imp-06/audit-export-spreadsheet',
);
await mkdir(evidenceRoot, { recursive: true });
// Preserve each attempt, including the earlier legacy importer failures.
const prefix = `run-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-`;
const folder = await mkdtemp(join(evidenceRoot, prefix));
const csvPath = join(folder, 'benign.csv');
await writeFile(csvPath, result.bytes, { mode: 0o600, flag: 'wx' });
const reports = {};
for (const importMode of ['PowerQuery', 'OpenTextGeneral']) {
  const reportPath = join(folder, `${importMode}.json`);
  const processResult = await run(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(root, 'scripts/audit-export-spreadsheet-probe.ps1'),
      '-CsvPath',
      csvPath,
      '-ReportPath',
      reportPath,
      '-ImportMode',
      importMode,
    ],
    { allowFailure: true },
  );
  await writeFile(
    join(folder, `${importMode}-process.json`),
    JSON.stringify(processResult, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
  reports[importMode] = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(
    processResult.code,
    0,
    `La importación falló; evidencia: ${folder}`,
  );
  assert.equal(reports[importMode].status, 'passed');
  assert.equal(reports[importMode].sourceSha256, result.sha256);
}
await writeFile(
  join(folder, 'result.json'),
  JSON.stringify(
    {
      status: 'passed',
      sha256: result.sha256,
      byteLength: result.bytes.length,
      fidelity: reports.PowerQuery,
      formulaNeutralization: reports.OpenTextGeneral,
    },
    null,
    2,
  ),
  { mode: 0o600, flag: 'wx' },
);
console.log(
  `CSV verificado en Excel: Power Query conserva 15×8 y CRLF; OpenText General conserva las 11 celdas neutralizadas sin fórmulas. Evidencia: ${folder}`,
);
