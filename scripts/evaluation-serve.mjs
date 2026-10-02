import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, readState, apiEnvironment, portAvailable } from './local.mjs';
import { evaluationContext } from './evaluation-environment.mjs';
import { nodeService } from './test-environment.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const argument = process.argv[i];
  if (argument === '--web') options.web = true;
  else if (
    ['--provider-env', '--calibration'].includes(argument) &&
    process.argv[i + 1]
  )
    options[argument.slice(2)] = process.argv[++i];
  else throw new Error('INVALID_EVALUATION_SERVE_ARGUMENT');
}
const ctx = evaluationContext;
const state = await readState(ctx);
const provider = options['provider-env']
  ? JSON.parse(await readFile(options['provider-env'], 'utf8'))
  : {};
if (
  Object.entries(provider).some(
    ([key, value]) => !/^AI_[A-Z_]+$/.test(key) || typeof value !== 'string',
  )
)
  throw new Error('INVALID_PROVIDER_ENVIRONMENT');
const calibration = options.calibration
  ? JSON.parse(await readFile(options.calibration, 'utf8'))
  : null;
if (
  calibration &&
  (calibration.version !== 'help-evidence-2' || calibration.origin !== 'AZURE')
)
  throw new Error('CALIBRATION_NOT_PROMOTABLE');
for (const port of [
  ctx.apiPort,
  ctx.operationsPort,
  ...(options.web ? [ctx.webPort] : []),
])
  if (!(await portAvailable(port)))
    throw new Error('EVALUATION_SERVICE_ALREADY_RUNNING');
const environment = {
  ...apiEnvironment(ctx, state),
  ...provider,
  EVALUATION_ENABLED: 'true',
  EVALUATION_OPERATIONS_PORT: String(ctx.operationsPort),
  ...(calibration
    ? {
        HELP_CALIBRATION_JSON: JSON.stringify(calibration),
        HELP_CALIBRATION_CORPUS_SHA256:
          calibration.measurement.binding.corpusHash,
      }
    : {}),
};
const api = nodeService([join(root, 'apps/api/dist/main.js')], environment);
let web;
try {
  await api.start(`${ctx.apiUrl}/health/ready`);
  if (options.web) {
    web = nodeService(
      [
        join(root, 'node_modules/next/dist/bin/next'),
        'dev',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(ctx.webPort),
      ],
      {
        NEXT_PUBLIC_API_BASE_URL: ctx.apiUrl,
        NEXT_PUBLIC_SUPABASE_URL: state.authUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.publishableKey,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      join(root, 'apps/web'),
    );
    await web.start(ctx.webUrl);
  }
  console.log(
    'LAB-EVAL listo. Ctrl+C detiene sólo los consumidores propios; los datos se conservan.',
  );
  await new Promise((done) => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
} finally {
  await web?.stop();
  await api.stop();
}
