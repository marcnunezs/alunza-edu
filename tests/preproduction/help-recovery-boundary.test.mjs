import { test, expect } from '@jest/globals';
import { helpRecoveryBoundaryReached } from '../../scripts/help-recovery.mjs';

const running = { lifecycle_status: 'RUNNING' };
const receipt = (phase, state = 'COMPLETED', result = {}) => ({
  phase,
  state,
  result,
});
const completed = (phase) => ({ phase, state: 'COMPLETED' });

test('a dispatched help checkpoint cannot stop the API before its ledger result is durable', () => {
  const boundary = {
    scenario: { phase: 'EMBEDDING', operation: 'UPDATE', completed: 0 },
    row: running,
    checkpoint: [{ phase: 'EMBEDDING', state: 'DISPATCHED' }],
    faultHits: 2,
    baseline: 1,
  };
  expect(
    helpRecoveryBoundaryReached({
      ...boundary,
      ledger: [receipt('EMBEDDING', 'DISPATCHED', null)],
    }),
  ).toBe(false);
  expect(
    helpRecoveryBoundaryReached({
      ...boundary,
      ledger: [receipt('EMBEDDING', 'COMPLETED', null)],
    }),
  ).toBe(false);
  expect(
    helpRecoveryBoundaryReached({
      ...boundary,
      ledger: [receipt('EMBEDDING')],
    }),
  ).toBe(true);
});

test.each([
  [{ phase: 'EMBEDDING', operation: 'INSERT', completed: 0 }, [], []],
  [
    { phase: 'EMBEDDING', operation: 'UPDATE', completed: 0 },
    [{ phase: 'EMBEDDING', state: 'DISPATCHED' }],
    [receipt('EMBEDDING')],
  ],
  [
    { phase: 'REVIEW', operation: 'INSERT', completed: 2 },
    [completed('EMBEDDING'), completed('GENERATION')],
    [receipt('EMBEDDING'), receipt('GENERATION')],
  ],
  [
    { phase: 'PUBLICATION', operation: 'INSERT', completed: 3 },
    [completed('EMBEDDING'), completed('GENERATION'), completed('REVIEW')],
    [receipt('EMBEDDING'), receipt('GENERATION'), receipt('REVIEW')],
  ],
  [
    { phase: 'LEDGER', operation: 'UPDATE', completed: 0 },
    [{ phase: 'EMBEDDING', state: 'DISPATCHED' }],
    [receipt('EMBEDDING', 'DISPATCHED', null)],
  ],
])(
  'the %j recovery boundary requires its own trigger hit after the scenario baseline',
  (scenario, checkpoint, ledger) => {
    const boundary = {
      scenario,
      row: running,
      checkpoint,
      ledger,
      baseline: 5,
    };
    expect(helpRecoveryBoundaryReached({ ...boundary, faultHits: 5 })).toBe(
      false,
    );
    expect(
      helpRecoveryBoundaryReached({ ...boundary, faultHits: undefined }),
    ).toBe(false);
    expect(helpRecoveryBoundaryReached({ ...boundary, faultHits: 6 })).toBe(
      true,
    );
    expect(
      helpRecoveryBoundaryReached({
        ...boundary,
        row: { lifecycle_status: 'SUCCEEDED' },
        faultHits: 6,
      }),
    ).toBe(false);
  },
);

test('real uncertainty requires a dispatched ledger receipt without a result', () => {
  const boundary = {
    scenario: { phase: 'LEDGER', operation: 'UPDATE', completed: 0 },
    row: running,
    checkpoint: [{ phase: 'EMBEDDING', state: 'DISPATCHED' }],
    faultHits: 1,
    baseline: 0,
  };
  expect(
    helpRecoveryBoundaryReached({
      ...boundary,
      ledger: [receipt('EMBEDDING')],
    }),
  ).toBe(false);
  expect(
    helpRecoveryBoundaryReached({
      ...boundary,
      ledger: [receipt('EMBEDDING', 'DISPATCHED', {})],
    }),
  ).toBe(false);
  expect(
    helpRecoveryBoundaryReached({
      ...boundary,
      ledger: [receipt('EMBEDDING', 'DISPATCHED', null)],
    }),
  ).toBe(true);
});
