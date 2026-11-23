import {
  createSubmitTimingObserver,
  measureSubmitPhase,
} from './submit-observability';
import type {
  SubmitTimingContext,
  SubmitTimingObserver,
} from './submit-observability';

/** Reuse the bounded TEST observer while keeping RUN diagnostics distinct. */
export function createRunTimingObserver(
  environment: string,
  context: SubmitTimingContext,
  flag = process.env.ALUNZA_TEST_SUBMIT_TIMINGS,
  output: (line: string) => void = (line) => console.log(line),
): SubmitTimingObserver | undefined {
  return createSubmitTimingObserver(environment, context, flag, (line) => {
    const value = JSON.parse(line) as Record<string, unknown>;
    value.event =
      value.event === 'TEST_SUBMIT_CLOCK'
        ? 'TEST_RUN_CLOCK'
        : 'TEST_RUN_TIMING';
    if ('source' in value) value.source = 'run';
    return output(JSON.stringify(value));
  });
}
export const measureRunPhase = measureSubmitPhase;
