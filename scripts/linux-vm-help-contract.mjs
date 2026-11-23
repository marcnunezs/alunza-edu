// Explicit local TEST help campaign; importing performs no effects.
import { posix } from 'node:path';
import {
  validateManifest,
  readPrivateJson,
  requireValue,
} from './linux-vm-browser-contract.mjs';

export { requireValue };
export const HELP_CASE_IDS = Object.freeze(['H01', 'H02', 'H03']);
export const HELP_ACTIONS = Object.freeze([
  'inspect',
  'prepare',
  'login',
  'verify-attempt',
  'fault',
  'verify-help',
  'verify-retry',
  'close',
  'finish',
]);
export function validateHelpManifest(m) {
  validateManifest(m);
  requireValue(m.profile === 'PHYSICAL_HELP_TEST', 'HELP_PROFILE_REQUIRED');
  for (const key of [
    'artifactRoot',
    'controlDir',
    'faultPath',
    'scopesPath',
    'providerObservationsPath',
  ]) {
    requireValue(
      typeof m[key] === 'string' &&
        /^\/home\/alunza\/laboratorio\/[A-Za-z0-9_./-]+$/.test(m[key]) &&
        !m[key].endsWith('/') &&
        posix.normalize(m[key]) === m[key] &&
        !m[key].split('/').includes('..'),
      'HELP_PRIVATE_PATH',
    );
  }
  const base = posix.dirname(m.controlDir);
  requireValue(
    [m.faultPath, m.scopesPath, m.providerObservationsPath].every(
      (path) => posix.dirname(path) === base,
    ) &&
      new Set([
        m.controlDir,
        m.faultPath,
        m.scopesPath,
        m.providerObservationsPath,
      ]).size === 4 &&
      m.artifactRoot !== base &&
      !m.artifactRoot.startsWith(base + '/') &&
      !base.startsWith(m.artifactRoot + '/'),
    'HELP_PATH_ISOLATION',
  );
  return m;
}
export async function loadHelpManifest(path) {
  return validateHelpManifest(await readPrivateJson(path));
}
export async function control(m, action, input = {}) {
  validateHelpManifest(m);
  requireValue(
    HELP_ACTIONS.includes(action) &&
      input &&
      typeof input === 'object' &&
      !Array.isArray(input),
    'HELP_ACTION_REJECTED',
  );
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
  requireValue(response.status === 200, 'HELP_CONTROL_FAILED');
  const text = await response.text();
  requireValue(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'HELP_CONTROL_SIZE');
  const result = JSON.parse(text);
  requireValue(
    result?.campaignId === m.campaignId &&
      result.ok === true &&
      Object.hasOwn(result, 'data'),
    'HELP_CONTROL_ENVELOPE',
  );
  return result.data;
}
