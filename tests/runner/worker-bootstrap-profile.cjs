#!/usr/bin/env node
'use strict';
/* global WebAssembly, __filename */

// Fixed trusted bootstrap microbenchmark. Never reads or evaluates student code.
// Every sample uses a new Node process, WASM module, runtime and context.
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const FLAGS = Object.freeze({
  baseline: [],
  'cjs-loader': [],
  'sync-wasm': [],
  'cjs-v8-one': ['--v8-pool-size=1'],
  'cjs-wasm-one': ['--wasm-num-compilation-tasks=1'],
  'cjs-both-one': ['--v8-pool-size=1', '--wasm-num-compilation-tasks=1'],
  'sync-both-one': ['--v8-pool-size=1', '--wasm-num-compilation-tasks=1'],
  'cjs-both-no-tier': [
    '--v8-pool-size=1',
    '--wasm-num-compilation-tasks=1',
    '--no-wasm-tier-up',
  ],
});
const MODES = Object.keys(FLAGS);

async function sample(mode) {
  const marks = { entry: performance.now() };
  const cpu = process.cpuUsage();
  const {
    newQuickJSWASMModuleFromVariant,
    newVariant,
  } = require('quickjs-emscripten-core');
  const base = require('@jitl/quickjs-wasmfile-release-sync').default;
  marks.imported = performance.now();
  let variant = base;
  if (mode !== 'baseline') {
    variant = {
      ...base,
      importModuleLoader: async () =>
        require('@jitl/quickjs-wasmfile-release-sync/emscripten-module'),
    };
  }
  if (mode.startsWith('sync-')) {
    variant = newVariant(variant, {
      emscriptenModule: {
        instantiateWasm(imports, onSuccess) {
          const bytes = readFileSync(
            require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'),
          );
          const compiled = new WebAssembly.Module(bytes);
          const instance = new WebAssembly.Instance(compiled, imports);
          onSuccess(instance);
          return instance.exports;
        },
      },
    });
  }
  marks.configured = performance.now();
  const quickjs = await newQuickJSWASMModuleFromVariant(variant);
  marks.wasmReady = performance.now();
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(134217728);
  runtime.setMaxStackSize(1024 * 1024);
  marks.runtimeReady = performance.now();
  const context = runtime.newContext();
  marks.contextReady = performance.now();
  context.dispose();
  runtime.dispose();
  marks.disposed = performance.now();
  const used = process.cpuUsage(cpu);
  return {
    mode,
    marks,
    flags: process.execArgv,
    cpuUserMs: used.user / 1000,
    cpuSystemMs: used.system / 1000,
    maxRssKiB: process.resourceUsage().maxRSS,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--sample' && args.length === 2 && MODES.includes(args[1])) {
    console.log(JSON.stringify(await sample(args[1])));
    return;
  }
  if (args.length) throw new Error('INVALID_PROFILE_ARGUMENTS');
  const samples = [];
  for (let block = 0; block < 12; block++) {
    const modes = block % 2 ? [...MODES].reverse() : MODES;
    for (const mode of modes) {
      const start = performance.now();
      const result = spawnSync(
        process.execPath,
        [...FLAGS[mode], __filename, '--sample', mode],
        {
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 65536,
          windowsHide: true,
        },
      );
      if (result.status !== 0 || result.error)
        throw new Error('PROFILE_SAMPLE_FAILED');
      samples.push({
        block,
        elapsedMs: performance.now() - start,
        ...JSON.parse(result.stdout),
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        protocol: 'TRUSTED_BOOTSTRAP_PROFILE_V1',
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        scope: 'NO_STUDENT_CODE_NO_CAPSULE_NO_ACCEPTANCE',
        samples,
      },
      null,
      2,
    ),
  );
}
if (require.main === module)
  main().catch(() => {
    console.error('TRUSTED_BOOTSTRAP_PROFILE_FAILED');
    process.exitCode = 1;
  });
