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
export function publicParameters(manifest, deployWorkloads = false) {
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
        sandboxImage: manifest.targets.sandbox.image ?? '',
        sandboxRegion: manifest.targets.sandbox.region ?? '',
        sandboxTeamId: manifest.targets.sandbox.teamId ?? '',
        sandboxProjectId: manifest.targets.sandbox.projectId ?? '',
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
  const workloads = process.argv[4] === '--workloads';
  if (
    process.argv.length > 5 ||
    (process.argv[4] && (!workloads || command !== 'plan'))
  )
    throw new Error('Argumentos de preparación inválidos.');
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
    const parameters = publicParameters(manifest, workloads);
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
