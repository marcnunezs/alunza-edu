import type {
  DockerRuntimeConfig,
  DockerRuntimeIdentity,
} from '../../packages/runner/src/docker-prepared.js';
export function validateDockerRuntimeConfig(
  value: unknown,
): DockerRuntimeConfig;
export function validateDockerRuntimeEvidence(
  config: DockerRuntimeConfig,
  info: unknown,
  evidence: unknown,
): DockerRuntimeIdentity;
export function inspectDockerRuntime(
  engine: {
    request(
      method: string,
      path: string,
      options?: unknown,
    ): Promise<{ status: number; data: unknown }>;
  },
  config: DockerRuntimeConfig,
  signal?: AbortSignal,
): Promise<DockerRuntimeIdentity>;
export function runtimeConfigFromIdentity(
  identity: DockerRuntimeIdentity,
): DockerRuntimeConfig;
