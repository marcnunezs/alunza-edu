const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('physical host inventory fails closed on missing or virtualized observations without starting a VM', () => {
  const output = execFileSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-B', path.join(__dirname, 'linux-single-execution/test_readiness.py')],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1048576,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  expect(output).toBe('');
});
