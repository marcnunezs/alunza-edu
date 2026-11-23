import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  developmentTarget,
  testTarget,
  testWorkspaceDirectory,
  assertRuntimeTarget,
} from './local-target.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const isolated = process.env.ALUNZA_E2E_BUILD === '1';
const stateRoot = isolated ? join(root, testWorkspaceDirectory) : root;
const buildDirectory = join(root, 'apps/web', isolated ? '.next-e2e' : '.next');
const privateState = JSON.parse(
  await readFile(join(stateRoot, '.local/runtime.json'), 'utf8'),
);
assertRuntimeTarget(privateState, isolated ? testTarget : developmentTarget);
const signingKeys = JSON.parse(
  await readFile(join(stateRoot, 'supabase/signing_keys.json'), 'utf8'),
);
const secrets = [
  privateState.applicationPassword,
  privateState.fixturePassword,
  privateState.authAdminKey,
  privateState.migrationUrl,
  ...signingKeys.map((key) => key.d),
].filter((value) => typeof value === 'string' && value.length > 15);
if (secrets.length < 5)
  throw new Error('Falta estado local para comprobar los secretos reales.');
// Private test canaries belong only to the Node acceptance fixtures.
secrets.push(
  'hidden-sentinel-e2e',
  'IMP02_PRIVATE_EXPECTATION_DO_NOT_EXPOSE',
  'hidden-run-sentinel',
);
if (process.env.ALUNZA_ARTIFACT_CANARIES) {
  const canaries = JSON.parse(process.env.ALUNZA_ARTIFACT_CANARIES);
  if (
    !Array.isArray(canaries) ||
    canaries.length !== 2 ||
    canaries.some(
      (value) =>
        typeof value !== 'string' ||
        !/^alunza-canary-[a-z]+-[a-f0-9]{48}$/.test(value),
    )
  )
    throw new Error('Configuración de canarios de artefactos inválida.');
  secrets.push(...canaries);
}

let checked = 0;
async function scan(directory, onlyHtml = false) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path, onlyHtml);
    else if (!onlyHtml || entry.name.endsWith('.html')) {
      const content = await readFile(path, 'utf8');
      if (secrets.some((secret) => content.includes(secret)))
        throw new Error('Se detectó un secreto local en un artefacto público.');
      checked += 1;
    }
  }
}
await scan(join(buildDirectory, 'static'));
await scan(join(buildDirectory, 'server/app'), true);
if (checked === 0)
  throw new Error('No hay artefactos públicos para comprobar.');
console.log(
  `Artefactos públicos comprobados: ${checked}; sin credenciales privadas locales ni clave de firma.`,
);
