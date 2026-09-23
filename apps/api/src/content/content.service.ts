import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  conceptSchema,
  exerciseSchema,
  exerciseVersionSchema,
  normalizeConceptName,
} from '@alunza/contracts';
import type { ExerciseVersionInput } from '@alunza/contracts';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ApiError, notFound } from '../http/errors';
import {
  audit,
  checkRevision,
  idempotent,
  iso,
  pageResult,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import {
  academicContext,
  available,
  forbidden,
  resource,
} from '../academic/academic.shared';
import type { AcademicQuery } from '../academic/academic.shared';

type ConceptInput = {
  name: string;
  description?: string;
  parentId?: string | null;
};
const conceptSelect = `SELECT t.*,v.name,v.description,v.parent_concept_id,(SELECT count(*)::int FROM app.exercise_version_concepts evc JOIN app.concept_versions cv ON cv.id=evc.concept_version_id WHERE cv.concept_id=t.id) AS references FROM app.concept_tags t JOIN app.concept_versions v ON v.id=t.current_version_id`;
function projectConcept(row: Record<string, unknown>) {
  return conceptSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    currentVersionId: row.current_version_id,
    name: row.name,
    description: row.description,
    parentId: row.parent_concept_id,
    revision: row.revision,
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
    references: row.references,
  });
}
const exerciseSelect = `SELECT e.*,v.title,v.difficulty FROM app.exercises e JOIN app.exercise_versions v ON v.id=e.current_version_id`;
function projectExercise(row: Record<string, unknown>) {
  return exerciseSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    ownerId: row.owner_id,
    visibility: row.visibility,
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
    revision: row.revision,
    currentVersionId: row.current_version_id,
    title: row.title,
    difficulty: row.difficulty,
  });
}
export async function projectVersion(
  client: PoolClient,
  row: Record<string, unknown>,
) {
  const concepts = (
    await client.query(
      'SELECT concept_version_id FROM app.exercise_version_concepts WHERE exercise_version_id=$1 ORDER BY concept_version_id',
      [row.id],
    )
  ).rows;
  const tests = (
    await client.query(
      'SELECT test_id,visibility,args,expected FROM app_private.exercise_tests WHERE exercise_version_id=$1 ORDER BY position',
      [row.id],
    )
  ).rows;
  return exerciseVersionSchema.parse({
    id: row.id,
    exerciseId: row.exercise_id,
    version: row.version,
    title: row.title,
    statement: row.statement,
    starterCode: row.starter_code,
    language: row.language,
    entrypoint: row.entrypoint,
    difficulty: row.difficulty,
    conceptVersionIds: concepts.map((c) => c.concept_version_id),
    tests: tests.map((t) => ({
      id: t.test_id,
      visibility: t.visibility,
      args: t.args,
      expected: t.expected,
    })),
    executionLimits: row.execution_limits,
    createdAt: iso(row.created_at as Date),
  });
}

