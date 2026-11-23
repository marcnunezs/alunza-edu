import {
  normalizeSignalInstant,
  signalDeadlineMicroseconds,
  signalInstantFromMicroseconds,
  signalMicroseconds,
} from './signal-time';

describe('signal operational time', () => {
  it('preserves UTC microseconds across offsets and the Unix epoch', () => {
    expect(normalizeSignalInstant('2026-10-02T09:00:00.000001-03:00')).toBe(
      '2026-10-02T12:00:00.000001Z',
    );
    for (const value of [
      '0000-01-01T00:00:00.000000Z',
      '1969-12-31T23:59:59.999999Z',
      '1970-01-01T00:00:00.000000Z',
      '2026-10-02T12:00:00.000001Z',
      '9999-12-31T23:59:59.999999Z',
    ])
      expect(signalInstantFromMicroseconds(signalMicroseconds(value))).toBe(
        value,
      );
  });

  it('distinguishes inclusive maturity from the first expired microsecond', () => {
    const anchor = '2026-09-25T12:00:00.000000Z';
    expect(
      signalInstantFromMicroseconds(
        BigInt(signalDeadlineMicroseconds(anchor, 7, 'INACTIVITY_DUE')),
      ),
    ).toBe('2026-10-02T12:00:00.000000Z');
    expect(
      signalInstantFromMicroseconds(
        BigInt(signalDeadlineMicroseconds(anchor, 14, 'REPETITION_EXPIRES')),
      ),
    ).toBe('2026-10-09T12:00:00.000001Z');
  });

  it('retains int4 maximum deadlines exactly without overflowing a timestamp', () => {
    const anchor = '2026-10-02T12:00:00.123456Z';
    const actual = signalDeadlineMicroseconds(
      anchor,
      2_147_483_647,
      'INACTIVITY_DUE',
    );
    expect(BigInt(actual) - signalMicroseconds(anchor)).toBe(
      185_542_587_100_800_000_000n,
    );
    expect(signalInstantFromMicroseconds(BigInt(actual))).toBeNull();
    expect(
      BigInt(
        signalDeadlineMicroseconds(anchor, 2_147_483_647, 'REPETITION_EXPIRES'),
      ),
    ).toBe(BigInt(actual) + 1n);
  });

  it.each([0, -1, 1.5, 2_147_483_648, NaN])('rejects threshold %s', (days) => {
    expect(() =>
      signalDeadlineMicroseconds(
        '2026-10-02T12:00:00Z',
        days,
        'INACTIVITY_DUE',
      ),
    ).toThrow();
  });

  it.each([
    '2026-10-02T12:00:00.0000001Z',
    '2026-02-30T00:00:00Z',
    '2026-10-02T12:00:00',
  ])('rejects invalid instant %s', (value) =>
    expect(() => signalMicroseconds(value)).toThrow(),
  );
});
