'use client';

import { useState, type FormEvent } from 'react';
import {
  signalRuleCreateSchema,
  signalRuleIntegerMaximum,
  type SignalRuleVersion,
} from '@alunza/contracts';
import {
  Field,
  FormDialog,
  OperationError,
  SelectField,
} from '@/components/identity-forms';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  ruleFormInput,
  ruleParametersLabel,
  ruleTypeLabels,
  type RuleType,
} from '@/lib/signal-rule-operation';
import type { RuleOperation } from './use-rule-operation';

export function CreateRule({
  operation,
  onSaved,
}: {
  operation: RuleOperation;
  onSaved: (version: SignalRuleVersion) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RuleType>('INACTIVITY');
  const [values, setValues] = useState({
    inactivityDays: '7',
    repeatedErrorAttempts: '3',
    repeatedErrorWindowDays: '14',
    stagnationAttempts: '3',
  });
  const [validation, setValidation] = useState<ApiError | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = signalRuleCreateSchema.safeParse(
      ruleFormInput(type, new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      setValidation(
        new ApiError(
          422,
          'VALIDATION_FAILED',
          'Revisa los parámetros indicados.',
          undefined,
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: 'Introduce un entero dentro del intervalo indicado.',
          })),
        ),
      );
      return;
    }
    setValidation(null);
    const result = await operation.run({
      operation: 'create',
      payload: parsed.data,
    });
    if (result?.status === 'confirmed') {
      setOpen(false);
      await onSaved(result.version);
    } else if (result?.status === 'failed' && result.uncertain) setOpen(false);
  }
  const error = validation ?? operation.error;
  return (
    <FormDialog
      title="Crear versión de regla"
      description="La versión se guarda como borrador inmutable. Para aplicar sus parámetros tendrás que activarla después."
      trigger={
        <Button data-cy="rule-create" disabled={operation.locked}>
          Crear versión
        </Button>
      }
      open={open && !operation.suspended}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValidation(null);
          operation.clearError();
        }
      }}
      locked={operation.busy}
    >
      <form
        onSubmit={(event) => void submit(event)}
        aria-busy={operation.busy}
        className="space-y-4"
        noValidate
      >
        <OperationError error={error} />
        <fieldset disabled={operation.locked} className="space-y-4">
          <SelectField
            label="Tipo de regla"
            name="type"
            value={type}
            onChange={(event) => {
              setType(event.target.value as RuleType);
              setValidation(null);
            }}
          >
            {Object.entries(ruleTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <div key={type} className="space-y-4">
            {type === 'INACTIVITY' ? (
              <Field
                label="Días sin actividad elegible"
                name="parameters.inactivityDays"
                type="number"
                step={1}
                min={1}
                max={signalRuleIntegerMaximum}
                value={values.inactivityDays}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    inactivityDays: event.target.value,
                  }))
                }
                required
                error={error}
              />
            ) : null}
            {type === 'REPEATED_ERROR' ? (
              <>
                <Field
                  label="Intentos consecutivos con el mismo diagnóstico"
                  name="parameters.repeatedErrorAttempts"
                  type="number"
                  step={1}
                  min={2}
                  max={signalRuleIntegerMaximum}
                  value={values.repeatedErrorAttempts}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      repeatedErrorAttempts: event.target.value,
                    }))
                  }
                  required
                  error={error}
                />
                <Field
                  label="Ventana de error repetido (días)"
                  name="parameters.repeatedErrorWindowDays"
                  type="number"
                  step={1}
                  min={1}
                  max={signalRuleIntegerMaximum}
                  value={values.repeatedErrorWindowDays}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      repeatedErrorWindowDays: event.target.value,
                    }))
                  }
                  required
                  error={error}
                />
              </>
            ) : null}
            {type === 'STAGNATION' ? (
              <Field
                label="Intentos sin aumento de casos visibles superados"
                name="parameters.stagnationAttempts"
                type="number"
                step={1}
                min={2}
                max={signalRuleIntegerMaximum}
                value={values.stagnationAttempts}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    stagnationAttempts: event.target.value,
                  }))
                }
                required
                error={error}
              />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Días: enteros desde 1. Intentos: enteros desde 2. Máximo
            representable: 2.147.483.647.{' '}
            {type === 'STAGNATION'
              ? 'El estancamiento no añade una ventana temporal.'
              : 'Cada día corresponde a 24 horas.'}
          </p>
        </fieldset>
        <Button
          type="submit"
          data-cy="rule-create-submit"
          disabled={operation.locked}
        >
          {operation.busy ? 'Guardando…' : 'Guardar borrador'}
        </Button>
      </form>
    </FormDialog>
  );
}

export function ActivateRule({
  rule,
  effective,
  available,
  operation,
  onSaved,
  onRefresh,
}: {
  rule: SignalRuleVersion;
  effective: SignalRuleVersion | null;
  available: boolean;
  operation: RuleOperation;
  onSaved: (version: SignalRuleVersion) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [expected, setExpected] = useState<SignalRuleVersion | null>(null);
  const conflict =
    operation.error?.code === 'RULE_VERSION_CONFLICT' ||
    operation.error?.code === 'RULE_VERSION_ALREADY_ACTIVATED';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await operation.run({
      operation: 'activate',
      versionId: rule.id,
      payload: { expectedCurrentVersionId: expected?.id ?? null },
    });
    if (result?.status === 'confirmed') {
      setOpen(false);
      await onSaved(result.version);
    } else if (result?.status === 'failed' && result.uncertain) setOpen(false);
  }
  return (
    <FormDialog
      title="Activar versión"
      description="La activación aplica desde la hora confirmada por el servidor. Conserva las versiones y señales anteriores. Las evaluaciones posteriores usarán la nueva regla."
      trigger={
        <Button
          data-cy="rule-activate"
          variant="outline"
          disabled={!available || operation.locked}
        >
          Activar versión {rule.version}
        </Button>
      }
      open={open && !operation.suspended}
      locked={operation.busy}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setExpected(effective);
          operation.clearError();
        }
      }}
    >
      <form
        onSubmit={(event) => void submit(event)}
        aria-busy={operation.busy}
        className="space-y-4"
      >
        <OperationError error={operation.error} />
        <p>
          <strong>
            {ruleTypeLabels[rule.type]} · Versión {rule.version}
          </strong>
        </p>
        <p>{ruleParametersLabel(rule)}</p>
        <p data-cy="rule-expected">
          {expected
            ? `Reemplaza la versión ${expected.version}: ${ruleParametersLabel(expected)}.`
            : 'No hay regla activa para este tipo.'}
        </p>
        <p className="text-sm text-muted-foreground">
          La activación puede abrir un nuevo episodio con evidencia todavía
          vigente. No modifica ni reactiva revisiones anteriores.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            data-cy="rule-activate-confirm"
            disabled={operation.locked || conflict}
          >
            {operation.busy ? 'Activando…' : 'Confirmar activación'}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-cy="rule-activate-cancel"
            disabled={operation.busy}
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          {conflict ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                operation.clearError();
                void onRefresh();
              }}
            >
              Cargar regla vigente
            </Button>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}
