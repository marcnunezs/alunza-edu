// Fixed laboratory destinations. Never accept the original repository's ports
// or Docker identities when operating this independent copy.
function target(values) {
  return Object.freeze({
    ...values,
    apiUrl: `http://127.0.0.1:${values.apiPort}`,
    authUrl: `http://127.0.0.1:${values.authPort}`,
    webUrl: `http://127.0.0.1:${values.webPort}`,
    mailUrl: `http://127.0.0.1:${values.mailPort}`,
  });
}

export const developmentTarget = target({
  test: false,
  projectId: 'alunza-edu-laboratorio',
  networkName: 'alunza-laboratorio-local',
  apiPort: 4200,
  webPort: 3200,
  authPort: 17421,
  dbPort: 17422,
  shadowPort: 17420,
  studioPort: 17423,
  mailPort: 17424,
});
export const testTarget = target({
  test: true,
  projectId: 'alunza-edu-laboratorio-test',
  networkName: 'alunza-laboratorio-test-local',
  apiPort: 4300,
  webPort: 3300,
  authPort: 18421,
  dbPort: 18422,
  shadowPort: 18420,
  studioPort: 18423,
  mailPort: 18424,
});
export const testWorkspaceDirectory = '.local/lab-integration-workspace';

export function assertLocalTarget(ctx) {
  const expected = ctx?.test === true ? testTarget : developmentTarget;
  if (Object.entries(expected).some(([key, value]) => ctx?.[key] !== value))
    throw new Error('El contexto no pertenece al laboratorio local aislado.');
}

export function assertRuntimeTarget(state, expected) {
  const database = new URL(state?.migrationUrl);
  if (
    ![developmentTarget, testTarget].includes(expected) ||
    state.projectId !== expected.projectId ||
    state.authUrl !== expected.authUrl ||
    !['postgresql:', 'postgres:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost'].includes(database.hostname) ||
    database.port !== String(expected.dbPort) ||
    database.pathname !== '/postgres' ||
    database.search ||
    database.hash
  )
    throw new Error(
      'El estado no corresponde al destino aislado del laboratorio.',
    );
}
