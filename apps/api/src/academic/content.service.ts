import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  conceptInputSchema,
  conceptUpdateSchema,
  conceptSchema,
  conceptVersionSchema,
  exerciseCreateSchema,
  exerciseVersionInputSchema,
  exerciseSummarySchema,
  exerciseVersionSchema,
  exerciseDetailSchema,
} from '@alunza/contracts';
import {
  audit,
  checkRevision,
  idempotent,
  iso,
  pageResult,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { notFound } from '../http/errors';
import {
  AcademicAccess,
  forbidden,
  invalid,
  normalizeConcept,
  operational,
} from './academic.shared';
import type { AcademicQuery, Context } from './academic.shared';

const conceptProjection = `SELECT c.*,v.name,v.description,v.parent_concept_id,v.version,(SELECT count(*) FROM app.exercise_version_concepts ec WHERE ec.concept_id=c.id) AS uses_count FROM app.concepts c JOIN app.concept_versions v ON v.id=c.current_version_id`;
const exerciseProjection = `SELECT e.*,v.title,v.difficulty,v.version FROM app.exercises e JOIN app.exercise_versions v ON v.id=e.current_version_id`;
function concept(row: Record<string, unknown>) {
  return conceptSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    revision: Number(row.revision),
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: iso(row.archived_at as Date | null),
    currentVersionId: row.current_version_id,
    name: row.name,
    description: row.description,
    parentId: row.parent_concept_id,
    version: Number(row.version),
    usesCount: Number(row.uses_count ?? 0),
  });
}
function exercise(row: Record<string, unknown>) {
  return exerciseSummarySchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    ownerId: row.owner_id,
    visibility: row.visibility,
    currentVersionId: row.current_version_id,
    revision: Number(row.revision),
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: iso(row.archived_at as Date | null),
    title: row.title,
    difficulty: row.difficulty,
    version: Number(row.version),
  });
}
export function validateExercise(
  input: z.infer<typeof exerciseVersionInputSchema>,
) {
  if (Buffer.byteLength(input.starterCode, 'utf8') > 65536)
    throw invalid('La plantilla supera 64 KiB UTF-8.', 'starterCode');
  if (Buffer.byteLength(JSON.stringify(input.tests), 'utf8') > 65536)
    throw invalid('Las pruebas superan 64 KiB UTF-8.', 'tests');
  for (let i = 0; i < input.tests.length; i++) {
    for (let j = i + 1; j < input.tests.length; j++) {
      const left = input.tests[i]!;
      const right = input.tests[j]!;
      if (
        isDeepStrictEqual(left.args, right.args) &&
        !isDeepStrictEqual(left.expected, right.expected)
      )
        throw invalid(
          'Las mismas entradas no pueden tener resultados esperados diferentes.',
          'tests',
        );
    }
  }
}

@Injectable()
export class ContentService {
  constructor(private readonly access: AcademicAccess) {}

