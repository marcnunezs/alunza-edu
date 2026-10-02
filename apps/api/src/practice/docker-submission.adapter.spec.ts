import type { ExecutionResult } from '@alunza/runner';
import { projectSubmission } from './docker-submission.adapter';
import type { SubmissionExecutionInput } from './submission-execution.port';

const input: SubmissionExecutionInput = {
  executionId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  exerciseVersionId: '10000000-0000-4000-8000-000000000003',
  testsVersion: 'a'.repeat(64),
  mode: 'SUBMIT',
  entrypoint: 'solve',
  code: 'module.exports.solve=n=>n;',
  tests: [
    { id: 'visible', visibility: 'visible', args: [1], expected: 1 },
    {
      id: 'hidden-private-id',
      visibility: 'hidden',
      args: ['hidden-private-argument'],
      expected: 'hidden-private-expectation',
    },
  ],
};
const makeResult = (patch: Partial<ExecutionResult> = {}): ExecutionResult =>
  ({
    executionId: input.executionId,
    runnerVersion: 'unit',
    diagnosisCode: 'SUCCESS',
    terminationReason: 'COMPLETED',
    infrastructureStatus: 'OK',
    allRequiredPassed: true,
    visibleTestResults: [
      { id: 'visible', passed: true, stdout: 'visible output', stderr: '' },
    ],
    privateTestResults: [
      {
        id: 'hidden-private-id',
        passed: true,
        stdout: 'hidden-private-argument',
        stderr: 'hidden-private-stack',
      },
    ],
    hiddenRequiredCount: 1,
    outputTruncated: false,
    outputBytes: 56,
    runtimeMs: 20,
    lifecycleMs: 30,
    ...patch,
  }) as ExecutionResult;

describe('SUBMIT private result projection', () => {
  it('persists only hidden boolean evidence and publishes only visible console bytes', () => {
    const result = projectSubmission(input, makeResult(), 'unit');
    expect(result.technicalResult).toMatchObject({
      diagnosisCode: 'SUCCESS',
      hiddenChecksPassed: true,
      allRequiredPassed: true,
      visiblePassed: 1,
      visibleTotal: 1,
      outputBytes: 14,
    });
    expect(JSON.stringify(result.technicalResult)).not.toContain(
      'hidden-private',
    );
    expect(result.privateTestResults).toEqual([
      { id: 'hidden-private-id', passed: true },
    ]);
    expect(JSON.stringify(result)).not.toContain('hidden-private-argument');
    expect(JSON.stringify(result)).not.toContain('hidden-private-stack');
    expect(JSON.stringify(result)).not.toContain('hidden-private-expectation');
  });
  it('does not complete an exercise when visible cases pass but a hidden case fails', () => {
    const result = projectSubmission(
      input,
      makeResult({
        diagnosisCode: 'FAILED_TEST',
        terminationReason: 'ASSERTION_FAILED',
        allRequiredPassed: false,
        privateTestResults: [
          {
            id: 'hidden-private-id',
            passed: false,
            stdout: 'hidden-private-argument',
            stderr: '',
          },
        ],
      }),
      'unit',
    );
    expect(result.technicalResult).toMatchObject({
      diagnosisCode: 'FAILED_TEST',
      visiblePassed: 1,
      hiddenChecksPassed: false,
      allRequiredPassed: false,
    });
    expect(JSON.stringify(result.technicalResult)).not.toContain(
      'hidden-private',
    );
  });
  it.each([
    { terminationReason: 'COMPLETED' as const },
    { outputTruncated: true },
    { infrastructureStatus: 'FAILED' as const },
  ])('normalizes an invalid FAILED_TEST before durable staging %#', (patch) => {
    const result = projectSubmission(
      input,
      makeResult({
        diagnosisCode: 'FAILED_TEST',
        terminationReason: 'ASSERTION_FAILED',
        allRequiredPassed: false,
        privateTestResults: [
          { id: 'hidden-private-id', passed: false, stdout: '', stderr: '' },
        ],
        ...patch,
      }),
      'unit',
    );
    expect(result.technicalResult).toMatchObject({
      diagnosisCode: 'UNKNOWN',
      infrastructureStatus: 'FAILED',
      allRequiredPassed: false,
    });
    expect(result.privateTestResults).toEqual([]);
  });
  it.each([
    { privateTestResults: [] },
    { hiddenRequiredCount: 0 },
    { executionId: 'different' },
    { runnerVersion: 'different' },
    {
      privateTestResults: [
        { id: 'forged', passed: true, stdout: '', stderr: '' },
      ],
    },
    {
      visibleTestResults: [
        {
          id: 'hidden-private-id',
          passed: true,
          stdout: 'hidden-private-argument',
          stderr: '',
        },
      ],
    },
    {
      visibleTestResults: [
        { id: 'visible', passed: true, stdout: '', stderr: '' },
        { id: 'visible', passed: true, stdout: '', stderr: '' },
      ],
    },
    { allRequiredPassed: false },
    {
      diagnosisCode: 'FAILED_TEST',
      terminationReason: 'ASSERTION_FAILED',
      allRequiredPassed: false,
    },
  ] as Partial<ExecutionResult>[])(
    'rejects inconsistent execution evidence %#',
    (patch) => {
      const result = projectSubmission(input, makeResult(patch), 'unit');
      expect(result.technicalResult).toMatchObject({
        diagnosisCode: 'UNKNOWN',
        infrastructureStatus: 'FAILED',
        visibleTestResults: [],
        hiddenChecksPassed: null,
        allRequiredPassed: false,
      });
      expect(result.privateTestResults).toEqual([]);
    },
  );
  it.each([
    ['SYNTAX_ERROR', 'STUDENT_SYNTAX'],
    ['RUNTIME_ERROR', 'STUDENT_EXCEPTION'],
    ['TIMEOUT', 'EXECUTION_DEADLINE'],
    ['UNKNOWN', 'MEMORY_LIMIT'],
  ] as const)(
    'keeps partial %s without claiming hidden completion',
    (diagnosisCode, terminationReason) => {
      const result = projectSubmission(
        input,
        makeResult({
          diagnosisCode,
          terminationReason,
          allRequiredPassed: false,
          privateTestResults: [],
        }),
        'unit',
      );
      expect(result.technicalResult).toMatchObject({
        diagnosisCode,
        hiddenChecksPassed: null,
        allRequiredPassed: false,
      });
    },
  );
  it('represents the absence of hidden tests as null, with visible-only completion allowed', () => {
    const result = projectSubmission(
      { ...input, tests: input.tests.slice(0, 1) },
      makeResult({ privateTestResults: [], hiddenRequiredCount: 0 }),
      'unit',
    );
    expect(result.technicalResult).toMatchObject({
      diagnosisCode: 'SUCCESS',
      hiddenChecksPassed: null,
      allRequiredPassed: true,
    });
  });
  it('replaces forbidden JSONB NUL without altering output byte budget', () => {
    const result = projectSubmission(
      input,
      makeResult({
        visibleTestResults: [
          { id: 'visible', passed: true, stdout: 'a\0b', stderr: '' },
        ],
      }),
      'unit',
    );
    expect(result.technicalResult.visibleTestResults[0]?.stdout).toBe('a?b');
    expect(result.technicalResult.outputBytes).toBe(3);
  });
});
