import { z } from 'zod';
import {
  signalRuleActivateSchema,
  signalRuleCreateSchema,
  type SignalRuleCreate,
  type SignalRuleVersion,
} from '@alunza/contracts';

export const ruleTypeLabels = {
  INACTIVITY: 'Inactividad',
  REPEATED_ERROR: 'Error repetido',
  STAGNATION: 'Estancamiento',
} as const;
export const ruleStateLabels = {
  DRAFT: 'Borrador',
  ACTIVE: 'Vigente',
  RETIRED: 'Retirada',
} as const;
export type RuleType = SignalRuleCreate['type'];
export type RuleScope = { userId: string; organizationId: string };
const scopeSchema = z.strictObject({
  userId: z.uuid(),
  organizationId: z.uuid(),
});
const common = {
  formatVersion: z.literal(1),
  ...scopeSchema.shape,
  key: z.uuid(),
};
export const pendingRuleOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    ...common,
    operation: z.literal('create'),
    payload: signalRuleCreateSchema,
  }),
  z.strictObject({
    ...common,
    operation: z.literal('activate'),
    versionId: z.uuid(),
    payload: signalRuleActivateSchema,
  }),
]);
export type PendingRuleOperation = z.infer<typeof pendingRuleOperationSchema>;
export type RuleOperationInput =
  | { operation: 'create'; payload: SignalRuleCreate }
  | {
      operation: 'activate';
      versionId: string;
      payload: z.infer<typeof signalRuleActivateSchema>;
    };
export type RuleStorageRead =
  | { status: 'empty' }
  | { status: 'ready'; operation: PendingRuleOperation }
  | { status: 'unavailable' | 'invalid' };
type RuleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function ruleOperationKey(scope: RuleScope) {
  scopeSchema.parse({
    userId: scope.userId,
    organizationId: scope.organizationId,
  });
  return `alunza:signal-rule-operation:v1:${scope.userId}:${scope.organizationId}`;
}

// Local content is untrusted. Paths and credentials are never persisted.
export function readRuleOperation(
  storage: RuleStorage,
  scope: RuleScope,
): RuleStorageRead {
  try {
    const raw = storage.getItem(ruleOperationKey(scope));
    if (raw === null) return { status: 'empty' };
    if (raw.length > 16_384) return { status: 'invalid' };
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return { status: 'invalid' };
    }
    const parsed = pendingRuleOperationSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.userId !== scope.userId ||
      parsed.data.organizationId !== scope.organizationId
    )
      return { status: 'invalid' };
    return { status: 'ready', operation: parsed.data };
  } catch {
    return { status: 'unavailable' };
  }
}

export function saveRuleOperation(
  storage: RuleStorage,
  operation: PendingRuleOperation,
): boolean {
  try {
    const validated = pendingRuleOperationSchema.parse(operation);
    const before = readRuleOperation(storage, validated);
    if (
      before.status !== 'empty' &&
      !(
        before.status === 'ready' &&
        JSON.stringify(before.operation) === JSON.stringify(validated)
      )
    )
      return false;
    storage.setItem(ruleOperationKey(validated), JSON.stringify(validated));
    const after = readRuleOperation(storage, validated);
    return (
      after.status === 'ready' &&
      JSON.stringify(after.operation) === JSON.stringify(validated)
    );
  } catch {
    return false;
  }
}

export function clearRuleOperation(
  storage: RuleStorage,
  operation: PendingRuleOperation,
): boolean {
  try {
    const current = readRuleOperation(storage, operation);
    if (current.status === 'empty') return true;
    if (
      current.status !== 'ready' ||
      JSON.stringify(current.operation) !== JSON.stringify(operation)
    )
      return false;
    storage.removeItem(ruleOperationKey(operation));
    return readRuleOperation(storage, operation).status === 'empty';
  } catch {
    return false;
  }
}

export function ruleOperationRequest(input: PendingRuleOperation) {
  const operation = pendingRuleOperationSchema.parse(input);
  return {
    path:
      operation.operation === 'create'
        ? `/api/v1/organizations/${operation.organizationId}/signal-rules`
        : `/api/v1/signal-rules/${operation.versionId}/activate`,
    body: operation.payload,
    idempotencyKey: operation.key,
  };
}

// Authentication/authorization errors cannot settle an earlier uncertain commit.
export function isRuleOperationTerminalFailure(error: {
  status: number;
  code: string;
}) {
  return (
    (error.status === 422 && error.code === 'VALIDATION_FAILED') ||
    (error.status === 409 &&
      ['RULE_VERSION_CONFLICT', 'RULE_VERSION_ALREADY_ACTIVATED'].includes(
        error.code,
      ))
  );
}

export function ruleFormInput(type: RuleType, form: FormData): unknown {
  const number = (name: string) => {
    const value = form.get(`parameters.${name}`);
    return typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : undefined;
  };
  const parameters =
    type === 'INACTIVITY'
      ? { inactivityDays: number('inactivityDays') }
      : type === 'REPEATED_ERROR'
        ? {
            repeatedErrorAttempts: number('repeatedErrorAttempts'),
            repeatedErrorWindowDays: number('repeatedErrorWindowDays'),
          }
        : { stagnationAttempts: number('stagnationAttempts') };
  return { type, schemaVersion: 1, algorithmVersion: 'DEC005_V1', parameters };
}

export function ruleParametersLabel(
  rule: SignalRuleCreate | SignalRuleVersion,
): string {
  switch (rule.type) {
    case 'INACTIVITY':
      return `${rule.parameters.inactivityDays} días sin actividad elegible`;
    case 'REPEATED_ERROR':
      return `${rule.parameters.repeatedErrorAttempts} intentos en ${rule.parameters.repeatedErrorWindowDays} días`;
    case 'STAGNATION':
      return `${rule.parameters.stagnationAttempts} intentos sin aumento; sin ventana adicional`;
  }
}
