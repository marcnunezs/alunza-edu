/* eslint @typescript-eslint/no-require-imports: "off" */
const { EventEmitter } = require('node:events');
const processTools = require('node:child_process');
const {
  watchWindowsResidentBytes,
} = require('../../packages/ai/dist/resident-monitor');

let child;
beforeEach(() => {
  jest.useFakeTimers();
  child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = jest.fn(() => child.stdout);
  child.kill = jest.fn(() => true);
  jest.spyOn(processTools, 'spawn').mockReturnValue(child);
});
afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
const begin = () => {
  const sample = jest.fn(),
    unavailable = jest.fn();
  const close = watchWindowsResidentBytes(
    1234,
    { NODE_ENV: 'production', SystemRoot: 'C:\\Windows' },
    sample,
    unavailable,
  );
  return { sample, unavailable, close };
};

test('uses one hidden external process for successive exact byte samples and closes it once', () => {
  const watch = begin();
  child.stdout.emit('data', '536870912\r\n');
  jest.advanceTimersByTime(500);
  child.stdout.emit('data', '536870913\n');
  expect(watch.sample.mock.calls).toEqual([[536870912], [536870913]]);
  expect(processTools.spawn).toHaveBeenCalledTimes(1);
  const [, args, options] = processTools.spawn.mock.calls[0];
  expect(args[3]).toContain('GetProcessById(1234)');
  expect(args[3]).toContain('$null=$observed.Handle');
  expect(args[3]).toContain('Sleep(500)');
  expect(args[3]).not.toContain('Get-Process');
  expect(options).toMatchObject({
    windowsHide: true,
    env: { NODE_ENV: 'production', SystemRoot: 'C:\\Windows' },
  });
  watch.close();
  watch.close();
  child.emit('close', 1);
  child.stdout.emit('data', '1\n');
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(watch.unavailable).not.toHaveBeenCalled();
  expect(watch.sample).toHaveBeenCalledTimes(2);
});

test('startup remains bounded by exactly two seconds', () => {
  const watch = begin();
  jest.advanceTimersByTime(1999);
  expect(watch.unavailable).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(watch.unavailable).toHaveBeenCalledTimes(1);
  expect(child.kill).toHaveBeenCalledTimes(1);
});

test('each complete sample renews the same watchdog; partial data does not', () => {
  const watch = begin();
  jest.advanceTimersByTime(1000);
  child.stdout.emit('data', '57');
  child.stdout.emit('data', '049088\r\n');
  expect(watch.sample).toHaveBeenCalledWith(57049088);
  jest.advanceTimersByTime(1999);
  child.stdout.emit('data', '57049088');
  expect(watch.unavailable).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(watch.unavailable).toHaveBeenCalledTimes(1);
});

test.each([
  '0\n',
  '-1\n',
  '1.5\n',
  'RSS=512\n',
  '\n',
  '9'.repeat(65),
  '9007199254740992\n',
  '1\n'.repeat(4097),
])('malformed or excessive monitor output fails closed: %s', (output) => {
  const watch = begin();
  child.stdout.emit('data', output);
  expect(watch.unavailable).toHaveBeenCalledTimes(1);
  expect(child.kill).toHaveBeenCalledTimes(1);
});

test.each(['error', 'close'])(
  'unexpected helper %s fails closed and releases the watchdog',
  (event) => {
    const watch = begin();
    child.emit(event, event === 'error' ? new Error('private diagnostic') : 0);
    expect(watch.unavailable).toHaveBeenCalledTimes(1);
    expect(watch.unavailable).toHaveBeenCalledWith();
    expect(child.kill).toHaveBeenCalledTimes(1);
  },
);

test('observed parser exit awaits the parent close event without a false monitor failure', () => {
  const watch = begin();
  child.stdout.emit('data', '57049088\nEXIT\n');
  child.emit('close', 0);
  jest.advanceTimersByTime(30000);
  watch.close();
  expect(watch.unavailable).not.toHaveBeenCalled();
  expect(child.kill).toHaveBeenCalledTimes(1);
});

test('an invalid pid cannot become interpolated command text', () => {
  const unavailable = jest.fn();
  watchWindowsResidentBytes('1; exit', {}, jest.fn(), unavailable)();
  expect(processTools.spawn).not.toHaveBeenCalled();
  expect(unavailable).toHaveBeenCalledTimes(1);
});
