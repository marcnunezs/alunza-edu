import type { TimingObserver } from './timing.mjs';
export type { TimingEvent, TimingObserver } from './timing.mjs';

export const OWNER_LABEL: string;
export const IMAGE_TAG: string;
export const RUNNER_PREFIX: string;
export function command(
  args: string[],
  options?: {
    input?: string;
    timeoutMs?: number;
    maxBytes?: number;
    signal?: AbortSignal;
    dockerHost?: string;
    apiVersion?: string;
  },
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  stopped: boolean;
}>;
export function imageIdentity(
  image?: string,
  signal?: AbortSignal,
): Promise<string>;
export function runCapsule(
  input: {
    executionId: string;
    code: string;
    args: unknown[];
    budgetMs: number;
    outputRemaining: number;
  },
  options?: {
    image?: string;
    signal?: AbortSignal;
    observeTiming?: TimingObserver;
    probe?:
      | 'identity'
      | 'memory'
      | 'descendant-memory'
      | 'processes'
      | 'network'
      | 'permissions';
  },
): Promise<{
  packet: unknown;
  exitCode: number | null;
  oomKilled: boolean;
  timedOut: boolean;
  cancelled: boolean;
  cleanupVerified: boolean;
  programWallMs: number;
  containerWallMs: number | null;
  lifecycleMs: number;
  image: string;
}>;
export function collectExpired(
  signal?: AbortSignal,
  observation?: { nowMs: number; containerIds: string[] },
): Promise<number>;
export function sweepExpiredDockerExecutions(
  signal?: AbortSignal,
): Promise<{ cleanupVerified: boolean; removed: number }>;
export function getDockerAvailability(
  signal?: AbortSignal,
): Promise<{ available: boolean; image: string | null }>;
export function cleanupDockerExecution(
  executionId: string,
  signal?: AbortSignal,
): Promise<{ cleanupVerified: boolean; removed: number }>;
