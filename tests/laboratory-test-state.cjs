// Keep the mutation-capable test harness independent from copied runtime files.
// Checking a project label alone is insufficient: all destinations must be LAB TEST.
function assertLaboratoryTestState(state) {
  let target;
  try {
    target = new URL(state?.migrationUrl);
  } catch {
    throw new Error('El fixture exige el destino completo de LAB TEST.');
  }
  if (
    ![
      'alunza-edu-laboratorio-test',
      'alunza-edu-laboratorio-physical-test',
    ].includes(state.projectId) ||
    state.authUrl !== 'http://127.0.0.1:18421' ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '18422' ||
    target.pathname !== '/postgres' ||
    target.search ||
    target.hash
  )
    throw new Error('El fixture exige el destino completo de LAB TEST.');
}

module.exports = { assertLaboratoryTestState };
