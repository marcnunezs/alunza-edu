import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readProbeEvidence } from './preprod-report.mjs';
import {
  validateManifest,
  assertRemoteAuthorization,
} from './preprod-manifest.mjs';

const operation = process.argv[2];
let manifestPath;
let configured = false;
let manifest;
let exitCode;
const started = performance.now();
try {
  if (!['probe:ai', 'probe:sandbox'].includes(operation)) throw new Error();
  manifest = validateManifest(
    JSON.parse(process.env.PREPROD_MANIFEST_JSON ?? '{}'),
  );
  assertRemoteAuthorization(manifest, 'azure:job');
  assertRemoteAuthorization(manifest, operation);
  configured = true;
  manifestPath = join(tmpdir(), `alunza-probe-${randomUUID()}.json`);
  await writeFile(manifestPath, JSON.stringify(manifest), {
    mode: 0o600,
    flag: 'wx',
  });
  const script =
    operation === 'probe:ai'
      ? 'scripts/ai-probe.mjs'
      : 'scripts/runner-probe.mjs';
  const args =
    operation === 'probe:ai'
      ? [
          '--manifest',
          manifestPath,
          '--provider',
          'azure',
          '--mode',
          'connectivity',
        ]
      : ['--adapter', 'vercel', '--manifest', manifestPath];
  // Pass credentials only to the selected probe, not the other provider or API.
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'production',
  };
  for (const name of operation === 'probe:ai'
    ? [
        'AI_AUTH_MODE',
        'AI_AZURE_API_KEY',
        'AI_MANAGED_IDENTITY_CLIENT_ID',
        'AI_EMBEDDING_MODEL',
        'AI_GENERATION_MODEL',
        'AI_CONFIGURATION_ID',
      ]
    : [
        'VERCEL_TOKEN',
        'VERCEL_TEAM_ID',
        'VERCEL_PROJECT_ID',
        'RUNNER_SANDBOX_IMAGE',
        'RUNNER_SANDBOX_REGION',
      ])
    if (process.env[name]) environment[name] = process.env[name];
  // Azure supplies these to the managed-identity endpoint. They must reach only
  // the AI SDK process, never the Sandbox or the application API.
  if (
    operation === 'probe:ai' &&
    environment.AI_AUTH_MODE === 'managed-identity'
  )
    for (const name of ['IDENTITY_ENDPOINT', 'IDENTITY_HEADER'])
      if (process.env[name]) environment[name] = process.env[name];
  const deadline = Math.min(
    manifest.budget.maxDurationSeconds * 1000,
    Date.parse(manifest.remote.expiresAt) - Date.now(),
  );
  // The runner stops new work at its internal deadline. Keep the parent alive
  // briefly so its finally block can stop/delete the remote Sandbox afterwards.
  const cleanupGraceMs = operation === 'probe:sandbox' ? 35000 : 0;
  await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: environment,
      stdio: 'ignore',
      detached: false,
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, deadline + cleanupGraceMs);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error());
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveExit();
      else {
        const error = new Error();
        error.code = code;
        reject(error);
      }
    });
  });
  exitCode = 0;
} catch (error) {
  exitCode = !configured || error.code === 2 ? 2 : 1;
} finally {
  if (manifestPath) await unlink(manifestPath);
}
let evidence = null;
if (configured) {
  try {
    evidence = await readProbeEvidence(
      operation === 'probe:ai'
        ? '.local/reports/imp-00-06-08/ai-probe.json'
        : '.local/reports/imp-00-06-08/runner-vercel.json',
      operation,
      manifest,
    );
  } catch {
    /* Missing/malformed evidence can never make a passed Job. */
  }
  if (exitCode === 0 && evidence?.complete !== true) exitCode = 1;
}
const report = {
  schemaVersion: 1,
  operation: ['probe:ai', 'probe:sandbox'].includes(operation)
    ? operation
    : 'invalid',
  status:
    exitCode === 0
      ? 'passed'
      : exitCode === 2
        ? 'pending-configuration-or-authorization'
        : 'failed',
  release: configured ? manifest.release.sha : null,
  durationMs: Math.round(performance.now() - started),
  evidence,
  recordedAt: new Date().toISOString(),
};
if (configured) {
  await mkdir('.local/reports/imp-00-06-08', { recursive: true });
  await writeFile(
    '.local/reports/imp-00-06-08/preprod-job.json',
    JSON.stringify(report, null, 2) + '\n',
  );
}
// One bounded, explicitly selected public record is retained in ACA logs; raw
// provider responses, Sandbox names, code, credentials and model text are omitted.
console.log(JSON.stringify(report));
process.exitCode = exitCode;
