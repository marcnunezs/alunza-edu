import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');
const children = new Set();
let closing = false;

function launch(args) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', () => stop(1));
  return child;
}

function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

const initial = launch([compiler, '-p', 'tsconfig.build.json']);
initial.once('exit', (code) => {
  if (closing || code !== 0) return stop(code ?? 1);
  const watch = launch([
    compiler,
    '-p',
    'tsconfig.build.json',
    '--watch',
    '--preserveWatchOutput',
  ]);
  const server = launch([
    '--env-file-if-exists=.env.local',
    '--watch',
    'dist/main.js',
  ]);
  for (const child of [watch, server]) {
    child.once('exit', (exitCode) => stop(exitCode ?? 1));
  }
});