  concepts(who: Actor, org: string, query: AcademicQuery) {
    return this.access.organization(
      who,
      org,
      false,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        const rows = await ctx.client.query(
          `${conceptProjection} WHERE c.organization_id=$1 AND ($2::uuid IS NULL OR c.id>$2) AND ($3::text IS NULL OR v.name ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN c.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4) ORDER BY c.id LIMIT $5`,
          [
            org,
            query.cursor ?? null,
            query.search ?? null,
            query.state ?? null,
            query.limit + 1,
          ],
        );
        return pageResult(rows.rows.map(concept), query.limit, (row) => row.id);
      },
    );
  }
  concept(who: Actor, id: string) {
    return this.access.resource(
      who,
      'concept',
      id,
      false,
      ['ADMIN', 'TEACHER'],
      async (ctx) => concept(await this.conceptRow(ctx, id)),
    );
  }
  conceptVersions(who: Actor, id: string, query: AcademicQuery) {
    return this.access.resource(
      who,
      'concept',
      id,
      false,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        await this.conceptRow(ctx, id);
        const rows = await ctx.client.query(
          'SELECT * FROM app.concept_versions WHERE concept_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
          [id, query.cursor ?? null, query.limit + 1],
        );
        return pageResult(
          rows.rows.map((row) =>
            conceptVersionSchema.parse({
              id: row.id,
              conceptId: row.concept_id,
              version: row.version,
              name: row.name,
              description: row.description,
              parentId: row.parent_concept_id,
              createdAt: iso(row.created_at),
            }),
          ),
          query.limit,
          (row) => row.id,
        );
      },
    );
  }
  createConcept(
    who: Actor,
    org: string,
    input: z.infer<typeof conceptInputSchema>,
    key: string,
  ) {
    return this.access.organization(who, org, true, ['ADMIN'], (ctx) =>
      idempotent(
        ctx.client,
        who,
        org,
        'concept.create',
        key,
        input,
        201,
        async () => {
          const id = randomUUID();
          const versionId = randomUUID();
          await this.validateParent(ctx, id, input.parentId);
          await ctx.client.query(
            'INSERT INTO app.concepts(id,organization_id,normalized_name) VALUES($1,$2,$3)',
            [id, org, normalizeConcept(input.name)],
          );
          await ctx.client.query(
            'INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,parent_concept_id,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7)',
            [
              versionId,
              org,
              id,
              input.name,
              input.description,
              input.parentId,
              who.actorId,
            ],
          );
          await ctx.client.query(
            'UPDATE app.concepts SET current_version_id=$2 WHERE id=$1',
            [id, versionId],
          );
          await audit(ctx.client, who, org, 'concept.created', 'concept', id);
          return {
            data: concept(await this.conceptRow(ctx, id)),
            resourceId: id,
            resourceType: 'concept',
          };
        },
      ),
    );
  }
  updateConcept(
    who: Actor,
    id: string,
    input: z.infer<typeof conceptUpdateSchema>,
    expected: number,
  ) {
    return this.access.resource(
      who,
      'concept',
      id,
      true,
      ['ADMIN'],
      async (ctx) => {
        const row = await this.conceptRow(ctx, id);
        operational(row);
        checkRevision(row.revision, expected);
        const value = { ...concept(row), ...input };
        await this.validateParent(ctx, id, value.parentId);
        const versionId = randomUUID();
        await ctx.client.query(
          'INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,parent_concept_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            versionId,
            ctx.organizationId,
            id,
            Number(row.version) + 1,
            value.name,
            value.description,
            value.parentId,
            who.actorId,
          ],
        );
        await ctx.client.query(
          'UPDATE app.concepts SET current_version_id=$2,normalized_name=$3,revision=revision+1,updated_at=now() WHERE id=$1',
          [id, versionId, normalizeConcept(value.name)],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'concept.updated',
          'concept',
          id,
          { versionId },
        );
        return concept(await this.conceptRow(ctx, id));
      },
    );
  }
  archiveConcept(who: Actor, id: string, expected: number) {
    return this.access.resource(
      who,
      'concept',
      id,
      true,
      ['ADMIN'],
      async (ctx) => {
        const row = await this.conceptRow(ctx, id);
        checkRevision(row.revision, expected);
        operational(row);
        await ctx.client.query(
          'UPDATE app.concepts SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1',
          [id],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'concept.archived',
          'concept',
          id,
          { retainedUses: Number(row.uses_count) },
        );
        return concept(await this.conceptRow(ctx, id));
      },
    );
  }
  exercises(who: Actor, org: string, query: AcademicQuery) {
    return this.access.organization(
      who,
      org,
      false,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        const rows = await ctx.client.query(
          `${exerciseProjection} WHERE e.organization_id=$1 AND ($2::uuid IS NULL OR e.id>$2) AND ($3::text IS NULL OR v.title ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN e.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4) ORDER BY e.id LIMIT $5`,
          [
            org,
            query.cursor ?? null,
            query.search ?? null,
            query.state ?? null,
            query.limit + 1,
          ],
        );
        return pageResult(
          rows.rows.map(exercise),
          query.limit,
          (row) => row.id,
        );
      },
    );
  }
  exercise(who: Actor, id: string) {
    return this.access.resource(
      who,
      'exercise',
      id,
      false,
      ['ADMIN', 'TEACHER'],
      (ctx) => this.exerciseDetail(ctx, id),
    );
  }
  versions(who: Actor, id: string, query: AcademicQuery) {
    return this.access.resource(
      who,
      'exercise',
      id,
      false,
      ['ADMIN', 'TEACHER'],
      async (ctx) => {
        await this.exerciseRow(ctx, id);
        const rows = await ctx.client.query(
          'SELECT * FROM app.exercise_versions WHERE exercise_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
          [id, query.cursor ?? null, query.limit + 1],
        );
        const versions = [];
        for (const row of rows.rows)
          versions.push(await this.version(ctx, row));
        return pageResult(versions, query.limit, (row) => row.id);
      },
    );
  }
  createExercise(
    who: Actor,
    org: string,
    input: z.infer<typeof exerciseCreateSchema>,
    key: string,
  ) {
    validateExercise(input);
    return this.access.organization(who, org, true, ['TEACHER'], (ctx) =>
      idempotent(
        ctx.client,
        who,
        org,
        'exercise.create',
        key,
        input,
        201,
        async () => {
          if (
            !(
              await ctx.client.query(
                'SELECT id FROM app.classes WHERE teacher_id=$1 AND organization_id=$2 AND archived_at IS NULL LIMIT 1',
                [who.actorId, org],
              )
            ).rowCount
          )
            throw invalid(
              'Crea o recibe una clase activa antes de preparar ejercicios.',
            );
          const id = randomUUID();
          await ctx.client.query(
            'INSERT INTO app.exercises(id,organization_id,owner_id,visibility) VALUES($1,$2,$3,$4)',
            [id, org, who.actorId, input.visibility],
          );
          const versionId = await this.insertVersion(ctx, id, 1, input);
          await ctx.client.query(
            'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
            [id, versionId],
          );
          await audit(
            ctx.client,
            who,
            org,
            'exercise.created',
            'exercise',
            id,
            { versionId },
          );
          return {
            data: await this.exerciseDetail(ctx, id),
            resourceId: id,
            resourceType: 'exercise',
          };
        },
      ),
    );
  }
  createVersion(
    who: Actor,
    id: string,
    input: z.infer<typeof exerciseVersionInputSchema>,
    expected: number,
    key: string,
  ) {
    validateExercise(input);
    return this.access.resource(
      who,
      'exercise',
      id,
      true,
      ['TEACHER'],
      async (ctx) => {
        const row = await this.exerciseRow(ctx, id);
        operational(row);
        if (row.owner_id !== who.actorId) throw forbidden();
        return idempotent(
          ctx.client,
          who,
          ctx.organizationId,
          'exercise.version',
          key,
          { ...input, id, revision: expected },
          201,
          async () => {
            checkRevision(row.revision, expected);
            const versionId = await this.insertVersion(
              ctx,
              id,
              Number(row.version) + 1,
              input,
            );
            await ctx.client.query(
              'UPDATE app.exercises SET current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',
              [id, versionId],
            );
            await audit(
              ctx.client,
              who,
              ctx.organizationId,
              'exercise.version_created',
              'exercise',
              id,
              { versionId },
            );
            return {
              data: await this.exerciseDetail(ctx, id),
              resourceId: id,
              resourceType: 'exercise',
            };
          },
        );
      },
    );
  }
  archiveExercise(who: Actor, id: string, expected: number) {
    return this.access.resource(
      who,
      'exercise',
      id,
      true,
      ['ADMIN'],
      async (ctx) => {
        const row = await this.exerciseRow(ctx, id);
        operational(row);
        checkRevision(row.revision, expected);
        await ctx.client.query(
          'UPDATE app.exercises SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1',
          [id],
        );
        await audit(
          ctx.client,
          who,
          ctx.organizationId,
          'exercise.archived',
          'exercise',
          id,
        );
        return exercise(await this.exerciseRow(ctx, id));
      },
    );
  }
  private async conceptRow(ctx: Context, id: string) {
    const row = (
      await ctx.client.query(
        `${conceptProjection} WHERE c.id=$1 AND c.organization_id=$2`,
        [id, ctx.organizationId],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async validateParent(
    ctx: Context,
    id: string,
    parent: string | null,
  ) {
    let cursor = parent;
    const visited = new Set<string>([id]);
    while (cursor) {
      if (visited.has(cursor))
        throw invalid(
          'La relación produciría un ciclo entre conceptos.',
          'parentId',
        );
      visited.add(cursor);
      const row = await this.conceptRow(ctx, cursor);
      operational(row);
      cursor = row.parent_concept_id as string | null;
      if (visited.size > 1000)
        throw invalid(
          'La jerarquía de conceptos supera el límite permitido.',
          'parentId',
        );
    }
  }
  private async exerciseRow(ctx: Context, id: string) {
    const row = (
      await ctx.client.query(
        `${exerciseProjection} WHERE e.id=$1 AND e.organization_id=$2`,
        [id, ctx.organizationId],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async exerciseDetail(ctx: Context, id: string) {
    const row = await this.exerciseRow(ctx, id);
    const v = (
      await ctx.client.query(
        'SELECT * FROM app.exercise_versions WHERE id=$1',
        [row.current_version_id],
      )
    ).rows[0];
    if (!v) throw notFound();
    return exerciseDetailSchema.parse({
      ...exercise(row),
      currentVersion: await this.version(ctx, v),
    });
  }
  private async version(ctx: Context, row: Record<string, unknown>) {
    const concepts = await ctx.client.query(
      `SELECT ec.concept_id,ec.concept_version_id,v.name,v.version
       FROM app.exercise_version_concepts ec JOIN app.concept_versions v
         ON v.id=ec.concept_version_id AND v.organization_id=ec.organization_id
       WHERE ec.exercise_version_id=$1 ORDER BY ec.concept_version_id`,
      [row.id],
    );
    const tests = await ctx.client.query(
      'SELECT id,visibility,args,expected,comparator FROM app_private.exercise_tests WHERE exercise_version_id=$1 ORDER BY position',
      [row.id],
    );
    return exerciseVersionSchema.parse({
      id: row.id,
      exerciseId: row.exercise_id,
      version: Number(row.version),
      title: row.title,
      statement: row.statement,
      starterCode: row.starter_code,
      language: row.language,
      difficulty: row.difficulty,
      entrypoint: row.entrypoint,
      executionLimits: row.execution_limits,
      conceptVersionIds: concepts.rows.map((c) => c.concept_version_id),
      concepts: concepts.rows.map((c) => ({
        id: c.concept_id,
        versionId: c.concept_version_id,
        name: c.name,
        version: Number(c.version),
      })),
      tests: tests.rows,
      createdAt: iso(row.created_at as Date),
    });
  }
  private async insertVersion(
    ctx: Context,
    exerciseId: string,
    version: number,
    input: z.infer<typeof exerciseVersionInputSchema>,
  ) {
    const concepts = await ctx.client.query(
      `SELECT v.id,v.concept_id,c.archived_at FROM app.concept_versions v JOIN app.concepts c ON c.id=v.concept_id WHERE v.id=ANY($1::uuid[]) AND v.organization_id=$2 AND c.current_version_id=v.id`,
      [input.conceptVersionIds, ctx.organizationId],
    );
    if (
      concepts.rowCount !== input.conceptVersionIds.length ||
      concepts.rows.some((c) => c.archived_at) ||
      new Set(concepts.rows.map((c) => c.concept_id)).size !== concepts.rowCount
    )
      throw invalid(
        'Selecciona conceptos activos distintos de esta organización.',
        'conceptVersionIds',
      );
    const id = randomUUID();
    await ctx.client.query(
      `INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,language,difficulty,entrypoint,execution_limits,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [
        id,
        ctx.organizationId,
        exerciseId,
        version,
        input.title,
        input.statement,
        input.starterCode,
        input.language,
        input.difficulty,
        input.entrypoint,
        JSON.stringify(input.executionLimits),
        ctx.who.actorId,
      ],
    );
    for (const c of concepts.rows)
      await ctx.client.query(
        'INSERT INTO app.exercise_version_concepts(organization_id,exercise_version_id,concept_id,concept_version_id) VALUES($1,$2,$3,$4)',
        [ctx.organizationId, id, c.concept_id, c.id],
      );
    for (const [position, test] of input.tests.entries())
      await ctx.client.query(
        'INSERT INTO app_private.exercise_tests(id,organization_id,exercise_version_id,position,visibility,args,expected,comparator) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)',
        [
          randomUUID(),
          ctx.organizationId,
          id,
          position,
          test.visibility,
          JSON.stringify(test.args),
          JSON.stringify(test.expected),
          test.comparator,
        ],
      );
    return id;
  }
}
