/* eslint @typescript-eslint/no-require-imports: "off" */
// Explicit test entrypoint; never copied into the production image. Auth, API,
// extraction, Storage and PostgreSQL are real. Only paid embeddings are a double.
const { testStartupObserver } = require('./test-startup-observer.cjs');
const startup = testStartupObserver('MATERIALS');
(async () => {
  startup.mark('IMPORTS_START');
  const { createApp, loadConfig } = require('../apps/api/dist/app.js');
  const { NestFactory } = require('@nestjs/core');
  const { MaterialIngestionError } = require('@alunza/ai');
  const { testHelpFactory } = require('./help-providers.cjs');
  const { startStorageFaultProxy } = require('./help-fault-storage.cjs');
  const { materialFaultForTexts } = require('./help-fault-materials.cjs');
  const { observedCall } = require('./help-fault-observer.cjs');
  startup.mark('IMPORTS_COMPLETE');
  startup.mark('CONFIG_START');
  const config = loadConfig();
  if (
    config.environment !== 'test' ||
    new URL(config.databaseUrl).port !== '18422' ||
    config.jwtIssuer !== 'http://127.0.0.1:18421/auth/v1'
  )
    throw new Error('El adaptador ficticio solo opera en LAB TEST.');
  startup.mark('CONFIG_COMPLETE');
  const seen = new Set();
  const embeddings = {
    configuration: {
      id: 'materials-fixture-3d-v1',
      model: 'test-fixture-only',
      dimensions: 3,
    },
    async embed(texts, signal, observer) {
      return observedCall('EMBEDDING', signal, observer, async () => {
        signal.throwIfAborted();
        const fault = materialFaultForTexts(texts);
        if (fault?.scenario === 'permanent')
          throw Object.assign(
            new MaterialIngestionError('INVALID_EMBEDDING', false),
            { httpStatus: 400 },
          );
        if (fault?.scenario === 'transient' && !seen.has(fault.id)) {
          seen.add(fault.id);
          throw new MaterialIngestionError('PROVIDER_UNAVAILABLE', true, 20);
        }
        if (fault?.scenario === 'slow') {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 2500);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(signal.reason);
              },
              { once: true },
            );
          });
        }
        return texts.map((text) => [
          1,
          text.includes('condición') ? 1 : 0.1,
          text.includes('función') ? 1 : 0.2,
        ]);
      });
    },
  };
  startup.mark('STORAGE_PROXY_START');
  const proxy = await startStorageFaultProxy(config.supabaseUrl);
  startup.mark('STORAGE_PROXY_COMPLETE');
  const app = await startup.createApp(NestFactory, () =>
    createApp(
      { ...config, supabaseUrl: proxy.url },
      embeddings,
      testHelpFactory(embeddings),
    ),
  );
  process.once('SIGTERM', () => proxy.close());
  process.once('SIGINT', () => proxy.close());
  app.enableShutdownHooks();
  startup.mark('LISTEN_START');
  await app.listen(config.port, config.host);
  startup.mark('LISTEN_COMPLETE');
})().catch(() => {
  startup.failed();
  console.error('No se inició la API aislada de materiales.');
  process.exitCode = 1;
});
