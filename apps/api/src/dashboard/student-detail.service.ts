import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import * as c from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';
import { MATERIALS_STORAGE } from '../materials/materials.ports';
import type { MaterialsStoragePort } from '../materials/materials.ports';
import { materialHash } from '../materials/materials.service';
import { ApiError } from '../http/errors';

const privateReferenceSchema = c.studentDetailReferenceSchema.extend({
  reference: c.helpReferenceSchema.extend({
    storageKey: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

@Injectable()
export class StudentDetailService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(MATERIALS_STORAGE) private readonly storage: MaterialsStoragePort,
  ) {}

  private read<T extends { classId: string; studentId: string }>(
    who: Actor,
    sql: string,
    values: unknown[],
    schema: z.ZodType<T>,
  ) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const { rows } = await client.query<{ data: unknown }>(sql, values);
        const data = schema.parse(rows[0]?.data);
        if (data.classId !== values[0] || data.studentId !== values[1])
          throw new Error('Student detail scope mismatch.');
        return data;
      },
      who.sessionId,
    );
  }

  progress(
    who: Actor,
    cls: string,
    student: string,
    query: c.StudentDetailQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_progress($1::uuid,$2::uuid,$3::jsonb) AS data',
      [cls, student, JSON.stringify(query)],
      c.studentDetailProgressSchema,
    );
  }

  evidence(
    who: Actor,
    cls: string,
    student: string,
    query: c.StudentDetailEvidenceQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_evidence($1::uuid,$2::uuid,$3::jsonb) AS data',
      [cls, student, JSON.stringify(query)],
      c.studentDetailEvidenceSchema,
    );
  }

  attempt(
    who: Actor,
    cls: string,
    student: string,
    attempt: string,
    query: c.StudentDetailItemQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_attempt($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS data',
      [cls, student, attempt, JSON.stringify(query)],
      c.studentDetailAttemptSchema,
    );
  }

  feedbackHistory(
    who: Actor,
    cls: string,
    student: string,
    attempt: string,
    query: c.StudentDetailFeedbackQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_feedback_history($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS data',
      [cls, student, attempt, JSON.stringify(query)],
      c.studentDetailFeedbackHistorySchema,
    );
  }

  feedback(
    who: Actor,
    cls: string,
    student: string,
    feedback: string,
    query: c.StudentDetailItemQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_feedback($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS data',
      [cls, student, feedback, JSON.stringify(query)],
      c.studentDetailFeedbackSchema,
    );
  }

  private readReference(
    who: Actor,
    cls: string,
    student: string,
    feedback: string,
    chunk: string,
    query: c.StudentDetailItemQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_reference($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) AS data',
      [cls, student, feedback, chunk, JSON.stringify(query)],
      privateReferenceSchema,
    );
  }

  async reference(
    who: Actor,
    cls: string,
    student: string,
    feedback: string,
    chunk: string,
    query: c.StudentDetailItemQuery,
  ) {
    const value = await this.readReference(
      who,
      cls,
      student,
      feedback,
      chunk,
      query,
    );
    const ref = value.reference;
    return c.studentDetailReferenceSchema.parse({
      ...value,
      reference: {
        sourceId: ref.sourceId,
        versionId: ref.versionId,
        chunkId: ref.chunkId,
        title: ref.title,
        version: ref.version,
        fileName: ref.fileName,
        format: ref.format,
        locator: ref.locator,
        text: ref.text,
      },
    });
  }

  async content(
    who: Actor,
    cls: string,
    student: string,
    feedback: string,
    chunk: string,
    query: c.StudentDetailItemQuery,
  ) {
    const value = await this.readReference(
      who,
      cls,
      student,
      feedback,
      chunk,
      query,
    );
    const ref = value.reference;
    const bytes = await this.storage.download(ref.storageKey);
    if (bytes.length !== ref.sizeBytes || materialHash(bytes) !== ref.sha256)
      throw new ApiError(
        'STORAGE_UNAVAILABLE',
        'No se pudo verificar el documento citado.',
        503,
        true,
      );
    // Keep the evidence cutoff, but reauthorize the current teacher, roster and
    // source after external I/O. No student identity or presentation is assumed.
    await this.readReference(who, cls, student, feedback, chunk, {
      asOf: value.asOf,
    });
    return { bytes, mimeType: ref.mimeType, fileName: ref.fileName };
  }

  signals(
    who: Actor,
    cls: string,
    student: string,
    query: c.StudentDetailSignalsQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_signals($1::uuid,$2::uuid,$3::jsonb) AS data',
      [cls, student, JSON.stringify(query)],
      c.studentDetailSignalsSchema,
    );
  }

  signal(
    who: Actor,
    cls: string,
    student: string,
    signal: string,
    query: c.StudentDetailItemQuery,
  ) {
    return this.read(
      who,
      'SELECT app_private.student_detail_signal($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS data',
      [cls, student, signal, JSON.stringify(query)],
      c.studentDetailSignalSchema,
    );
  }
}
