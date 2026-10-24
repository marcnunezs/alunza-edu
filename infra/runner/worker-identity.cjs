const fs = require('node:fs');
function assertIdentity() {
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const capabilities = Object.fromEntries(
    status
      .split('\n')
      .filter((line) => /^Cap(Inh|Prm|Eff|Bnd|Amb):/.test(line))
      .map((line) => {
        const [key, value] = line.split(':');
        return [key, value.trim()];
      }),
  );
  let parentReadable = false;
  try {
    fs.accessSync('/proc/1/fd/1', fs.constants.R_OK);
    parentReadable = true;
  } catch {
    /* denied */
  }
  if (
    process.getuid() !== 10001 ||
    Object.keys(capabilities).length !== 5 ||
    Object.values(capabilities).some((value) => value !== '0000000000000000') ||
    !/^NoNewPrivs:\s+1$/m.test(status) ||
    parentReadable
  )
    throw new Error('Identity capability gap');
  return { node: process.version, uid: process.getuid(), capabilities };
}
module.exports = { assertIdentity };
