import pg from 'pg';
import { seedAcademic } from './academic-seed.mjs';

// Run only after baseline scenarios: their six-account fixture remains unchanged.
export async function verifyAcademicSeed({ ctx, state }) {
  if (!ctx.test || state.projectId !== 'alunza-edu-foundation-test')
    throw new Error(
      'La verificación del seed exige el entorno aislado de pruebas.',
    );
  const db = new pg.Client({ connectionString: state.migrationUrl });
  await db.connect();
  try {
    const snapshot = async () => {
      const result = {};
      for (const [table, group, expected] of [
        ['organizations', '1', 2],
        ['profiles', '2', 12],
        ['courses', '3', 2],
        ['classes', '4', 3],
        ['concepts', '5', 6],
        ['concept_versions', '6', 6],
        ['exercises', '7', 10],
        ['exercise_versions', '8', 10],
        ['activities', '9', 3],
        ['activity_exercises', 'a', 10],
      ]) {
        const rows = (
          await db.query(
            `SELECT * FROM app.${table} WHERE id::text LIKE $1 ORDER BY id`,
            [`${group}0000000-0000-4000-8000-%`],
          )
        ).rows;
        if (rows.length !== expected)
          throw new Error(`Cantidad canónica incorrecta: ${table}.`);
        result[table] = rows;
      }
      return result;
    };
    await seedAcademic(ctx);
    const first = await snapshot();
    await seedAcademic(ctx);
    const second = await snapshot();
    if (JSON.stringify(first) !== JSON.stringify(second))
      throw new Error(
        'Repetir el seed cambió IDs, versiones o fechas existentes.',
      );
    const roles = (
      await db.query(
        "SELECT role,count(*)::int total FROM app.organization_memberships WHERE organization_id IN ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002') AND user_id::text LIKE '20000000-0000-4000-8000-%' GROUP BY role ORDER BY role",
      )
    ).rows;
    if (
      JSON.stringify(roles) !==
      JSON.stringify([
        { role: 'ADMIN', total: 2 },
        { role: 'STUDENT', total: 8 },
        { role: 'TEACHER', total: 2 },
      ])
    )
      throw new Error(
        'Los roles canónicos no corresponden al conjunto académico.',
      );
    return {
      status: 'passed',
      runs: 2,
      existingRows: 'unchanged',
      canonical: {
        organizations: 2,
        administrators: 2,
        teachers: 2,
        students: 8,
        classes: 3,
        exercises: 10,
      },
    };
  } finally {
    await db.end();
  }
}
