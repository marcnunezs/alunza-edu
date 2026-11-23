import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './local.mjs';
import { testTarget } from './local-target.mjs';
import {
  sources,
  scope,
  teacherA,
  doubleConfiguration,
} from '../fixtures/ai/corpus.mjs';

export async function restoreAiFixture(admin, ctx, priorUsage, installed) {
  if (
    !ctx.test ||
    ctx.projectId !== testTarget.projectId ||
    ctx.dbPort !== testTarget.dbPort
  )
    throw new Error('Cleanup requires the isolated test project');
  await admin.query('BEGIN');
  try {
    if (installed) await admin.query('DROP SCHEMA rag_probe CASCADE');
    if (!priorUsage)
      await admin.query('REVOKE USAGE ON SCHEMA extensions FROM alunza_app');
    const restored = (
      await admin.query(
        "SELECT has_schema_privilege('alunza_app','extensions','USAGE') AS allowed",
      )
    ).rows[0].allowed;
    if (restored !== priorUsage)
      throw new Error('Extension grant was not restored');
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

export async function installAiFixture(admin, ctx, options = {}) {
  if (
    !ctx.test ||
    ctx.projectId !== testTarget.projectId ||
    ctx.dbPort !== testTarget.dbPort
  )
    throw new Error(
      'El corpus solo se instala en el proyecto exclusivo de pruebas.',
    );
  await admin.query('BEGIN');
  try {
    const configuration = options.configuration ?? doubleConfiguration;
    const vectors =
      options.vectors ??
      sources.flatMap((source) => source.chunks.map((chunk) => chunk.vector));
    if (
      vectors.length !==
      sources.reduce((count, source) => count + source.chunks.length, 0)
    )
      throw new Error('Incomplete corpus generation');
    let vectorIndex = 0;
    await admin.query(
      await readFile(join(root, 'fixtures/ai/schema.sql'), 'utf8'),
    );
    for (const actor of [scope.actorId, teacherA])
      await admin.query(
        'INSERT INTO rag_probe.scope_grants VALUES($1,$2,$3,$4,true)',
        [actor, scope.organizationId, scope.classId, scope.activityId],
      );
    for (const source of sources) {
      await admin.query(
        `INSERT INTO rag_probe.sources VALUES($1,$2,$3,$4,$5,$6,$7,$8,'READY',true,$9,$10)`,
        [
          source.id,
          source.sourceVersionId,
          source.generationId,
          source.organizationId,
          source.classId,
          source.activityId,
          source.visible,
          source.archived,
          configuration.id,
          configuration.dimensions,
        ],
      );
      for (const [index, chunk] of source.chunks.entries())
        await admin.query(
          'INSERT INTO rag_probe.chunks VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::extensions.vector)',
          [
            chunk.id,
            source.id,
            source.sourceVersionId,
            source.generationId,
            source.organizationId,
            source.classId,
            configuration.id,
            configuration.dimensions,
            index,
            chunk.text,
            chunk.locator,
            JSON.stringify(vectors[vectorIndex++]),
          ],
        );
    }
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}
