import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { z } from 'zod';
import {
  developmentTarget,
  testTarget,
  testWorkspaceDirectory,
  assertRuntimeTarget,
} from './local-target.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const uuid = z.uuid();
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6);
const flags = new Set([
  'target',
  'organization',
  'class',
  'student',
  'activity',
  'as-of',
]);

export function parseSignalsRebuildArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['plan', 'check', 'rebuild', 'report'].includes(mode))
    throw new Error('Modo requerido: plan, check, rebuild o report.');
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const key = flag?.startsWith('--') ? flag.slice(2) : '';
    const value = rest[index + 1];
    if (!flags.has(key) || key in values || !value || value.startsWith('--'))
      throw new Error('Argumentos de reconstrucción inválidos o repetidos.');
    values[key] = value;
  }
  if (
    Object.keys(values).length !== flags.size ||
    !['test', 'development'].includes(values.target)
  )
    throw new Error(
      'Indica target local, organización, clase, estudiante, actividad y as-of.',
    );
  const scope = {
    organizationId: uuid.parse(values.organization),
    classId: uuid.parse(values.class),
    studentId: uuid.parse(values.student),
    activityId: uuid.parse(values.activity),
    asOf: instant.parse(values['as-of']),
  };
  return { mode, target: values.target, scope };
}

export function assertSignalsRebuildTarget(state, targetName) {
  const target =
    targetName === 'test'
      ? testTarget
      : targetName === 'development'
        ? developmentTarget
        : null;
  if (!target) throw new Error('Destino de reconstrucción no permitido.');
  try {
    assertRuntimeTarget(state, target);
  } catch {
    throw new Error(
      'La reconstrucción solo admite el laboratorio local aislado.',
    );
  }
  return target;
}

async function loadState(targetName) {
  const { context, readState } = await import('./local.mjs');
  const ctx = context(
    targetName === 'test' ? join(root, testWorkspaceDirectory) : root,
    targetName === 'test',
  );
  return { ctx, state: await readState(ctx) };
}

async function executeMaintenance({ mode, scope }, { ctx, state }) {
  // Imports occur only after validation of the fixed local destination.
  await import('reflect-metadata');
  const require = createRequire(import.meta.url);
  const { NestFactory } = require('@nestjs/core');
  const { loadConfig } = require(join(root, 'apps/api/dist/config.js'));
  const { SignalsMaintenanceModule } = require(
    join(root, 'apps/api/dist/signals/signals-maintenance.module.js'),
  );
  const { SignalsRepository } = require(
    join(root, 'apps/api/dist/signals/signals.repository.js'),
  );
  const { apiEnvironment } = await import('./local.mjs');
  const config = loadConfig({
    ...apiEnvironment(ctx, state),
    INVITATION_WORKER_ENABLED: 'false',
    MATERIALS_WORKER_ENABLED: 'false',
    HELP_WORKER_ENABLED: 'false',
    SIGNALS_WORKER_ENABLED: 'false',
    PRACTICE_RUNNER_ENABLED: 'false',
    EVALUATION_ENABLED: 'false',
  });
  const app = await NestFactory.createApplicationContext(
    SignalsMaintenanceModule.register(config),
    { logger: false },
  );
  try {
    return await app.get(SignalsRepository).maintenance(mode, scope);
  } finally {
    await app.close();
  }
}

export async function signalsRebuildMain(argv, dependencies = {}) {
  const args = parseSignalsRebuildArgs(argv);
  const now = (dependencies.now ?? (() => new Date()))();
  // The database repeats this check with its authoritative microsecond clock.
  const scopeMicros =
    BigInt(Date.parse(args.scope.asOf.replace(/\.\d+/, ''))) * 1000n +
    BigInt((args.scope.asOf.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0'));
  if (scopeMicros > BigInt(now.getTime()) * 1000n)
    throw new Error('El corte de reconstrucción no puede estar en el futuro.');
  const target = args.target === 'test' ? testTarget : developmentTarget;
  if (args.mode === 'plan')
    return {
      mode: 'plan',
      projectId: target.projectId,
      scope: args.scope,
      mutates: false,
      rebuilds: 'derived-projections-only',
      publishesSignals: false,
    };
  const runtime = await (dependencies.loadState ?? loadState)(args.target);
  assertSignalsRebuildTarget(runtime.state, args.target);
  return (dependencies.execute ?? executeMaintenance)(args, runtime);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(await signalsRebuildMain(process.argv.slice(2)), null, 2),
    );
  } catch {
    console.error(
      'No se completó la reconstrucción. Verifica modo, ámbito, corte, build y destino local.',
    );
    process.exitCode = 1;
  }
}
