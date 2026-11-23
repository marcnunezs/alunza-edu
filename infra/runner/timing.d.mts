export type TimingEvent = {
  phase: string;
  durationMs: number;
  completed: boolean;
};
export type TimingObserver = (event: TimingEvent) => void;
export function observeDuration(
  observer: TimingObserver | undefined,
  phase: string,
  durationMs: number,
  completed?: boolean,
): void;
export function measureTiming<T>(
  observer: TimingObserver | undefined,
  phase: string,
  operation: () => T | PromiseLike<T>,
): Promise<T>;
export const remoteDriverFailureMarker: 'REMOTE_CAPSULE_FAILED\n';
export type RemoteStartFailureDetail = {
  httpStatus: number | null;
  outcome:
    | 'HTTP_RESPONSE'
    | 'INCOMPLETE_RESPONSE'
    | 'INVALID_RESPONSE'
    | 'RESPONSE_LIMIT'
    | 'SOCKET_ERROR'
    | 'CANCELLED'
    | 'DEADLINE';
  runtimeCause: 'CGROUP' | 'MOUNT' | 'PERMISSION' | null;
  containerState:
    | 'created'
    | 'running'
    | 'paused'
    | 'restarting'
    | 'removing'
    | 'exited'
    | 'dead'
    | 'absent'
    | 'unknown';
  hasStarted: boolean | null;
  oomKilled: boolean | null;
};
export function safeRemoteStartFailureDetail(
  value: unknown,
): RemoteStartFailureDetail | null;
export const remoteDriverExitCodes: Readonly<{
  ARGUMENTS: 64;
  INPUT_STAT: 65;
  INPUT_READ: 66;
  INPUT_DECODE: 67;
  CAPSULE: 68;
  ENGINE_RESOLVE: 69;
  IMAGE_RESOLVE: 70;
  CREATE: 71;
  PRE_INSPECT: 72;
  ATTACH_OUTPUT: 73;
  ATTACH_INPUT: 74;
  START: 75;
  SEND: 76;
  STREAMS: 77;
  WAIT: 78;
  FINAL_STATE: 79;
  CONTAINER_CLEANUP: 80;
  RESULT_ENCODE: 81;
  RESULT_WRITE: 82;
  RESULT_CHOWN: 83;
  INPUT_UNLINK: 84;
  FILE_CLEANUP: 85;
}>;
export function recordDriverFailure(
  observer: ((phase: keyof typeof remoteDriverExitCodes) => void) | undefined,
  phase: keyof typeof remoteDriverExitCodes,
): void;
