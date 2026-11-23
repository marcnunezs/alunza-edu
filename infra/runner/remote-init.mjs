import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { command, imageIdentity } from './capsule.mjs';

function daemonInfo(result) {
  if (result.code !== 0) return;
  let info;
  try {
    info = JSON.parse(result.stdout);
  } catch {
    return;
  }
  // Docker 20.10 can exit zero with a client-only response while dockerd starts.
  if (typeof info?.ServerVersion !== 'string' || !info.ServerVersion.trim())
    return;
  const errors = info.ServerErrors;
  if (errors != null && (!Array.isArray(errors) || errors.length > 0)) return;
  return info;
}

if (process.env.ALUNZA_SANDBOX_BOOTSTRAP !== '1' || process.getuid?.() !== 0)
  throw new Error('Sandbox-only bootstrap');
await access('/opt/alunza/capsule.tar');
const daemon = spawn(
  '/usr/sbin/dockerd',
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
let server;
for (;;) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) break;
  const info = daemonInfo(
    await command(['info', '--format', '{{json .}}'], {
      timeoutMs: Math.min(1000, remaining),
    }),
  );
  const afterProbe = deadline - Date.now();
  if (afterProbe <= 0) break;
  if (info) {
    if (
      info.OSType !== 'linux' ||
      info.CgroupVersion !== '2' ||
      info.MemoryLimit !== true ||
      info.SwapLimit !== true ||
      info.PidsLimit !== true
    )
      throw new Error('Nested cgroup capability gap');
    server = info;
    break;
  }
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(200, afterProbe)),
  );
}
if (!server) throw new Error('Nested Docker unavailable');
const loaded = await command(['load', '--input', '/opt/alunza/capsule.tar'], {
  timeoutMs: 30000,
});
if (loaded.code !== 0) throw new Error('Prepared capsule import failed');
console.log(
  JSON.stringify({
    image: await imageIdentity(),
    node: process.version,
    ready: true,
    cpuCfsPeriod:
      typeof server.CpuCfsPeriod === 'boolean' ? server.CpuCfsPeriod : null,
    cpuCfsQuota:
      typeof server.CpuCfsQuota === 'boolean' ? server.CpuCfsQuota : null,
  }),
);
