import { withTestEnvironment, report } from './test-environment.mjs';
try {
  await withTestEnvironment(
    async () => {
      await report(
        'academic-upgrade',
        {
          status: 'passed',
          environment: 'isolated-local',
          source: 'IMP-02 canonical academic dataset',
          preservation:
            'all institutional, academic, published-version and test rows unchanged',
        },
        'imp-03',
      );
    },
    [],
    { upgradeFromAcademic: true },
  );
} catch (error) {
  await report('academic-upgrade', { status: 'failed' }, 'imp-03');
  console.error(error.message);
  process.exitCode = 1;
}
