// Fixed diagnostics for developer tooling only. Never loads student code.
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { assertIdentity } = require('./worker-identity.cjs');
async function main() {
  const identity = assertIdentity();
  const probe = process.argv[2];
  if (probe === 'identity') return identity;
  if (probe === 'memory') {
    const blocks = [];
    for (;;) blocks.push(Buffer.alloc(8 * 1024 * 1024, 1));
  }
  if (probe === 'descendant-memory') {
    spawnSync(
      process.execPath,
      ['-e', 'const a=[];for(;;)a.push(Buffer.alloc(8*1024*1024,1));'],
      { stdio: 'ignore' },
    );
    return true;
  }
  if (probe === 'processes') {
    const children = [],
      errors = [];
    for (let index = 0; index < 40; index++) {
      const child = spawn('/bin/sleep', ['5'], { stdio: 'ignore' });
      child.on('error', (error) => errors.push(error.code));
      children.push(child);
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const live = children.filter((child) => Number.isInteger(child.pid));
      const identitiesValid = live.every((child) => {
        const status = fs.readFileSync(
          '/proc/' + child.pid + '/status',
          'utf8',
        );
        const caps = status
          .split('\n')
          .filter((line) => /^Cap(Inh|Prm|Eff|Bnd|Amb):/.test(line));
        return (
          /^Uid:\s+10001\s+10001\s+10001\s+10001$/m.test(status) &&
          caps.length === 5 &&
          caps.every((line) => line.split(':')[1].trim() === '0000000000000000')
        );
      });
      return {
        attempted: 40,
        started: live.length,
        eagain: errors.filter((error) => error === 'EAGAIN').length,
        unexpectedErrors: errors.filter((error) => error !== 'EAGAIN').length,
        identitiesValid,
        pidsMax: Number(fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8')),
        pidsCurrent: Number(
          fs.readFileSync('/sys/fs/cgroup/pids.current', 'utf8'),
        ),
        uid: identity.uid,
      };
    } finally {
      for (const child of children) if (child.pid) child.kill('SIGKILL');
    }
  }
  if (probe === 'network') {
    const dns = require('node:dns'),
      net = require('node:net'),
      dgram = require('node:dgram');
    const result = {
      loopbackOnly: Object.keys(require('node:os').networkInterfaces()).every(
        (name) => name === 'lo',
      ),
    };
    const resolver = new dns.Resolver({ timeout: 100, tries: 1 });
    resolver.setServers(['203.0.113.1']);
    const tcp = net.connect({ host: '2001:db8::1', port: 443 });
    const udp = dgram.createSocket('udp4');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        for (const key of ['dns', 'ipv6', 'udp'])
          result[key] ??= 'PROBE_TIMEOUT';
        resolve();
      }, 500);
      const note = (key, code) => {
        result[key] = code;
        if (result.dns && result.ipv6 && result.udp) {
          clearTimeout(timer);
          resolve();
        }
      };
      resolver.resolve4('alunza-runner.invalid', (error) =>
        note('dns', error?.code ?? 'UNEXPECTED_SUCCESS'),
      );
      tcp.on('error', (error) => note('ipv6', error.code));
      tcp.on('connect', () => note('ipv6', 'UNEXPECTED_SUCCESS'));
      udp.on('error', (error) => note('udp', error.code));
      udp.send(Buffer.from('fixture'), 9, '203.0.113.1', (error) =>
        note('udp', error?.code ?? 'UNEXPECTED_SUCCESS'),
      );
    });
    resolver.cancel();
    tcp.destroy();
    try {
      udp.close();
    } catch {
      /* already closed */
    }
    return result;
  }
  if (probe === 'permissions') {
    const denied = (path) => {
      try {
        fs.readFileSync(path);
        return false;
      } catch (error) {
        return ['EPERM', 'EACCES'].includes(error.code);
      }
    };
    let readonly = false;
    try {
      fs.writeFileSync('/opt/alunza/bridge.cjs', 'changed');
    } catch (error) {
      readonly = ['EROFS', 'EPERM', 'EACCES'].includes(error.code);
    }
    return {
      parentDenied: denied('/proc/1/fd/1') && denied('/proc/1/environ'),
      readonly,
      environment: Object.keys(process.env).sort(),
    };
  }
  throw new Error('Unknown fixed probe');
}
main()
  .then((value) => fs.writeSync(3, JSON.stringify({ kind: 'probe', value })))
  .catch(() => {
    process.exitCode = 71;
  });
