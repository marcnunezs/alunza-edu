import { z } from 'zod';

export const localVmContextSchema = z.strictObject({
  provider: z.literal('local-vm'),
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runnerVersion: z.literal('imp-03-quickjs.13'),
  hostId: z.uuid(),
  kitManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  brokerVersion: z.literal('local-vm-broker-v1'),
  guestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  brokerGeneration: z.uuid(),
});
export type LocalVmContext = z.infer<typeof localVmContextSchema>;
const configurationSchema = localVmContextSchema
  .omit({ brokerGeneration: true })
  .extend({
    socketPath: z
      .string()
      .min(1)
      .max(103)
      .regex(/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/),
  });
export type LocalVmConfiguration = Readonly<
  z.infer<typeof configurationSchema>
>;

export function loadLocalVmConfiguration(
  env: NodeJS.ProcessEnv,
): LocalVmConfiguration | undefined {
  const present = Object.keys(env).some(
    (key) => key.startsWith('PRACTICE_LOCAL_VM_') && env[key] !== undefined,
  );
  if (!present && env.PRACTICE_RUNNER_PROVIDER !== 'local-vm') return undefined;
  return Object.freeze(
    configurationSchema.parse({
      provider: 'local-vm',
      image: env.PRACTICE_LOCAL_VM_IMAGE,
      runnerVersion: 'imp-03-quickjs.13',
      hostId: env.PRACTICE_LOCAL_VM_HOST_ID,
      kitManifestSha256: env.PRACTICE_LOCAL_VM_KIT_MANIFEST_SHA256,
      brokerVersion: 'local-vm-broker-v1',
      guestSha256: env.PRACTICE_LOCAL_VM_GUEST_SHA256,
      socketPath: env.PRACTICE_LOCAL_VM_SOCKET,
    }),
  );
}

export function matchesLocalVmConfiguration(
  context: LocalVmContext,
  config: LocalVmConfiguration,
) {
  return (
    [
      'provider',
      'image',
      'runnerVersion',
      'hostId',
      'kitManifestSha256',
      'brokerVersion',
      'guestSha256',
    ] as const
  ).every((key) => context[key] === config[key]);
}
