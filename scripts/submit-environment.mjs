import { createHash } from 'node:crypto';
import { executeDockerObservation } from './submit-docker-observation.mjs';
import { testTarget } from './local-target.mjs';

export async function submitEnvironmentManifest(
  execute = executeDockerObservation,
) {
  const info = JSON.parse(
    (await execute('docker', ['info', '--format', '{{json .}}'])).stdout,
  );
  const inventory = (
    await execute('docker', ['ps', '-a', '--format', '{{json .}}'])
  ).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const stable = inventory
    .filter((item) => !item.Names.endsWith(`_${testTarget.projectId}`))
    .map(({ ID, Names, Image, State, Status }) => [
      ID,
      Names,
      Image,
      State,
      typeof Status === 'string' && /\(Paused\)/i.test(Status),
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const groups = { test: 0, laboratory: 0, other: 0 };
  for (const item of inventory) {
    if (
      ![
        'created',
        'running',
        'paused',
        'restarting',
        'removing',
        'exited',
        'dead',
      ].includes(item.State)
    )
      throw new Error('Invalid Docker environment observation');
    const group = item.Names.endsWith(`_${testTarget.projectId}`)
      ? 'test'
      : item.Names.endsWith('_alunza-edu-laboratorio')
        ? 'laboratory'
        : 'other';
    groups[group]++;
  }
  if (
    !Number.isSafeInteger(info.NCPU) ||
    info.NCPU < 1 ||
    !Number.isSafeInteger(info.MemTotal) ||
    info.MemTotal < 1 ||
    !['ServerVersion', 'Driver', 'KernelVersion'].every(
      (key) => typeof info[key] === 'string' && info[key].length <= 200,
    )
  )
    throw new Error('Invalid Docker environment observation');
  return {
    docker: {
      cpus: info.NCPU,
      memoryBytes: info.MemTotal,
      serverVersion: info.ServerVersion,
      driver: info.Driver,
      kernelVersion: info.KernelVersion,
    },
    workloadFingerprint: createHash('sha256')
      .update(JSON.stringify(stable))
      .digest('hex'),
    workloadCounts: groups,
  };
}
