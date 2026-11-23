import type { HelpKind, RagHelp } from '@alunza/contracts';

export const helpStatusLabels = {
  SUPPORTED: 'Ayuda con fuente',
  NO_EVIDENCE: 'Sin fuente suficiente',
  PROVIDER_UNAVAILABLE: 'Ayuda temporalmente no disponible',
} as const;

/** Pure presentation: reading this component never acknowledges or requests help. */
export function FeedbackContent({
  kind,
  hintLevel,
  help,
  showHintPolicy = true,
}: {
  kind: HelpKind;
  hintLevel: number | null;
  help: RagHelp;
  showHintPolicy?: boolean;
}) {
  return (
    <>
      <h4 className="font-semibold">
        {kind === 'FEEDBACK'
          ? 'Explicación del intento'
          : `Pista ${hintLevel} de 3`}
      </h4>
      <p data-cy="help-status" data-status={help.status}>
        {helpStatusLabels[help.status]}
      </p>
      <p className="whitespace-pre-wrap break-words" data-cy="help-explanation">
        {help.explanation}
      </p>
      {help.hint ? (
        <p className="whitespace-pre-wrap break-words" data-cy="help-hint">
          {help.hint}
        </p>
      ) : null}
      {help.status !== 'SUPPORTED' ? (
        <p>
          El diagnóstico técnico del intento se conserva.
          {showHintPolicy
            ? ' Esta respuesta no consume un nivel de pista.'
            : ''}
        </p>
      ) : null}
    </>
  );
}
