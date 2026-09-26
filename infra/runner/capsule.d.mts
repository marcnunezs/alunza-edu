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
  },
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  stopped: boolean;
}>;
export function imageIdentity(image?: string): Promise<string>;
export function runCapsule(
  input: {
    code: string;
    args: unknown[];
    budgetMs: number;
    outputRemaining: number;
  },
  options?: { image?: string; signal?: AbortSignal },
): Promise<{
  packet: unknown;
  exitCode: number | null;
  oomKilled: boolean;
  timedOut: boolean;
  cancelled: boolean;
  cleanupVerified: boolean;
  programWallMs: number;
  lifecycleMs: number;
  image: string;
}>;
export function collectExpired(): Promise<number>;
