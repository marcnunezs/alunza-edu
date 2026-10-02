const { performance } = require('node:perf_hooks');
const { writeSync } = require('node:fs');

const phases = new Set([
  'IMPORTS_START',
  'IMPORTS_COMPLETE',
  'CONFIG_START',
  'CONFIG_COMPLETE',
  'STORAGE_PROXY_START',
  'STORAGE_PROXY_COMPLETE',
  'CREATE_APP_START',
  'APP_INIT_START',
  'APP_INIT_COMPLETE',
  'CREATE_APP_COMPLETE',
  'LISTEN_START',
  'LISTEN_COMPLETE',
]);

// Explicit TEST entrypoints only. Never emit arguments, config or error bodies.
function testStartupObserver(entrypoint, options = {}) {
  if (!['MATERIALS', 'EVALUATION'].includes(entrypoint))
    throw new Error('Unknown TEST startup entrypoint.');
  const now = options.now ?? (() => performance.now());
  const write =
    options.write ?? ((line) => writeSync(process.stdout.fd, `${line}\n`));
  const started = now();
  let previous = started;
  let lastPhase = null;
  const emit = (phase, extra = {}) => {
    const current = now();
    write(
      JSON.stringify({
        event: 'TEST_API_STARTUP',
        entrypoint,
        phase,
        elapsedMs: Math.round((current - started) * 100) / 100,
        phaseMs: Math.round((current - previous) * 100) / 100,
        ...extra,
      }),
    );
    previous = current;
  };
  return {
    mark(phase) {
      if (!phases.has(phase)) throw new Error('Unknown TEST startup phase.');
      emit(phase);
      lastPhase = phase;
    },
    failed() {
      emit('STARTUP_FAILED', { failedPhase: lastPhase });
    },
    async createApp(nestFactory, create) {
      const originalCreate = nestFactory.create;
      let active = true;
      nestFactory.create = async function (...args) {
        const app = await originalCreate.apply(this, args);
        const originalInit = app.init;
        const observedInit = async (...initArgs) => {
          if (!active) return originalInit.apply(app, initArgs);
          emit('APP_INIT_START');
          lastPhase = 'APP_INIT_START';
          const result = await originalInit.apply(app, initArgs);
          emit('APP_INIT_COMPLETE');
          lastPhase = 'APP_INIT_COMPLETE';
          return result;
        };
        // Nest's own proxy ignores property assignments. Intercept reads on an
        // outer instance proxy instead; never mutate or redefine its init.
        return new Proxy(app, {
          get(target, property, receiver) {
            if (active && property === 'init') return observedInit;
            return Reflect.get(target, property, receiver);
          },
        });
      };
      this.mark('CREATE_APP_START');
      try {
        const result = await create();
        this.mark('CREATE_APP_COMPLETE');
        return result;
      } finally {
        active = false;
        nestFactory.create = originalCreate;
      }
    },
  };
}

module.exports = { testStartupObserver };
