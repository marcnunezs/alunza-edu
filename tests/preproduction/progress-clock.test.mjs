import { jest, test, expect } from '@jest/globals';
import {
  instantMicros,
  progressAfterPublications,
} from '../e2e/progress-clock.mjs';

test('a backwards fixture clock waits for the upper publication bound, preserving microseconds', async () => {
  const read = jest
    .fn()
    .mockResolvedValueOnce({ asOf: '2026-10-25T23:35:59.875485Z', required: 3 })
    .mockResolvedValueOnce({ asOf: '2026-10-25T23:35:59.989999Z', required: 3 })
    .mockResolvedValueOnce({
      asOf: '2026-10-25T23:35:59.990000Z',
      required: 4,
    });
  await expect(
    progressAfterPublications(read, ['2026-10-25T23:35:59.989Z']),
  ).resolves.toEqual({
    asOf: '2026-10-25T23:35:59.990000Z',
    required: 4,
  });
  expect(read).toHaveBeenCalledTimes(3);
  expect(instantMicros('2026-10-25T20:35:59.989999-03:00')).toBe(
    instantMicros('2026-10-25T23:35:59.990000Z') - 1n,
  );
});

test('an incorrect count after the temporal barrier is returned immediately for assertion, never retried', async () => {
  const result = { asOf: '2026-10-25T23:36:00.000001Z', required: 3 };
  const read = jest.fn().mockResolvedValue(result);
  expect(
    await progressAfterPublications(read, ['2026-10-25T23:35:59.989Z']),
  ).toBe(result);
  expect(read).toHaveBeenCalledTimes(1);
});

test('a clock that never catches up fails within the declared number of reads', async () => {
  const read = jest
    .fn()
    .mockResolvedValue({ asOf: '2026-10-25T23:35:59.000000Z' });
  await expect(
    progressAfterPublications(read, ['2026-10-25T23:35:59.989Z'], 3),
  ).rejects.toThrow('Server clock');
  expect(read).toHaveBeenCalledTimes(3);
});

test('a failed real read is not retried or substituted', async () => {
  const read = jest.fn().mockRejectedValue(new Error('Unavailable'));
  await expect(
    progressAfterPublications(read, ['2026-10-25T23:35:59.989Z']),
  ).rejects.toThrow('Unavailable');
  expect(read).toHaveBeenCalledTimes(1);
});

test('missing publication metadata fails before querying', () => {
  const read = jest.fn();
  expect(() => progressAfterPublications(read, [null])).toThrow(
    'Published fixture',
  );
  expect(read).not.toHaveBeenCalled();
});