@Injectable()
export class ContentService {
  constructor(private readonly database: DatabaseService) {}
  async concepts(who: Actor, org: string, query: AcademicQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await academicContext(client, who, org, false, ['ADMIN', 'TEACHER']);
        const rows = (
          await client.query(
            `${conceptSelect} WHERE t.organization_id=$1 AND ($2::uuid IS NULL OR t.id>$2) AND ($3::text IS NULL OR v.name ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN t.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4) ORDER BY t.id LIMIT $5`,
            [
              org,
              query.cursor ?? null,
              query.search ?? null,
              query.state ?? null,
              query.limit + 1,
            ],
          )
        ).rows;
        return pageResult(
          rows.map(projectConcept),
          query.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  private async concept(client: PoolClient, id: string) {
    const row = (await client.query(`${conceptSelect} WHERE t.id=$1`, [id]))
      .rows[0];
    if (!row) throw notFound();
    return projectConcept(row);
  }
  async getConcept(who: Actor, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await resource(client, who, 'concept', id, false, ['ADMIN', 'TEACHER']);
        return this.concept(client, id);
      },
      who.sessionId,
    );
  }
  private async validateParent(
    client: PoolClient,
    org: string,
    id: string,
    parentId: string | null,
  ) {
    if (!parentId) return;
    const parent = (
      await client.query(
        'SELECT id,archived_at FROM app.concept_tags WHERE organization_id=$1 AND id=$2',
        [org, parentId],
      )
    ).rows[0];
    if (!parent) throw notFound();
    available(parent);
    const cycle = (
      await client.query(
        `WITH RECURSIVE ancestors(id,parent_id,path) AS (SELECT t.id,v.parent_concept_id,ARRAY[t.id] FROM app.concept_tags t JOIN app.concept_versions v ON v.id=t.current_version_id WHERE t.id=$1 UNION ALL SELECT t.id,v.parent_concept_id,a.path||t.id FROM ancestors a JOIN app.concept_tags t ON t.id=a.parent_id JOIN app.concept_versions v ON v.id=t.current_version_id WHERE NOT t.id=ANY(a.path)) SELECT id FROM ancestors WHERE id=$2 LIMIT 1`,
        [parentId, id],
      )
    ).rows[0];
    if (cycle)
      throw new ApiError(
        'CONCEPT_CYCLE',
        'La relación crearía un ciclo de conceptos.',
        422,
        false,
        [
          {
            field: 'parentId',
            message: 'Selecciona un concepto fuera de esta rama.',
          },
        ],
      );
  }
  async createConcept(
    who: Actor,
    org: string,
    input: ConceptInput,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        await academicContext(client, who, org, true, ['ADMIN']);
        return idempotent(
          client,
          who,
          org,
          'concept.create',
          key,
          input,
          201,
          async () => {
            const id = randomUUID(),
              versionId = randomUUID();
            await this.validateParent(client, org, id, input.parentId ?? null);
            await client.query(
              'INSERT INTO app.concept_tags(id,organization_id,normalized_name) VALUES($1,$2,$3)',
              [id, org, normalizeConceptName(input.name)],
            );
            await client.query(
              'INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,parent_concept_id,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7)',
              [
                versionId,
                org,
                id,
                input.name,
                input.description ?? '',
                input.parentId ?? null,
                who.actorId,
              ],
            );
            await client.query(
              'UPDATE app.concept_tags SET current_version_id=$2 WHERE id=$1',
              [id, versionId],
            );
            await audit(client, who, org, 'concept.created', 'concept', id);
            return {
              data: await this.concept(client, id),
              resourceId: id,
              resourceType: 'concept',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async updateConcept(
    who: Actor,
    id: string,
    input: Partial<ConceptInput>,
    expected: number,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(client, who, 'concept', id, true, [
          'ADMIN',
        ]);
        available(row);
        checkRevision(row.revision, expected);
        const current = (
          await client.query('SELECT * FROM app.concept_versions WHERE id=$1', [
            row.current_version_id,
          ])
        ).rows[0];
        const parentId =
          input.parentId === undefined
            ? current.parent_concept_id
            : input.parentId;
        await this.validateParent(client, row.organization_id, id, parentId);
        const versionId = randomUUID();
        await client.query(
          'INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,parent_concept_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            versionId,
            row.organization_id,
            id,
            current.version + 1,
            input.name ?? current.name,
            input.description ?? current.description,
            parentId,
            who.actorId,
          ],
        );
        await client.query(
          'UPDATE app.concept_tags SET normalized_name=$2,current_version_id=$3,revision=revision+1,updated_at=now() WHERE id=$1',
          [id, normalizeConceptName(input.name ?? current.name), versionId],
        );
        await audit(
          client,
          who,
          row.organization_id,
          'concept.version.created',
          'concept',
          id,
          { versionId },
        );
        return this.concept(client, id);
      },
      who.sessionId,
    );
  }
  async archiveConcept(
    who: Actor,
    id: string,
    reason: string,
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(client, who, 'concept', id, true, [
          'ADMIN',
        ]);
        return idempotent(
          client,
          who,
          row.organization_id,
          'concept.archive',
          key,
          { id, reason, expected },
          200,
          async () => {
            checkRevision(row.revision, expected);
            available(row);
            await client.query(
              'UPDATE app.concept_tags SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1',
              [id],
            );
            await audit(
              client,
              who,
              row.organization_id,
              'concept.archived',
              'concept',
              id,
              { reason, preservedReferences: true },
            );
            return {
              data: await this.concept(client, id),
              resourceId: id,
              resourceType: 'concept',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async exercises(
    who: Actor,
    org: string,
    query: AcademicQuery & { conceptId?: string; difficulty?: string },
  ) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await academicContext(client, who, org, false, ['ADMIN', 'TEACHER']);
        const rows = (
          await client.query(
            `${exerciseSelect} WHERE e.organization_id=$1 AND ($2::uuid IS NULL OR e.id>$2) AND ($3::text IS NULL OR v.title ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN e.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4) AND ($6::text IS NULL OR v.difficulty=$6) AND ($7::uuid IS NULL OR EXISTS(SELECT 1 FROM app.exercise_version_concepts link JOIN app.concept_versions cv ON cv.id=link.concept_version_id WHERE link.exercise_version_id=v.id AND cv.concept_id=$7)) ORDER BY e.id LIMIT $5`,
            [
              org,
              query.cursor ?? null,
              query.search ?? null,
              query.state ?? null,
              query.limit + 1,
              query.difficulty ?? null,
              query.conceptId ?? null,
            ],
          )
        ).rows;
        return pageResult(
          rows.map(projectExercise),
          query.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  private async exercise(client: PoolClient, id: string) {
    const row = (await client.query(`${exerciseSelect} WHERE e.id=$1`, [id]))
      .rows[0];
    if (!row) throw notFound();
    return projectExercise(row);
  }
  async getExercise(who: Actor, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await resource(client, who, 'exercise', id, false, [
          'ADMIN',
          'TEACHER',
        ]);
        return this.exercise(client, id);
      },
      who.sessionId,
    );
  }
  private async insertVersion(
    client: PoolClient,
    who: Actor,
    org: string,
    exerciseId: string,
    input: ExerciseVersionInput,
    version: number,
    id = randomUUID(),
  ) {
    const concepts = (
      await client.query(
        'SELECT v.id FROM app.concept_versions v JOIN app.concept_tags t ON t.id=v.concept_id WHERE v.organization_id=$1 AND v.id=ANY($2::uuid[]) AND t.archived_at IS NULL',
        [org, input.conceptVersionIds],
      )
    ).rows;
    if (concepts.length !== input.conceptVersionIds.length)
      throw new ApiError(
        'VALIDATION_FAILED',
        'Los conceptos deben estar activos en esta organización.',
        422,
        false,
        [
          {
            field: 'conceptVersionIds',
            message: 'Revisa los conceptos seleccionados.',
          },
        ],
      );
    const row = (
      await client.query(
        'INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,language,entrypoint,difficulty,execution_limits,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING *',
        [
          id,
          org,
          exerciseId,
          version,
          input.title,
          input.statement,
          input.starterCode,
          input.language,
          input.entrypoint,
          input.difficulty,
          JSON.stringify(input.executionLimits),
          who.actorId,
        ],
      )
    ).rows[0];
    for (const conceptId of input.conceptVersionIds)
      await client.query(
        'INSERT INTO app.exercise_version_concepts(organization_id,exercise_version_id,concept_version_id) VALUES($1,$2,$3)',
        [org, id, conceptId],
      );
    for (const [position, test] of input.tests.entries())
      await client.query(
        'INSERT INTO app_private.exercise_tests(id,organization_id,exercise_version_id,test_id,position,visibility,args,expected) VALUES($1,$2,$3,$4,$5,$6,$7::json,$8::json)',
        [
          randomUUID(),
          org,
          id,
          test.id,
          position,
          test.visibility,
          JSON.stringify(test.args),
          JSON.stringify(test.expected),
        ],
      );
    return row;
  }
  async createExercise(
    who: Actor,
    org: string,
    input: ExerciseVersionInput,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { role } = await academicContext(client, who, org, true, [
          'TEACHER',
        ]);
        if (
          role === 'TEACHER' &&
          !(
            await client.query(
              'SELECT id FROM app.classes WHERE organization_id=$1 AND teacher_id=$2 AND archived_at IS NULL LIMIT 1',
              [org, who.actorId],
            )
          ).rows[0]
        )
          forbidden();
        return idempotent(
          client,
          who,
          org,
          'exercise.create',
          key,
          input,
          201,
          async () => {
            const id = randomUUID(),
              versionId = randomUUID();
            await client.query(
              "INSERT INTO app.exercises(id,organization_id,owner_id,visibility) VALUES($1,$2,$3,'PRIVATE')",
              [id, org, who.actorId],
            );
            await this.insertVersion(client, who, org, id, input, 1, versionId);
            await client.query(
              'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
              [id, versionId],
            );
            await audit(client, who, org, 'exercise.created', 'exercise', id, {
              versionId,
            });
            return {
              data: await this.exercise(client, id),
              resourceId: id,
              resourceType: 'exercise',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async versions(who: Actor, id: string, query: AcademicQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await resource(client, who, 'exercise', id, false, [
          'ADMIN',
          'TEACHER',
        ]);
        const rows = (
          await client.query(
            'SELECT * FROM app.exercise_versions WHERE exercise_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
            [id, query.cursor ?? null, query.limit + 1],
          )
        ).rows;
        return pageResult(
          await Promise.all(rows.map((row) => projectVersion(client, row))),
          query.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  async createVersion(
    who: Actor,
    id: string,
    input: ExerciseVersionInput,
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row, role } = await resource(
          client,
          who,
          'exercise',
          id,
          true,
          ['TEACHER'],
        );
        available(row);
        if (role !== 'TEACHER' || row.owner_id !== who.actorId) forbidden();
        return idempotent(
          client,
          who,
          row.organization_id,
          'exercise.version',
          key,
          { id, input, expected },
          201,
          async () => {
            checkRevision(row.revision, expected);
            const current = (
              await client.query(
                'SELECT version FROM app.exercise_versions WHERE id=$1',
                [row.current_version_id],
              )
            ).rows[0];
            const version = await this.insertVersion(
              client,
              who,
              row.organization_id,
              id,
              input,
              current.version + 1,
            );
            await client.query(
              'UPDATE app.exercises SET current_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',
              [id, version.id],
            );
            await audit(
              client,
              who,
              row.organization_id,
              'exercise.version.created',
              'exercise',
              id,
              { versionId: version.id },
            );
            return {
              data: await projectVersion(client, version),
              resourceId: String(version.id),
              resourceType: 'exercise_version',
            };
          },
        );
      },
      who.sessionId,
    );
  }
  async archiveExercise(
    who: Actor,
    id: string,
    reason: string,
    expected: number,
    key: string,
  ) {
    return this.database.writeAs(
      who.actorId,
      async (client) => {
        const { row } = await resource(client, who, 'exercise', id, true, [
          'ADMIN',
        ]);
        return idempotent(
          client,
          who,
          row.organization_id,
          'exercise.archive',
          key,
          { id, reason, expected },
          200,
          async () => {
            checkRevision(row.revision, expected);
            available(row);
            await client.query(
              'UPDATE app.exercises SET archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1',
              [id],
            );
            await audit(
              client,
              who,
              row.organization_id,
              'exercise.archived',
              'exercise',
              id,
              { reason, preservedPublications: true },
            );
            return {
              data: await this.exercise(client, id),
              resourceId: id,
              resourceType: 'exercise',
            };
          },
        );
      },
      who.sessionId,
    );
  }
}
