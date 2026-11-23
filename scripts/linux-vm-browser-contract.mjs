// Private attach-only campaign contract. Importing performs no I/O.
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  validateCandidate,
  canonicalHash,
  summarizeLinuxVmSamples,
} from '../tests/integration/linux-vm-api.mjs';

export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const HASH = /^[a-f0-9]{64}$/;
export const ENDPOINTS = Object.freeze({
  web: 'http://127.0.0.1:3300',
  api: 'http://127.0.0.1:4300',
  apiReplica: 'http://127.0.0.1:4301',
  auth: 'http://127.0.0.1:18421',
  control: 'http://127.0.0.1:4302',
});
export const CASE_IDS = [
  'F01',
  'F02',
  'F03',
  'F04',
  'F05',
  'F06',
  'F07',
  'F08',
];
export const ACTIONS = [
  'inspect',
  'prepare',
  'login',
  'snapshot',
  'verify',
  'absent',
  'barrier-arm',
  'barrier-wait',
  'barrier-release',
  'barrier-cleanup',
  'hold-start',
  'hold-finish',
  'membership',
  'close',
];
export function requireValue(value, code) {
  if (!value) throw new Error(code);
}
export function exact(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
export function validateManifest(m) {
  requireValue(
    m?.schemaVersion === 1 &&
      UUID.test(m.campaignId) &&
      HASH.test(m.webSourceDigest),
    'MANIFEST_IDENTITY',
  );
  validateCandidate(m.candidate);
  requireValue(
    canonicalHash(m.endpoints) === canonicalHash(ENDPOINTS),
    'LOOPBACK_ENDPOINTS_REQUIRED',
  );
  requireValue(
    typeof m.controlKey === 'string' && /^[a-f0-9]{64}$/.test(m.controlKey),
    'PRIVATE_CONTROL_KEY',
  );
  requireValue(
    typeof m.outputDir === 'string' &&
      isAbsolute(m.outputDir) &&
      typeof m.statePath === 'string' &&
      m.statePath.startsWith('/') &&
      typeof m.brokerSocket === 'string' &&
      /^\/[A-Za-z0-9_./-]+$/.test(m.brokerSocket) &&
      !m.brokerSocket.includes('/../'),
    'PRIVATE_PATHS_REQUIRED',
  );
  return m;
}
export async function readPrivateJson(path) {
  const info = await lstat(path);
  requireValue(
    info.isFile() && !info.isSymbolicLink() && info.size < 2 * 1024 * 1024,
    'PRIVATE_FILE_REQUIRED',
  );
  if (process.platform === 'linux')
    requireValue(
      info.uid === process.getuid() && (info.mode & 0o077) === 0,
      'PRIVATE_FILE_PERMISSIONS',
    );
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function loadManifest(path) {
  return validateManifest(await readPrivateJson(path));
}
export function validateAction(action, input) {
  const shape = {
    inspect: [],
    prepare: ['scope'],
    login: ['scope', 'actorId'],
    snapshot: ['scope'],
    verify: [
      'scope',
      'actorId',
      'mode',
      'key',
      'status',
      'payload',
      'code',
      'diagnosis',
    ],
    absent: ['scope', 'actorId', 'mode', 'key'],
    'barrier-arm': ['scope', 'actorId', 'mode', 'key'],
    'barrier-wait': [],
    'barrier-release': [],
    'barrier-cleanup': [],
    'hold-start': ['scope', 'actorId', 'mode'],
    'hold-finish': [],
    membership: ['scope', 'actorId', 'active'],
    close: ['scope'],
  };
  requireValue(
    ACTIONS.includes(action) && exact(input, shape[action]),
    'CONTROL_ACTION_REJECTED',
  );
  if ('scope' in input)
    requireValue(
      [...CASE_IDS, 'NORMAL', 'CAPACITY'].includes(input.scope),
      'CONTROL_SCOPE',
    );
  if ('actorId' in input)
    requireValue(UUID.test(input.actorId), 'CONTROL_ACTOR');
  if ('mode' in input)
    requireValue(['RUN', 'SUBMIT'].includes(input.mode), 'CONTROL_MODE');
  if ('key' in input) requireValue(UUID.test(input.key), 'CONTROL_KEY');
  if (action === 'membership')
    requireValue(
      input.scope === 'F06' && typeof input.active === 'boolean',
      'REVOCATION_SCOPE',
    );
  if (action === 'verify')
    requireValue(
      [200, 201].includes(input.status) &&
        ['SUCCESS', 'FAILED_TEST', 'TIMEOUT', 'SYNTAX_ERROR'].includes(
          input.diagnosis,
        ) &&
        typeof input.code === 'string' &&
        Buffer.byteLength(input.code) <= 65536,
      'CONTROL_RESPONSE',
    );
  return input;
}
export async function control(m, action, input = {}) {
  validateAction(action, input);
  const response = await fetch(`${m.endpoints.control}/task`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
    headers: {
      'content-type': 'application/json',
      'x-alunza-control-key': m.controlKey,
    },
    body: JSON.stringify({ campaignId: m.campaignId, action, input }),
  });
  requireValue(response.status === 200, 'PRIVATE_CONTROL_FAILED');
  const text = await response.text();
  requireValue(
    Buffer.byteLength(text) <= 2 * 1024 * 1024,
    'PRIVATE_CONTROL_SIZE',
  );
  const result = JSON.parse(text);
  requireValue(
    result?.campaignId === m.campaignId &&
      result.ok === true &&
      Object.hasOwn(result, 'data'),
    'PRIVATE_CONTROL_ENVELOPE',
  );
  return result.data;
}
export function publicContext(scope, actors, teacherIds) {
  return {
    scope,
    actors: actors.map((a) => ({
      id: a.id,
      organizationId: a.organizationId,
      classId: a.classId,
      teacherId: teacherIds[a.classId],
      fixtures: Object.fromEntries(
        ['RUN', 'SUBMIT'].map((mode) => {
          const f = a.fixtures[mode];
          return [
            mode,
            {
              activityId: f.activityId,
              assignmentId: f.assignmentId,
              exerciseVersionId: f.exerciseVersionId,
              successCode: f.successCode,
              incorrectCode: f.incorrectCode,
              visibleCount: f.visibleTestIds.length,
            },
          ];
        }),
      ),
    })),
  };
}
export function browserPlan() {
  return Array.from({ length: 20 }, (_, round) =>
    ['RUN', 'SUBMIT'].map((mode, offset) => ({
      id: `${mode}-${round + 1}`,
      mode,
      actorIndex: (round * 2 + offset) % 8,
    })),
  ).flat();
}
export function capacityPlan() {
  return [2, 4].flatMap((width) =>
    ['RUN', 'SUBMIT', 'MIXED'].map((kind) => ({
      id: `C${width}-${kind}`,
      width,
      modes: Array.from({ length: width }, (_, i) =>
        kind === 'MIXED' ? (i % 2 ? 'SUBMIT' : 'RUN') : kind,
      ),
    })),
  );
}
export function racePlan() {
  return [2, 4].map((width) => ({
    id: `R${width}-MIXED`,
    width,
    modes: Array.from({ length: width }, (_, i) => (i % 2 ? 'SUBMIT' : 'RUN')),
  }));
}
export function validateBrowserRow(row) {
  requireValue(
    exact(row, [
      'id',
      'profile',
      'mode',
      'actorId',
      'requestId',
      'executionId',
      'attemptId',
      'durationMs',
      'pass',
      'failureCodes',
      'observationSha256',
    ]),
    'BROWSER_ROW_FIELDS',
  );
  requireValue(
    row.profile === 'normal' &&
      browserPlan().some((p) => p.id === row.id && p.mode === row.mode) &&
      UUID.test(row.actorId) &&
      typeof row.pass === 'boolean' &&
      Array.isArray(row.failureCodes) &&
      row.failureCodes.every((x) => /^[A-Z0-9_]{1,80}$/.test(x)),
    'BROWSER_ROW_IDENTITY',
  );
  requireValue(
    Number.isFinite(row.durationMs) &&
      row.durationMs >= 0 &&
      row.durationMs <= 120000,
    'BROWSER_CLOCK',
  );
  if (row.pass)
    requireValue(
      UUID.test(row.requestId) &&
        UUID.test(row.executionId) &&
        (row.mode === 'SUBMIT'
          ? UUID.test(row.attemptId)
          : row.attemptId === null) &&
        HASH.test(row.observationSha256) &&
        row.failureCodes.length === 0,
      'BROWSER_FALSE_PASS',
    );
  return row;
}
export function summarizeBrowser(rows, cases) {
  rows.forEach(validateBrowserRow);
  requireValue(
    new Set(rows.map((r) => r.id)).size === rows.length &&
      new Set(rows.filter((r) => r.pass).map((r) => r.executionId)).size ===
        rows.filter((r) => r.pass).length,
    'BROWSER_DUPLICATE',
  );
  const latency = summarizeLinuxVmSamples(rows);
  const planned = browserPlan();
  const actorCounts = new Map();
  for (const row of rows)
    actorCounts.set(row.actorId, (actorCounts.get(row.actorId) ?? 0) + 1);
  const samplingValid =
    rows.length === 40 &&
    rows.every(
      (r, i) => r.id === planned[i].id && r.mode === planned[i].mode,
    ) &&
    actorCounts.size === 8 &&
    [...actorCounts.values()].every((n) => n === 5);
  const functionalPassed =
    cases.length === 8 &&
    CASE_IDS.every(
      (id) => cases.filter((c) => c.id === id && c.pass === true).length === 1,
    );
  return {
    schemaVersion: 1,
    scope: 'LOCAL_BROWSER_ATTACH',
    clock: 'AUT_PERFORMANCE_NOW_ACTIVATION_THROUGH_CORRELATED_RESULT_RENDERED',
    functionalPassed,
    cases,
    latency,
    normalSamples: rows.length,
    samplingValid,
    pass:
      functionalPassed &&
      samplingValid &&
      ['RUN', 'SUBMIT'].every((mode) => latency[mode].strictTargetMet),
    remoteAcceptance: false,
    phaseContextExecuted: false,
  };
}
