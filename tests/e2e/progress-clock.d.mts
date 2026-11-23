export function instantMicros(value: string): bigint;
export function progressAfterPublications<T extends { asOf: string }>(
  read: () => Cypress.Chainable<T>,
  publications: Array<string | null>,
  attempts?: number,
): Cypress.Chainable<T>;
