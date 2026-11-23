export function shouldRecoverProgressCaptures(input: {
  failed: boolean;
  hasContext: boolean;
  testTitle?: string;
  error?: unknown;
  measurement: {
    surface: string;
    concurrency: number;
    startedAt: number | null;
    firstNavigationValid: boolean;
    firstNavigationMs: number | null;
    samples: { durationMs: number; valid: boolean }[];
    p95GateMs?: number;
  } | null;
}): boolean;
