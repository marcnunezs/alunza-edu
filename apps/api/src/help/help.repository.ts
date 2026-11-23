import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  helpRequestSchema,
  helpFeedbackSchema,
  helpHistorySchema,
  helpCapabilitiesSchema,
  helpReferenceSchema,
  ragHelpSchema,
} from '@alunza/contracts';
import type {
  HelpRequestInput,
  HelpHistoryQuery,
  RagHelp,
  SourceRef,
} from '@alunza/contracts';
import { HelpBoundaryError, validateVectors } from '@alunza/ai';
import type {
  EmbeddingConfiguration,
  PreparedHelpInput,
  RetrievedChunk,
} from '@alunza/ai';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';
import { ApiError } from '../http/errors';
import type {
  HelpJob,
  HelpJobContext,
  HelpCall,
  HelpPhase,
  HelpCallUsage,
} from './help.types';

const privateReferenceSchema = helpReferenceSchema.extend({
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
@Injectable()
export class HelpRepository {
  constructor(private readonly database: DatabaseService) {}
  private sql(name: string, values: unknown[]) {
    return `SELECT app_private.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`;
  }
  private async asActor<T>(
    who: Actor,
    name: string,
    values: unknown[],
    schema: z.ZodType<T>,
  ) {
    try {
      return await this.database.writeAs(
        who.actorId,
        async (client) =>
          schema.parse(
            (await client.query(this.sql(name, values), values)).rows[0]
              ?.result,
          ),
        who.sessionId,
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        [400, 403, 404, 422].includes(error.getStatus())
      ) {
        try {
          await this.database.writeAs(
            who.actorId,
            async (client) => {
              await client.query(
                'SELECT app_private.help_record_denial($1,$2,$3)',
                [values[0], name, who.requestId],
              );
            },
            who.sessionId,
          );
        } catch {
          /* A failed audit never grants access. */
        }
      }
      throw error;
    }
  }
  private internal<T>(name: string, values: unknown[] = []): Promise<T> {
    return this.database.internal(
      async (client) =>
        (await client.query(this.sql(name, values), values)).rows[0]
          ?.result as T,
    );
  }
  request(who: Actor, attemptId: string, input: HelpRequestInput, key: string) {
    return this.asActor(
      who,
      'help_reserve',
      [attemptId, input.kind, input.hintLevel ?? null, key, who.requestId],
      helpRequestSchema,
    );
  }
  requestStatus(who: Actor, requestId: string) {
    return this.asActor(
      who,
      'help_request_status',
      [requestId],
      helpRequestSchema,
    );
  }
  history(who: Actor, attemptId: string, query: HelpHistoryQuery) {
    return this.asActor(
      who,
      'help_history',
      [attemptId, query.cursor ?? null, query.limit],
      helpHistorySchema,
    );
  }
  capabilities(who: Actor, attemptId: string) {
    return this.asActor(
      who,
      'help_capabilities',
      [attemptId],
      helpCapabilitiesSchema,
    );
  }
  feedback(who: Actor, feedbackId: string) {
    return this.asActor(who, 'help_feedback', [feedbackId], helpFeedbackSchema);
  }
  viewed(who: Actor, feedbackId: string, token: string) {
    return this.asActor(
      who,
      'help_viewed',
      [feedbackId, token],
      helpFeedbackSchema,
    );
  }
  reference(who: Actor, feedbackId: string, chunkId: string) {
    return this.asActor(
      who,
      'help_reference',
      [feedbackId, chunkId],
      privateReferenceSchema,
    );
  }
  claim() {
    return this.internal<HelpJob | null>('help_claim');
  }
  renew(job: HelpJob) {
    return this.internal<boolean>('help_renew', [job.id, job.token]);
  }
  context(job: HelpJob) {
    return this.internal<HelpJobContext | null>('help_context', [
      job.id,
      job.token,
    ]);
  }
  revalidate(job: HelpJob) {
    return this.internal<boolean>('help_revalidate', [job.id, job.token]);
  }
  async retrieve(
    job: HelpJob,
    vector: readonly number[],
    config: EmbeddingConfiguration,
  ) {
    validateVectors([vector], 1, config.dimensions);
    try {
      return await this.internal<RetrievedChunk[] | null>('help_retrieve', [
        job.id,
        job.token,
        config.id,
        config.model,
        config.dimensions,
        JSON.stringify(vector),
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_REQUEST')
        throw new HelpBoundaryError('INVALID_CONFIGURATION');
      throw error;
    }
  }
  setContextRefs(job: HelpJob, refs: readonly SourceRef[]) {
    return this.internal<boolean>('help_set_context_refs', [
      job.id,
      job.token,
      JSON.stringify(refs),
    ]);
  }
  getInput(job: HelpJob) {
    return this.internal<PreparedHelpInput | null>('help_get_input', [
      job.id,
      job.token,
    ]);
  }
  configurationMatches(job: HelpJob, metadata: unknown) {
    return this.internal<boolean>('help_configuration_matches', [
      job.id,
      job.token,
      JSON.stringify(metadata),
    ]);
  }
  prepareInput(job: HelpJob, input: PreparedHelpInput, metadata: unknown) {
    return this.internal<PreparedHelpInput | null>('help_prepare_input', [
      job.id,
      job.token,
      JSON.stringify(input),
      JSON.stringify(metadata),
    ]);
  }
  beginCall(job: HelpJob, phase: HelpPhase) {
    return this.internal<HelpCall>('help_begin_call', [
      job.id,
      job.token,
      phase,
    ]);
  }
  completeCall(
    job: HelpJob,
    phase: HelpPhase,
    result: unknown,
    usage?: HelpCallUsage,
  ) {
    return this.internal<boolean>('help_complete_call', [
      job.id,
      job.token,
      phase,
      JSON.stringify(result),
      usage ? JSON.stringify(usage) : null,
    ]);
  }
  finish(job: HelpJob, rag: RagHelp, metadata: unknown) {
    return this.internal<boolean>('help_finish', [
      job.id,
      job.token,
      JSON.stringify(ragHelpSchema.parse(rag)),
      JSON.stringify(metadata),
    ]);
  }
  fail(job: HelpJob, code: string) {
    return this.internal<boolean>('help_fail', [job.id, job.token, code]);
  }
}
