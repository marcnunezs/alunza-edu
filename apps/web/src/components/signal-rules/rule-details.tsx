import type { SignalRuleVersion } from '@alunza/contracts';
import { formatDate } from '@/components/identity-forms';
import {
  ruleParametersLabel,
  ruleStateLabels,
  ruleTypeLabels,
} from '@/lib/signal-rule-operation';

export function RuleTime({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value} title={value}>
      {formatDate(value)} (Santiago)
    </time>
  ) : (
    <>—</>
  );
}

export function RuleDetails({ rule }: { rule: SignalRuleVersion }) {
  return (
    <dl
      className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]"
      data-cy="rule-details"
    >
      <dt>Tipo</dt>
      <dd>{ruleTypeLabels[rule.type]}</dd>
      <dt>Versión</dt>
      <dd>
        {rule.version} · {ruleStateLabels[rule.state]}
      </dd>
      <dt>Parámetros</dt>
      <dd>{ruleParametersLabel(rule)}</dd>
      <dt>Identificador</dt>
      <dd className="break-all font-mono text-xs">{rule.id}</dd>
      <dt>Creada por</dt>
      <dd className="break-all font-mono text-xs" data-cy="rule-created-by">
        {rule.createdBy}
      </dd>
      <dt>Creada el</dt>
      <dd data-cy="rule-created-at">
        <RuleTime value={rule.createdAt} />
      </dd>
      <dt>Activada por</dt>
      <dd className="break-all font-mono text-xs" data-cy="rule-activated-by">
        {rule.activatedBy ?? 'Sin activar'}
      </dd>
      <dt>Vigente desde (inclusive)</dt>
      <dd data-cy="rule-valid-from">
        <RuleTime value={rule.validFrom} />
      </dd>
      <dt>Vigente hasta (exclusivo)</dt>
      <dd data-cy="rule-valid-to">
        {rule.validTo ? (
          <RuleTime value={rule.validTo} />
        ) : rule.state === 'ACTIVE' ? (
          'Sin cierre registrado'
        ) : (
          '—'
        )}
      </dd>
    </dl>
  );
}
