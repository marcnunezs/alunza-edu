import { z } from 'zod';

/** DEC-005 uses UTC instants with microseconds, never local calendar days. */
export const SIGNAL_DAY_MICROSECONDS = 86_400_000_000n;
export const SIGNAL_MAX_PARAMETER = 2_147_483_647;

const instantSchema = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)/)?.[1]?.length ?? 0) <= 6,
    'Signal instants require at most six fractional digits.',
  );

export function normalizeSignalInstant(value: string): string {
  const valid = instantSchema.parse(value);
  const fraction = valid.match(/\.(\d+)/)?.[1] ?? '';
  return new Date(valid.replace(/\.\d+/, ''))
    .toISOString()
    .replace('.000Z', `.${fraction.padEnd(6, '0')}Z`);
}

export function signalMicroseconds(value: string): bigint {
  const normalized = normalizeSignalInstant(value);
  return (
    BigInt(Date.parse(normalized.replace(/\.\d+/, ''))) * 1000n +
    BigInt(normalized.match(/\.(\d+)/)![1]!)
  );
}

const firstInstant = -62_167_219_200_000_000n;
const lastInstant = 253_402_300_799_999_999n;

/** Large approved int4 thresholds remain exact even beyond ISO/timestamp range. */
export function signalInstantFromMicroseconds(value: bigint): string | null {
  if (value < firstInstant || value > lastInstant) return null;
  const seconds =
    value >= 0n ? value / 1_000_000n : (value - 999_999n) / 1_000_000n;
  const fraction = value - seconds * 1_000_000n;
  return new Date(Number(seconds * 1000n))
    .toISOString()
    .replace('.000Z', `.${fraction.toString().padStart(6, '0')}Z`);
}

export function signalDeadlineMicroseconds(
  anchor: string,
  days: number,
  kind: 'INACTIVITY_DUE' | 'REPETITION_EXPIRES',
): string {
  if (!Number.isInteger(days) || days < 1 || days > SIGNAL_MAX_PARAMETER)
    throw new Error('Invalid signal day threshold.');
  return (
    signalMicroseconds(anchor) +
    BigInt(days) * SIGNAL_DAY_MICROSECONDS +
    (kind === 'REPETITION_EXPIRES' ? 1n : 0n)
  ).toString();
}

export function compareSignalInstants(left: string, right: string): number {
  const a = signalMicroseconds(left);
  const b = signalMicroseconds(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
