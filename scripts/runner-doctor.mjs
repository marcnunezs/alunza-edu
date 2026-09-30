import {
  command,
  imageIdentity,
  runCapsule,
} from '../infra/runner/capsule.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const reportPath = new URL(
  '../.local/reports/imp-00-06-08/runner-doctor.json',
  import.meta.url,
);
async function report(value) {
  await mkdir(new URL('.', reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(value, null, 2) + '\n');
  console.log(JSON.stringify(value));
}
export async function inspectDoctor({
  docker = command,
  identify = imageIdentity,
  capsule = runCapsule,
} = {}) {
  let attempted = false;
  let response;
  try {
    const info = await docker(['info', '--format', '{{json .}}']);
    if (info.code !== 0) throw new Error('Docker Engine unavailable');
    const data = JSON.parse(info.stdout);
    if (
      data.OSType !== 'linux' ||
      data.CgroupVersion !== '2' ||
      !data.MemoryLimit ||
      !data.SwapLimit ||
      !data.PidsLimit
    )
      throw new Error(
        'Runner requires Linux Docker with cgroup v2 memory/swap/pids controllers',
      );
    const image = await identify();
    attempted = true;
    response = await capsule(
      {
        executionId: randomUUID(),
        code: '',
        args: [],
        budgetMs: 3000,
        outputRemaining: 65536,
      },
      { image, probe: 'identity' },
    );
    const packet = response.packet;
    if (
      !packet ||
      packet.status !== 'exited' ||
      packet.exitCode !== 0 ||
      response.exitCode !== 0 ||
      response.oomKilled ||
      response.timedOut ||
      response.cancelled ||
      !response.cleanupVerified
    )
      throw new Error('Effective capsule limits not verified');
    const returned = JSON.parse(
      Buffer.from(packet.returnData, 'base64').toString('utf8'),
    );
    const student = returned.value;
    const capabilityNames = ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'];
    if (
      returned.kind !== 'probe' ||
      student?.uid !== 10001 ||
      student.node !== 'v24.21.0' ||
      !student.capabilities ||
      Object.keys(student.capabilities).length !== 5 ||
      !capabilityNames.every(
        (key) => student.capabilities[key] === '0000000000000000',
      )
    )
      throw new Error('Student identity not verified');
    const effective = packet.cgroup;
    if (
      effective?.['memory.max'] !== '134217728' ||
      effective['memory.swap.max'] !== '0' ||
      effective['pids.max'] !== '32' ||
      effective['cpu.max'] !== '100000 100000'
    )
      throw new Error('Effective cgroup limits not verified');
    return {
      stage: 'runner:doctor',
      status: 'PASS',
      docker: data.ServerVersion,
      os: data.OSType,
      cgroup: data.CgroupVersion,
      image,
      effective: Object.fromEntries(
        ['memory.max', 'memory.swap.max', 'pids.max', 'cpu.max'].map((key) => [
          key,
          effective[key],
        ]),
      ),
      student: {
        node: student.node,
        uid: student.uid,
        capabilities: Object.fromEntries(
          capabilityNames.map((key) => [key, student.capabilities[key]]),
        ),
      },
      cleanupVerified: true,
      programWallMs: response.programWallMs,
      remoteCalls: 0,
      remote: 'NOT_RUN',
    };
  } catch {
    return {
      stage: 'runner:doctor',
      status: attempted ? 'FAIL' : 'PENDING',
      reason: attempted
        ? 'CAPSULE_EFFECTIVE_LIMITS_OR_IDENTITY_NOT_VERIFIED'
        : 'LINUX_DOCKER_CGROUP2_AND_PREPARED_IMAGE_REQUIRED',
      cleanupVerified: response?.cleanupVerified ?? false,
      remoteCalls: 0,
    };
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await inspectDoctor();
  await report({ recordedAt: new Date().toISOString(), ...result });
  process.exitCode =
    result.status === 'PASS' ? 0 : result.status === 'PENDING' ? 2 : 1;
}
