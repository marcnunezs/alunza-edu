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
