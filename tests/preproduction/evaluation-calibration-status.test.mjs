import { jest, test, expect } from '@jest/globals';
import { waitForCalibration } from '../../scripts/evaluation-run.mjs';

const harness = (status) => ({
  journal: { value: {}, save: jest.fn(async () => undefined) },
  client: {
    operations: jest.fn(async () => status),
    poll: jest.fn(async (check) => check()),
  },
});

test('failed calibration records the terminal observation before rejecting without waiting for the polling deadline', async () => {
  const context = harness({
    state: 'ACTIVE',
    cases: [
      {
        stage: 'CALIBRATION',
        caseId: 'heldout',
        state: 'FAILED',
        result: { private: 'not exported' },
      },
      { stage: 'EVALUATION', caseId: 'other', state: 'SUCCEEDED' },
    ],
  });
  await expect(waitForCalibration(context)).rejects.toMatchObject({
    code: 'CALIBRATION_FAILED',
  });
  expect(context.client.operations).toHaveBeenCalledTimes(1);
  expect(context.journal.save).toHaveBeenCalledTimes(1);
  expect(context.journal.value.calibrationObservation).toEqual({
    state: 'ACTIVE',
    cases: [{ caseId: 'heldout', state: 'FAILED' }],
  });
});

test('stop wins over a previously recorded calibration artifact', async () => {
  const context = harness({
    state: 'STOPPED',
    cases: [],
    calibrationArtifact: { version: 'old' },
  });
  await expect(waitForCalibration(context)).rejects.toMatchObject({
    code: 'RUN_STOPPED',
  });
  expect(context.journal.value.calibrationObservation.state).toBe('STOPPED');
});

test('unchanged pending observations do not repeatedly rewrite the journal', async () => {
  const context = harness({
    state: 'ACTIVE',
    cases: [{ stage: 'CALIBRATION', caseId: 'train', state: 'RUNNING' }],
  });
  await expect(waitForCalibration(context)).resolves.toBeNull();
  await expect(waitForCalibration(context)).resolves.toBeNull();
  expect(context.journal.save).toHaveBeenCalledTimes(1);
});

test('a completed artifact is returned only after recording the current operational state', async () => {
  const status = {
    state: 'ACTIVE',
    cases: [{ stage: 'CALIBRATION', caseId: 'train', state: 'SUCCEEDED' }],
    calibrationArtifact: { version: 'help-evidence-2' },
  };
  const context = harness(status);
  await expect(waitForCalibration(context)).resolves.toBe(status);
  expect(context.journal.save).toHaveBeenCalledTimes(1);
});
