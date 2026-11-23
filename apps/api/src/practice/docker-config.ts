import { z } from 'zod';

const dockerConfigurationSchema = z.strictObject({
  runtime: z.enum(['runc', 'crun']),
  runtimeName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
  runtimeVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/),
  runtimeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  strategy: z.enum(['cold', 'prepared-pair-v1']),
});

export type DockerConfiguration = Readonly<
  z.infer<typeof dockerConfigurationSchema>
>;

/** Explicit local candidate settings. No environment values enter public DTOs. */
export function loadDockerConfiguration(
  env: NodeJS.ProcessEnv,
): DockerConfiguration | undefined {
  const runtime = env.PRACTICE_DOCKER_RUNTIME ?? 'runc';
  const strategy = env.PRACTICE_DOCKER_STRATEGY ?? 'cold';
  const runtimeName = env.PRACTICE_DOCKER_RUNTIME_NAME;
  const runtimeVersion = env.PRACTICE_DOCKER_RUNTIME_VERSION;
  const runtimeSha256 = env.PRACTICE_DOCKER_RUNTIME_SHA256;
  if (
    runtime === 'runc' &&
    strategy === 'cold' &&
    runtimeName === undefined &&
    runtimeVersion === undefined &&
    runtimeSha256 === undefined
  )
    return undefined;
  const configuration = dockerConfigurationSchema.parse({
    runtime,
    runtimeName,
    runtimeVersion,
    runtimeSha256,
    strategy,
  });
  if (
    configuration.runtimeVersion !==
    (configuration.runtime === 'crun' ? '1.31' : '1.3.4')
  )
    throw new Error('Docker candidate version unsupported');
  return Object.freeze(configuration);
}
