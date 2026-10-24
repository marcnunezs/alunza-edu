/* eslint @typescript-eslint/no-require-imports: "off" */
function assertPracticeTestState(state) {
  const database = new URL(state.migrationUrl);
  if (
    state.projectId !== 'alunza-edu-foundation-test' ||
    state.authUrl !== 'http://127.0.0.1:16421' ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '16422' ||
    database.pathname !== '/postgres'
  )
    throw new Error(
      'La prueba de práctica exige el entorno TEST del principal.',
    );
}
module.exports = { assertPracticeTestState };
