import type { Session } from '@supabase/supabase-js';

export interface PracticeFixture {
  organization: { id: string };
  classroom: { id: string };
  activity: { id: string; revision: number; exercises: { id: string }[] };
}
export const correctCode = 'function solve(a, b) { return a + b; }';
export const preparePractice = () =>
  cy.task<PracticeFixture>('academic:prepare', {}, { log: false });
export const solutionPath = (fixture: PracticeFixture) =>
  `/academia/${fixture.organization.id}/actividades/${fixture.activity.id}/ejercicios/${fixture.activity.exercises[0]!.id}`;
export const attemptsEndpoint = (fixture: PracticeFixture) =>
  `/api/v1/activities/${fixture.activity.id}/exercises/${fixture.activity.exercises[0]!.id}/attempts`;
export function openPractice(
  fixture: PracticeFixture,
  role = 'student',
  before?: (window: Cypress.AUTWindow) => void,
) {
  return cy
    .task<Session>('academic:login', role, { log: false })
    .then((session) => {
      cy.visit(solutionPath(fixture), {
        onBeforeLoad(window) {
          window.localStorage.setItem(
            'alunza.auth.127.0.0.1:16421',
            JSON.stringify(session),
          );
          before?.(window);
        },
      });
    });
}
export function writeCode(code: string) {
  cy.get('[data-cy="solution-code"]').should('not.have.attr', 'readonly');
  // Attribute assertions can yield the attribute value; query the editor again.
  cy.get('[data-cy="solution-code"]')
    .clear()
    .type(code, { parseSpecialCharSequences: false, delay: 0 });
  cy.get('[data-cy="solution-code"]').should('have.value', code);
}
export function confirmSubmit() {
  cy.get('[data-cy="submit-code"]').click();
  cy.get('[role="dialog"]').should('be.visible');
  cy.get('[data-cy="confirm-submit"]').click();
  cy.get('[role="dialog"]').should('not.exist');
}
