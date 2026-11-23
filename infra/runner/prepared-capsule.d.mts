import type {
  CapsuleInput,
  CapsuleResult,
} from '../../packages/runner/src/index.js';
import type {
  DockerPreparedPair,
  DockerPreparedSlot,
  DockerPreparedResourcePort,
  DockerRuntimeConfig,
} from '../../packages/runner/src/docker-prepared.js';
export type PreparedCapsule = {
  readonly resourceId: string;
  readonly boundary: string;
  usable(): boolean;
  cleanup(signal?: AbortSignal): Promise<boolean>;
  consume(
    input: CapsuleInput,
    options: {
      signal?: AbortSignal;
      deadlineMs: number;
      cleanupDeadlineMs: number;
      beforeSend(): Promise<void>;
    },
  ): Promise<CapsuleResult>;
};
export function prepareDockerCapsule(
  pair: DockerPreparedPair,
  slot: DockerPreparedSlot,
  config: DockerRuntimeConfig,
  resources: DockerPreparedResourcePort,
  signal?: AbortSignal,
  cleanupDeadlineMs?: number,
): Promise<PreparedCapsule>;
export function cleanupPreparedSlot(
  pair: DockerPreparedPair,
  slot: DockerPreparedSlot,
  resources: DockerPreparedResourcePort,
  signal?: AbortSignal,
): Promise<boolean>;
export function validatePreparedInspection(
  value: unknown,
  pair: DockerPreparedPair,
  slot: DockerPreparedSlot,
  requireRunning?: boolean,
): void;
export function cleanupBoundDockerExecution(
  executionId: string,
  context: { engineId: string },
  signal?: AbortSignal,
): Promise<{ cleanupVerified: boolean; removed: number }>;
