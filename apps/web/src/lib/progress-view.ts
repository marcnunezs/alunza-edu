export function progressPercentage(ratio: number | null): string {
  return ratio === null ? 'No calculable' : `${Math.round(ratio * 100)} %`;
}

export function progressEvidenceLabel(state: string): string {
  if (state === 'NO_REQUIRED_EXERCISES') return 'Sin ejercicios requeridos.';
  if (state === 'NO_ATTEMPTS') return 'Sin intentos.';
  return 'Con evidencia de intentos confirmados.';
}
