import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import type {
  ExecutionAuthority,
  ExecutionContext,
  PracticeExecutionInput,
  RunnerInspection,
} from './execution.port';
import type { SubmissionExecutionInput } from './submission-execution.port';
import { LocalVmClient } from './local-vm-client';
import { LocalVmResourceRepository } from './local-vm-resource.repository';
import {
  localVmContextSchema,
  matchesLocalVmConfiguration,
} from './local-vm-config';
import { validateCleanup, validateVmExecution } from './local-vm-contract';
import type { VmResourceIdentity } from './local-vm-contract';

@Injectable()
export class LocalVmRunnerService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly client: LocalVmClient,
    private readonly resources: LocalVmResourceRepository,
  ) {}

  async inspect(): Promise<RunnerInspection> {
    const version = 'imp-03-quickjs.13';
    try {
      if (!this.config.localVmConfiguration)
        return { available: false, runnerVersion: version };
      const value = z
        .strictObject({
          available: z.boolean(),
          capacity: z.enum(['READY', 'BUSY', 'UNCERTAIN']),
          context: localVmContextSchema.nullable(),
        })
        .parse(await this.client.call('/inspect', {}, 2000));
      if (
        !value.available ||
        !value.context ||
        !matchesLocalVmConfiguration(
          value.context,
          this.config.localVmConfiguration,
        )
      )
        return { available: false, runnerVersion: version };
      return {
        available: true,
        runnerVersion: version,
        context: Object.freeze(value.context),
        capacity: value.capacity,
      };
    } catch {
      return { available: false, runnerVersion: version };
    }
  }

  async execute(
    input: PracticeExecutionInput | SubmissionExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    const admitted = localVmContextSchema.parse(context),
      config = this.config.localVmConfiguration;
    if (
      !config ||
      !matchesLocalVmConfiguration(admitted, config) ||
      !authority ||
      !Number.isFinite(authority.normalDeadlineMs) ||
      !Number.isFinite(authority.cleanupDeadlineMs) ||
      authority.normalDeadlineMs <= Date.now() ||
      authority.cleanupDeadlineMs - authority.normalDeadlineMs !== 10000
    )
      throw new Error('Local VM execution authority rejected');
    const runner = await import('@alunza/runner');
    const validated = runner.executionSchema.parse(input);
    const inputJson = JSON.stringify(validated);
    if (Buffer.byteLength(inputJson) > 1572864)
      throw new Error('Local VM input too large');
    const inputSha256 = createHash('sha256').update(inputJson).digest('hex');
    const durable = await this.resources.begin(
      input.executionId,
      authority,
      inputSha256,
    );
    if (
      !isDeepStrictEqual(durable.context, admitted) ||
      durable.executionId !== input.executionId ||
      durable.creationState !== 'UNKNOWN' ||
      durable.cleanupState !== 'PENDING' ||
      durable.resourceId !== null ||
      durable.inputSha256 !== inputSha256
    )
      throw new Error('Local VM admission changed');
    const prepared = z
      .strictObject({ resourceId: z.uuid(), context: localVmContextSchema })
      .parse(
        await this.client.call(
          '/prepare',
          {
            executionId: input.executionId,
            creationId: durable.creationId,
            context: admitted,
            normalDeadlineMs: authority.normalDeadlineMs,
            cleanupDeadlineMs: authority.cleanupDeadlineMs,
            inputSha256,
          },
          Math.min(2000, authority.normalDeadlineMs - Date.now()),
        ),
      );
    if (!isDeepStrictEqual(prepared.context, admitted))
      throw new Error('Local VM prepare identity mismatch');
    const confirmed = await this.resources.confirm(
      input.executionId,
      durable.creationId,
      prepared.resourceId,
    );
    const resource: VmResourceIdentity = {
      executionId: input.executionId,
      creationId: durable.creationId,
      resourceId: prepared.resourceId,
      context: admitted,
    };
    if (
      confirmed.executionId !== input.executionId ||
      confirmed.creationId !== durable.creationId ||
      confirmed.creationState !== 'CONFIRMED' ||
      confirmed.cleanupState !== 'PENDING' ||
      confirmed.resourceId !== resource.resourceId ||
      !isDeepStrictEqual(confirmed.context, admitted)
    )
      throw new Error('Local VM creation fenced');
    // A committed ledger and live lease precede the only input-bearing request.
    await this.resources.assertActive(
      input.executionId,
      authority.leaseToken,
      admitted,
    );
    if (authority.normalDeadlineMs <= Date.now())
      throw new Error('Local VM admission expired');
    let reply: unknown;
    try {
      reply = await this.client.call(
        '/start',
        { ...resource, inputJson },
        authority.normalDeadlineMs - Date.now(),
      );
    } catch (error) {
      // A lost response may be recovered within the same lease, never replayed.
      await this.resources.assertActive(
        input.executionId,
        authority.leaseToken,
        admitted,
      );
      if (authority.normalDeadlineMs <= Date.now()) throw error;
      const status = z
        .strictObject({
          state: z.enum(['PREPARED', 'STARTING', 'CLOSED']),
          resource: z.unknown(),
          cleanupVerified: z.boolean(),
          result: z.unknown().nullable(),
        })
        .parse(
          await this.client.call(
            '/status',
            resource,
            Math.min(2000, authority.normalDeadlineMs - Date.now()),
          ),
        );
      if (
        status.state !== 'CLOSED' ||
        !isDeepStrictEqual(status.resource, resource) ||
        !status.result
      )
        throw error;
      reply = status.result;
    }
    const checked = await validateVmExecution(reply, input, resource);
    // Even a valid result cannot assert durable retirement without a correlated
    // proof from the broker. SUBMIT can stage it if this confirmation fails.
    const cleanupVerified = await this.cleanup(
      input.executionId,
      admitted,
      authority.cleanupDeadlineMs - Date.now(),
    );
    return {
      result: checked.result,
      cleanupVerified: checked.cleanupVerified && cleanupVerified,
    };
  }

  async cleanup(
    executionId: string,
    context?: ExecutionContext,
    timeoutMs = 10000,
  ) {
    try {
      const resource = await this.resources.load(executionId);
      if (
        !resource ||
        (context && !isDeepStrictEqual(resource.context, context))
      )
        return false;
      if (resource.cleanupState === 'VERIFIED') return true;
      const identity: VmResourceIdentity = {
        executionId: resource.executionId,
        creationId: resource.creationId,
        resourceId: resource.resourceId,
        context: resource.context,
      };
      const receipt = validateCleanup(
        await this.client.call(
          '/cleanup',
          identity,
          Math.min(10000, timeoutMs),
        ),
        identity,
      );
      await this.resources.verifyCleanup(executionId, receipt.proof);
      return true;
    } catch {
      return false;
    }
  }
}
