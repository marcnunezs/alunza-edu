import { readFile } from 'node:fs/promises';
export async function preparedManifest() {
  const value = JSON.parse(
    await readFile(
      new URL(
        '../../infra/preproduction/manifest.example.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  value.remote = {
    enabled: true,
    approvedBy: 'test-fixture-only',
    approvalRef: 'unit-test-only',
    approvedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    allowedOperations: [
      'azure:deploy',
      'azure:job',
      'supabase:bootstrap',
      'smoke:web-api',
      'probe:ai',
      'probe:sandbox',
    ],
  };
  value.budget.maxCost = 100;
  value.release = {
    sha: 'a'.repeat(40),
    apiImage: `alunzatest.azurecr.io/api@sha256:${'a'.repeat(64)}`,
    jobImage: `alunzatest.azurecr.io/job@sha256:${'b'.repeat(64)}`,
  };
  value.targets.azure = {
    subscriptionId: '10000000-0000-4000-8000-000000000001',
    resourceGroup: 'alunza-test',
    location: 'eastus',
    environmentName: 'alunza-test-env',
    registryName: 'alunzatest',
    identityName: 'alunza-test-id',
    apiName: 'alunza-test-api',
    jobName: 'alunza-test-job',
    apiOrigin: 'https://alunza-test-api.example.eastus.azurecontainerapps.io',
  };
  value.targets.vercel = {
    projectId: 'prj_fixture',
    teamId: 'team_fixture',
    webOrigin: 'https://alunza-fixture.vercel.app',
  };
  value.targets.supabase = {
    projectRef: 'a'.repeat(20),
    authUrl: `https://${'a'.repeat(20)}.supabase.co`,
    databaseHost: 'aws-0-us-east-1.pooler.supabase.com',
    databasePort: 5432,
    region: 'us-east-1',
  };
  value.targets.sandbox = {
    projectId: 'prj_fixture',
    teamId: 'team_fixture',
    region: 'iad1',
    image: `vcr.example/fixture@sha256:${'b'.repeat(64)}`,
  };
  value.targets.azureOpenAi = {
    resourceId:
      '/subscriptions/10000000-0000-4000-8000-000000000001/resourceGroups/alunza-test/providers/Microsoft.CognitiveServices/accounts/alunza-test',
    endpoint: 'https://alunza-fixture.openai.azure.com',
    region: 'eastus',
    generationDeployment: 'fixture-generation',
    embeddingDeployment: 'fixture-embedding',
    apiVersion: 'v1',
    embeddingDimensions: 1536,
  };
  return value;
}
export const smokeEnv = {
  PREPROD_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_FICTITIOUS_UNIT_TEST_ONLY',
  PREPROD_SMOKE_ADMIN_EMAIL: 'admin.a@alunza.test',
  PREPROD_SMOKE_TEACHER_EMAIL: 'teacher.a@alunza.test',
  PREPROD_SMOKE_STUDENT_EMAIL: 'student.a@alunza.test',
  PREPROD_SMOKE_PASSWORD: 'fixture-password-only',
  PREPROD_DISABLED_EMAIL: 'disabled.a@alunza.test',
  PREPROD_DISABLED_PASSWORD: 'disabled-password-only',
  PREPROD_OWN_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
  PREPROD_OTHER_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000002',
};
