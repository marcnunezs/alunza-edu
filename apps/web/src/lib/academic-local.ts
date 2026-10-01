/** Local drafts contain no authority: availability is always checked by the API. */
const prefix = 'alunza:draft:v1:';
export type DraftScope = {
  accountId: string;
  organizationId: string;
  classId: string;
  assignmentId: string;
  versionId: string;
};

export function draftKey(scope: DraftScope) {
  return (
    prefix +
    [
      scope.accountId,
      scope.organizationId,
      scope.classId,
      scope.assignmentId,
      scope.versionId,
    ]
      .map(encodeURIComponent)
      .join(':')
  );
}

export function readDraft(
  storage: Pick<Storage, 'getItem'>,
  scope: DraftScope,
  template: string,
) {
  try {
    const draft = storage.getItem(draftKey(scope));
    return {
      code: draft ?? template,
      recovered: draft !== null,
      failed: false,
    };
  } catch {
    return { code: template, recovered: false, failed: true };
  }
}

export function writeDraft(
  storage: Pick<Storage, 'setItem'>,
  scope: DraftScope,
  code: string,
) {
  try {
    storage.setItem(draftKey(scope), code);
    return true;
  } catch {
    return false;
  }
}

export function clearDrafts(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'>,
) {
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

/** datetime-local fields explicitly use Santiago, independent of the browser zone. */
export function santiagoInput(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function santiagoInstant(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Indica una fecha y hora válidas.');
  const wall = Date.parse(`${value}:00Z`);
  // Chile uses UTC-3/UTC-4. Enumerate instead of depending on the user's zone.
  const matches = [3, 4]
    .map((offset) => new Date(wall + offset * 3_600_000).toISOString())
    .filter((candidate) => santiagoInput(candidate) === value);
  if (matches.length !== 1)
    throw new Error(
      'Esa hora coincide con un cambio de horario en Santiago. Elige otra hora.',
    );
  return matches[0]!;
}
