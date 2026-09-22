import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { command, imageIdentity } from './capsule.mjs';
if (process.env.ALUNZA_SANDBOX_BOOTSTRAP !== '1' || process.getuid?.() !== 0)
  throw new Error('Sandbox-only bootstrap');
await access('/opt/alunza/capsule.tar');
const daemon = spawn(
  'dockerd',
  [
    '--host=unix:///var/run/docker.sock',
    '--iptables=false',
    '--bridge=none',
    '--ip-forward=false',
    '--ip-masq=false',
    '--log-level=error',
  ],
  {
    detached: true,
    stdio: 'ignore',
    env: { PATH: '/usr/local/bin:/usr/bin:/usr/sbin:/bin:/sbin' },
  },
);
daemon.unref();
const deadline = Date.now() + 15000;
let ready = false;
while (Date.now() < deadline) {
  const result = await command(['info', '--format', '{{json .}}'], {
    timeoutMs: 1000,
  });
  if (result.code === 0) {
    const info = JSON.parse(result.stdout);
    if (
      info.OSType !== 'linux' ||
      info.CgroupVersion !== '2' ||
      !info.MemoryLimit ||
      !info.SwapLimit ||
      !info.PidsLimit
    )
      throw new Error('Nested cgroup capability gap');
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!ready) throw new Error('Nested Docker unavailable');
const loaded = await command(['load', '--input', '/opt/alunza/capsule.tar'], {
  timeoutMs: 30000,
});
if (loaded.code !== 0) throw new Error('Prepared capsule import failed');
console.log(
  JSON.stringify({
    image: await imageIdentity(),
    node: process.version,
    ready: true,
  }),
);
