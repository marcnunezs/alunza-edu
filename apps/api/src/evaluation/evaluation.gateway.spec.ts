import { EvaluationGateway } from './evaluation.gateway';
import { EvaluationRepository } from './evaluation.repository';
import { EvaluationCallError } from './evaluation.types';
import type { EvaluationCallSpec } from './evaluation.types';
import type { AiSettlementObserver } from '@alunza/ai';
import {
  evaluationCostMicroUsd,
  evaluationManifestSchema,
} from '@alunza/contracts';

const spec: EvaluationCallSpec = {
  owner: { kind: 'MATERIAL', id: 'a', token: 'lease' },
  phase: 'EMBEDDING',
  logicalKey: 'batch:0',
  inputHash: 'a'.repeat(64),
  configuration: { id: 'test', model: 'test', dimensions: 3 },
  reservedInputTokens: 10,
  maxOutputTokens: 0,
};
const event = {
  phase: 'EMBEDDING' as const,
  outcome: 'RESPONSE' as const,
  settledAt: '2026-10-01T01:00:00.000Z',
  aborted: false,
  model: 'test',
  usage: { inputTokens: 8 },
};
function fixture() {
  const repository = {
    reserve: jest.fn().mockResolvedValue({
      state: 'DISPATCH',
      callId: 'call',
      dispatchToken: 'token',
    }),
    observe: jest.fn().mockResolvedValue(true),
    complete: jest.fn().mockResolvedValue(true),
    canContinue: jest.fn().mockResolvedValue(true),
  };
  return {
    repository,
    gateway: new EvaluationGateway(
      repository as unknown as EvaluationRepository,
      { enabled: true, operationsPort: 4401 },
    ),
  };
}
describe('durable AI dispatch gateway', () => {
  test('commits reservation before invoking provider and result before returning', async () => {
    const { repository, gateway } = fixture();
    const invoke = jest.fn(async (observe: AiSettlementObserver) => {
      await observe(event);
      return [[1, 0, 0]];
    });
    await expect(gateway.execute(spec, invoke)).resolves.toEqual([[1, 0, 0]]);
    expect(repository.reserve).toHaveBeenCalledWith(spec, true);
    expect(repository.reserve.mock.invocationCallOrder[0]!).toBeLessThan(
      invoke.mock.invocationCallOrder[0]!,
    );
    expect(repository.observe.mock.invocationCallOrder[0]!).toBeLessThan(
      repository.complete.mock.invocationCallOrder[0]!,
    );
  });
  test.each(['STOP', 'ERROR'])(
    '%s never invokes a second provider request',
    async (state) => {
      const { repository, gateway } = fixture();
      repository.reserve.mockResolvedValue({
        state,
        callId: 'call',
        failure: { code: 'INVALID_RESPONSE', retryable: false },
      });
      const invoke = jest.fn();
      await expect(gateway.execute(spec, invoke)).rejects.toBeInstanceOf(
        EvaluationCallError,
      );
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  test('replays the durable result without a provider call', async () => {
    const { repository, gateway } = fixture();
    repository.reserve.mockResolvedValue({
      state: 'COMPLETED',
      callId: 'call',
      result: { vectors: [[1, 0, 0]] },
    });
    const invoke = jest.fn();
    await expect(gateway.execute(spec, invoke)).resolves.toEqual({
      vectors: [[1, 0, 0]],
    });
    expect(invoke).not.toHaveBeenCalled();
  });
  test('reservation failure never dispatches', async () => {
    const { repository, gateway } = fixture();
    repository.reserve.mockRejectedValue(new Error('quota'));
    const invoke = jest.fn();
    await expect(gateway.execute(spec, invoke)).rejects.toThrow('quota');
    expect(invoke).not.toHaveBeenCalled();
  });
  test('unknown transport failure retains unknown exposure instead of a retryable error', async () => {
    const { repository, gateway } = fixture();
    await expect(
      gateway.execute(spec, async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
    expect(repository.complete).toHaveBeenCalledWith(
      'call',
      'token',
      undefined,
      undefined,
    );
  });
  test('confirmed HTTP throttling records bounded retry metadata', async () => {
    const { repository, gateway } = fixture();
    await expect(
      gateway.execute(spec, async (observe) => {
        await observe({
          ...event,
          outcome: 'ERROR',
          httpStatus: 429,
          retryable: true,
        });
        throw Object.assign(new Error('throttle'), {
          code: 'EMBEDDING_RATE_LIMIT',
          retryable: true,
          retryAfterMs: 999999,
        });
      }),
    ).rejects.toThrow('throttle');
    expect(repository.complete).toHaveBeenCalledWith(
      'call',
      'token',
      undefined,
      { code: 'EMBEDDING_RATE_LIMIT', retryable: true, retryAfterMs: 300000 },
    );
  });
  test('records a late observation after invocation has already failed', async () => {
    const { repository, gateway } = fixture();
    let observeLater: AiSettlementObserver | undefined;
    await expect(
      gateway.execute(spec, async (observe) => {
        observeLater = observe;
        throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');
    await observeLater!({ ...event, aborted: true });
    expect(repository.observe).toHaveBeenCalledWith('call', 'token', {
      ...event,
      aborted: true,
    });
    expect(repository.complete).toHaveBeenCalledTimes(1);
  });
  test('loss of permission after response preserves accounting but suppresses delivery', async () => {
    const { repository, gateway } = fixture();
    repository.canContinue.mockResolvedValue(false);
    await expect(
      gateway.execute(spec, async () => ({ vectors: [[1, 0, 0]] })),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(repository.complete).toHaveBeenCalledTimes(1);
  });
  test('a lost result commit is not converted into another call', async () => {
    const { repository, gateway } = fixture();
    repository.complete.mockRejectedValue(new Error('commit unknown'));
    const invoke = jest.fn().mockResolvedValue({ vectors: [[1, 0, 0]] });
    await expect(gateway.execute(spec, invoke)).rejects.toThrow(
      'commit unknown',
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  test('ledger remains mandatory for ordinary product mode', async () => {
    const { repository } = fixture();
    const gateway = new EvaluationGateway(
      repository as unknown as EvaluationRepository,
      { enabled: false, operationsPort: 4401 },
    );
    await gateway.execute(spec, async () => 1);
    expect(repository.reserve).toHaveBeenCalledWith(spec, false);
  });
});
describe('exact evaluation monetary contract', () => {
  test('rounds only the full numerator upward to one microdollar', () => {
    expect(evaluationCostMicroUsd(1, 1, '1', '1')).toBe('1');
    expect(evaluationCostMicroUsd(1, 0, '1000001', '0')).toBe('2');
    expect(evaluationCostMicroUsd(0, 0, '999999999999999999999999', '0')).toBe(
      '0',
    );
  });
  test('does not lose precision beyond JavaScript safe integers', () => {
    expect(evaluationCostMicroUsd(1000000, 0, '9007199254740993', '0')).toBe(
      '9007199254740993',
    );
  });
  test.each([-1, 0.5, Infinity])('rejects unsafe token count %s', (value) =>
    expect(() => evaluationCostMicroUsd(value, 0, '1', '0')).toThrow(),
  );
  test.each(['-1', '0.1', '1e3', 'NaN'])(
    'rejects noninteger price %s',
    (value) => expect(() => evaluationCostMicroUsd(1, 0, value, '0')).toThrow(),
  );
  test('authorization requires all immutable scope, profile and budget fields', () => {
    expect(
      evaluationManifestSchema.safeParse({
        version: 1,
        environment: 'TEST',
        provider: 'AZURE',
      }).success,
    ).toBe(false);
  });
});
