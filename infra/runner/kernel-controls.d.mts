export function verifyKernelControls(
  engine: {
    endpoint: string;
    request(
      method: string,
      path: string,
      options: { signal?: AbortSignal },
    ): Promise<{ status: number; data?: unknown }>;
  },
  expected: {
    engineId: string;
    id: string;
    pid?: number;
    expectedBoundary?: string;
    signal?: AbortSignal;
  },
): Promise<string>;
