import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBootstrap } from './preprod-bootstrap.mjs';
import {
  loadManifest,
  validateManifest,
  assertRemoteAuthorization,
  remoteOperations,
} from './preprod-manifest.mjs';
import { validateCampaign, loadCampaign } from './sandbox-campaign.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const reportDirectory = join(root, '.local/reports/imp-00-06-08');
export async function writeReport(name, value) {
  if (!/^preprod-[a-z-]+$/.test(name))
    throw new Error('Nombre de informe inválido.');
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    join(reportDirectory, `${name}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        increment: 'IMP-00.08',
        recordedAt: new Date().toISOString(),
        ...value,
      },
      null,
      2,
    ) + '\n',
  );
}
export function preparationStatus(manifest) {
  return remoteOperations.map((operation) => {
    try {
      assertRemoteAuthorization(manifest, operation);
      if (
        (operation === 'smoke:web-api' &&
          manifest.budget.maxHttpRequests < 29) ||
        (operation === 'probe:sandbox' && manifest.budget.maxHttpRequests < 10)
      )
        throw new Error('Presupuesto insuficiente para ensayo y limpieza.');
      return { operation, status: 'ready-to-request' };
    } catch {
      return { operation, status: 'pending' };
    }
  });
}
export function publicParameters(
  manifest,
  deployWorkloads = false,
  runner = {},
) {
  validateManifest(manifest);
  // Rendering a local parameter file does not require approval to use Azure.
  // Enabling workloads requires the same live authorization as remote actions.
  if (deployWorkloads) {
    assertRemoteAuthorization(manifest, 'azure:deploy');
    if (!manifest.release.apiImage)
      throw new Error('Falta digest aprobado de API.');
  }
  const { azure, vercel, supabase } = manifest.targets;
  const required = [
    azure.location,
    azure.environmentName,
    azure.registryName,
    azure.identityName,
    azure.apiName,
    azure.jobName,
    vercel.webOrigin,
    supabase.authUrl,
    manifest.release.sha,
    manifest.remote.expiresAt,
  ];
  if (required.some((value) => value === null) || manifest.budget.maxCost <= 0)
    throw new Error('Faltan parámetros públicos de preparación.');
  const rolloutId = runner.rolloutId ?? '';
  if (typeof rolloutId !== 'string' || !/^[a-z0-9]{0,8}$/.test(rolloutId))
    throw new Error('Identificador de rollout inválido.');
  const campaign = runner.campaign ? validateCampaign(runner.campaign) : null;
  if (
    campaign &&
    (campaign.candidate.commit !== manifest.release.sha ||
      ['teamId', 'projectId', 'region', 'image'].some(
        (field) =>
          !manifest.targets.sandbox[field] ||
          campaign[field] !== manifest.targets.sandbox[field],
      ))
  )
    throw new Error(
      'La campaña debe identificar el mismo candidato y destino completo.',
    );
  if (
    (runner.enableAdmissions || runner.enableRecovery) &&
    (!campaign?.authorized ||
      !campaign.approval?.approvedBy ||
      campaign.approval.approvedBy.length > 100 ||
      !campaign.approval?.reference ||
      !campaign.approval?.approvedAt ||
      !campaign.candidate.sourceDigest ||
      campaign.maxCost <= 0 ||
      campaign.maxCreations < 1 ||
      campaign.maxCreations > 10000 ||
      campaign.maxRequests < 10 ||
      campaign.maxRequests <= 8 * campaign.maxCreations ||
      campaign.runnerVersion.length > 100 ||
      !campaign.expiresAt ||
      Date.parse(campaign.approval.approvedAt) > Date.now() ||
      Date.parse(campaign.expiresAt) <=
        Date.parse(campaign.approval.approvedAt))
  )
    throw new Error(
      'La operación de Sandbox requiere una campaña aprobada completa y compatible.',
    );
  // An expired, previously approved campaign remains usable for observation and
  // cleanup. The original durable counters are preserved; it cannot admit work.
  if (
    runner.enableAdmissions &&
    (!deployWorkloads || Date.parse(campaign.expiresAt) <= Date.now())
  )
    throw new Error(
      'Las admisiones requieren campaña vigente y despliegue autorizado.',
    );
  return {
    $schema:
      'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
    contentVersion: '1.0.0.0',
    parameters: Object.fromEntries(
      Object.entries({
        location: azure.location,
        environmentName: azure.environmentName,
        registryName: azure.registryName,
        identityName: azure.identityName,
        apiName: azure.apiName,
        jobName: azure.jobName,
        webOrigin: vercel.webOrigin,
        authOrigin: supabase.authUrl,
        releaseId: manifest.release.sha,
        rolloutId,
        practiceRunnerEnabled: runner.enableAdmissions === true,
        practiceRunnerProvider: campaign ? 'vercel' : 'docker',
        sandboxRecoveryEnabled: runner.enableRecovery === true,
        apiImage: manifest.release.apiImage ?? '',
        jobImage: manifest.release.jobImage ?? '',
        deployWorkloads,
        approvedUntil: manifest.remote.expiresAt,
        budgetClp: manifest.budget.maxCost,
        jobTimeoutSeconds: Math.max(
          60,
          manifest.budget.maxDurationSeconds + 40,
        ),
        aiResourceId: manifest.targets.azureOpenAi.resourceId ?? '',
        sandboxImage: campaign?.image ?? manifest.targets.sandbox.image ?? '',
        sandboxRegion:
          campaign?.region ?? manifest.targets.sandbox.region ?? '',
        sandboxTeamId:
          campaign?.teamId ?? manifest.targets.sandbox.teamId ?? '',
        sandboxProjectId:
          campaign?.projectId ?? manifest.targets.sandbox.projectId ?? '',
      }).map(([name, value]) => [name, { value }]),
    ),
  };
}

async function main() {
  const command = process.argv[2] ?? 'check';
  const path =
    process.argv[3] ?? join(root, 'infra/preproduction/manifest.example.json');
  if (!['check', 'plan'].includes(command))
    throw new Error('Usa preprod:check o preprod.mjs plan <manifest>.');
  let workloads = false;
  const runner = {};
  const flags = process.argv.slice(4);
  if (flags.length && command !== 'plan')
    throw new Error('Argumentos de preparación inválidos.');
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--workloads') workloads = true;
    else if (flag === '--enable-runner') runner.enableAdmissions = true;
    else if (flag === '--recover-runner') runner.enableRecovery = true;
    else if (
      flag === '--sandbox-campaign' &&
      flags[index + 1] &&
      !flags[index + 1].startsWith('--')
    )
      runner.campaign = await loadCampaign(flags[++index]);
    else if (
      flag === '--rollout' &&
      flags[index + 1] &&
      !flags[index + 1].startsWith('--')
    )
      runner.rolloutId = flags[++index];
    else throw new Error('Argumentos de preparación inválidos.');
  }
  const manifest = await loadManifest(path);
  for (const file of [
    'infra/preproduction/main.bicep',
    'infra/preproduction/Job.Dockerfile',
    'apps/web/vercel.json',
  ])
    await access(join(root, file));
  const operations = preparationStatus(manifest);
  const incomplete =
    operations
      .filter((entry) =>
        manifest.remote.allowedOperations.includes(entry.operation),
      )
      .some((entry) => entry.status === 'pending') ||
    !manifest.remote.enabled ||
    manifest.remote.allowedOperations.length === 0;
  await writeReport('preprod-check', {
    status: incomplete ? 'pending-configuration' : 'prepared',
    remoteExecuted: false,
    monetaryHardLimit: false,
    observedCost: null,
    operations,
  });
  if (command === 'plan') {
    const parameters = publicParameters(manifest, workloads, runner);
    const destination = join(
      root,
      '.local/preproduction/parameters.public.json',
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(parameters, null, 2) + '\n');
    await prepareBootstrap();
    console.log(
      'Parámetros públicos preparados en .local/preproduction/parameters.public.json. Ningún recurso remoto fue creado.',
    );
  }
  console.log(
    incomplete
      ? 'Preparación local disponible; faltan destino/autorización/vigencia. No hubo red.'
      : 'Preparación validada. No acredita despliegue, conectividad ni gasto.',
  );
  if (incomplete) process.exitCode = 2;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(async () => {
    await writeReport('preprod-check', {
      status: 'invalid-configuration',
      remoteExecuted: false,
    });
    console.error(
      'Configuración de preproducción inválida. No se ejecutaron operaciones remotas.',
    );
    process.exitCode = 2;
  });
