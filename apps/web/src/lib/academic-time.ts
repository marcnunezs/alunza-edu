export function localDateTime(value: string | null, timezone: string): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Reject nonexistent/ambiguous daylight-saving times instead of silently changing them.
export function toInstant(value: string, timezone: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Revisa la fecha y hora.');
  const wall = Date.parse(`${value}Z`);
  let candidate = wall;
  for (let pass = 0; pass < 3; pass += 1) {
    const projected = Date.parse(
      `${localDateTime(new Date(candidate).toISOString(), timezone)}Z`,
    );
    candidate += wall - projected;
  }
  const result = new Date(candidate).toISOString();
  if (
    localDateTime(result, timezone) !== value ||
    [-3600000, 3600000].some(
      (shift) =>
        localDateTime(new Date(candidate + shift).toISOString(), timezone) ===
        value,
    )
  ) {
    throw new Error(
      'Esa hora coincide con un cambio horario. Elige una hora inequívoca para la organización.',
    );
  }
  return result;
}
