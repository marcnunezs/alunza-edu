import { editableWindow } from './activities.service';

describe('activity editing admission', () => {
  const start = '2026-09-23T12:00:00.000Z';
  const end = '2026-09-23T13:00:00.000Z';
  it.each([
    [Date.parse(start) - 1, false],
    [Date.parse(start), true],
    [Date.parse(end) - 1, true],
    [Date.parse(end), false],
  ])(
    'uses an inclusive opening and exclusive ending at %s',
    (now, expected) => {
      expect(editableWindow('PUBLISHED', false, start, end, now)).toBe(
        expected,
      );
    },
  );
  it('does not invent bounds when either date is absent', () => {
    expect(editableWindow('PUBLISHED', false, null, null, 0)).toBe(true);
    expect(
      editableWindow('PUBLISHED', false, null, end, Date.parse(start)),
    ).toBe(true);
    expect(
      editableWindow('PUBLISHED', false, start, null, Date.parse(end)),
    ).toBe(true);
  });
  it('keeps closed, draft and archived-class content read only', () => {
    for (const state of ['CLOSED', 'DRAFT'])
      expect(editableWindow(state, false, null, null, Date.now())).toBe(false);
    expect(editableWindow('PUBLISHED', true, null, null, Date.now())).toBe(
      false,
    );
  });
});
