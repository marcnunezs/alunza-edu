import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, readState } from './local.mjs';

// Fixed IDs make the academic extension repeatable without rewriting versions.
const id = (group, n) =>
  `${group}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const definitions = [
  [
    'Sumar dos valores',
    'Retorna la suma de a y b.',
    'function solve(a, b) {\n  return a + b;\n}',
    [1, 2],
    3,
    [12, 5],
    17,
    0,
  ],
  [
    'Restar dos valores',
    'Retorna a menos b.',
    'function solve(a, b) {\n  return a - b;\n}',
    [5, 2],
    3,
    [-4, 8],
    -12,
    0,
  ],
  [
    'Multiplicar',
    'Retorna el producto de a y b.',
    'function solve(a, b) {\n  return a * b;\n}',
    [2, 4],
    8,
    [0, 7],
    0,
    0,
  ],
  [
    'Reconocer un número par',
    'Retorna true si n es par.',
    'function solve(n) {\n  return n % 2 === 0;\n}',
    [4],
    true,
    [7],
    false,
    1,
  ],
  [
    'Elegir el mayor',
    'Retorna el mayor de a y b.',
    'function solve(a, b) {\n  return a > b ? a : b;\n}',
    [3, 8],
    8,
    [-1, -4],
    -1,
    1,
  ],
  [
    'Longitud de un texto',
    'Retorna la cantidad de caracteres de texto.',
    'function solve(texto) {\n  return texto.length;\n}',
    ['hola'],
    4,
    [''],
    0,
    2,
  ],
  [
    'Reconocer un positivo',
    'Retorna true si n es mayor que cero.',
    'function solve(n) {\n  return n > 0;\n}',
    [2],
    true,
    [0],
    false,
    1,
  ],
  [
    'Primer elemento',
    'Retorna el primer elemento del arreglo no vacío.',
    'function solve(valores) {\n  return valores[0];\n}',
    [[3, 2]],
    3,
    [[9]],
    9,
    2,
  ],
  [
    'Sumar un arreglo',
    'Retorna la suma del arreglo de números, o cero si está vacío.',
    'function solve(valores) {\n  return valores.reduce((total, n) => total + n, 0);\n}',
    [[1, 2, 3]],
    6,
    [[]],
    0,
    2,
  ],
  [
    'Preparar un saludo',
    'Retorna Hola, seguido de un espacio y el nombre.',
    'function solve(nombre) {\n  return "Hola " + nombre;\n}',
    ['Ana'],
    'Hola Ana',
    ['Luis'],
    'Hola Luis',
    0,
  ],
];
export async function seedAcademic(ctx) {
  const state = await readState(ctx);
  const foundation = JSON.parse(
    await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
  );
  const db = new pg.Client({ connectionString: state.migrationUrl });
  await db.connect();
  try {
    if (
      !(await db.query("SELECT to_regclass('app.activities') AS relation"))
        .rows[0].relation
    )
      throw new Error(
        'Aplica las migraciones IMP-02 antes del seed académico.',
      );
    const auth = createClient(state.authUrl, state.authAdminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const students = [];
    for (let n = 7; n <= 12; n++) {
      const organizationIndex = n < 10 ? 0 : 1;
      const user = {
        id: id('2', n),
        email: `student.${organizationIndex === 0 ? 'a' : 'b'}${organizationIndex === 0 ? n - 5 : n - 8}@alunza.test`,
        name: `Estudiante ${organizationIndex === 0 ? 'A' : 'B'}${organizationIndex === 0 ? n - 5 : n - 8}`,
        organizationId: foundation.organizations[organizationIndex].id,
      };
      const existing = await auth.auth.admin.getUserById(user.id);
      if (existing.data?.user) {
        if (existing.data.user.email !== user.email)
          throw new Error('El ID ficticio ya pertenece a otra identidad.');
        const updated = await auth.auth.admin.updateUserById(user.id, {
          password: state.fixturePassword,
          email_confirm: true,
        });
        if (updated.error)
          throw new Error('No se sincronizó una identidad académica ficticia.');
      } else {
        if (
          existing.error &&
          existing.error.status !== 404 &&
          existing.error.code !== 'user_not_found'
        )
          throw new Error('No se pudo consultar una identidad ficticia.');
        const created = await auth.auth.admin.createUser({
          id: user.id,
          email: user.email,
          password: state.fixturePassword,
          email_confirm: true,
        });
        if (created.error)
          throw new Error('No se creó una identidad académica ficticia.');
      }
      students.push(user);
    }
    await db.query('BEGIN');
    for (const student of students) {
      await db.query(
        "INSERT INTO app.profiles(id,display_name,email_normalized,account_state) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(id) DO NOTHING",
        [student.id, student.name, student.email],
      );
      await db.query(
        "INSERT INTO app.organization_memberships(organization_id,user_id,role,state,joined_at) VALUES($1,$2,'STUDENT','ACTIVE',$3) ON CONFLICT(organization_id,user_id) DO NOTHING",
        [student.organizationId, student.id, foundation.createdAt],
      );
    }
    for (let orgIndex = 0; orgIndex < 2; orgIndex++) {
      const org = foundation.organizations[orgIndex].id;
      const teacher = foundation.users[orgIndex === 0 ? 1 : 4].id;
      const admin = foundation.users[orgIndex === 0 ? 0 : 3].id;
      await db.query(
        "INSERT INTO app.courses(id,organization_id,code,name,academic_period,start_date,end_date) VALUES($1,$2,'PROG1','Programación I','2026-2','2026-01-01','2027-12-31') ON CONFLICT(id) DO NOTHING",
        [id('3', orgIndex + 1), org],
      );
      for (let k = 0; k < 3; k++) {
        const n = orgIndex * 3 + k + 1;
        if (
          (
            await db.query('SELECT id FROM app.concepts WHERE id=$1', [
              id('5', n),
            ])
          ).rowCount
        )
          continue;
        const name = ['Variables', 'Condicionales', 'Colecciones'][k];
        await db.query(
          'INSERT INTO app.concepts(id,organization_id,normalized_name) VALUES($1,$2,$3)',
          [id('5', n), org, name.toLowerCase()],
        );
        await db.query(
          'INSERT INTO app.concept_versions(id,organization_id,concept_id,version,name,description,created_by) VALUES($1,$2,$3,1,$4,$5,$6)',
          [
            id('6', n),
            org,
            id('5', n),
            name,
            `Concepto de práctica: ${name.toLowerCase()}.`,
            admin,
          ],
        );
        await db.query(
          'UPDATE app.concepts SET current_version_id=$2 WHERE id=$1',
          [id('5', n), id('6', n)],
        );
      }
      for (let k = 0; k < 5; k++) {
        const index = orgIndex * 5 + k;
        const n = index + 1;
        if (
          (
            await db.query('SELECT id FROM app.exercises WHERE id=$1', [
              id('7', n),
            ])
          ).rowCount
        )
          continue;
        const [
          title,
          statement,
          ,
          visibleArgs,
          visibleExpected,
          hiddenArgs,
          hiddenExpected,
          conceptIndex,
        ] = definitions[index];
        const conceptN = orgIndex * 3 + conceptIndex + 1;
        await db.query(
          "INSERT INTO app.exercises(id,organization_id,owner_id,visibility) VALUES($1,$2,$3,'PRIVATE')",
          [id('7', n), org, teacher],
        );
        await db.query(
          "INSERT INTO app.exercise_versions(id,organization_id,exercise_id,version,title,statement,starter_code,difficulty,created_by) VALUES($1,$2,$3,1,$4,$5,$6,'BASIC',$7)",
          [
            id('8', n),
            org,
            id('7', n),
            title,
            statement,
            'function solve(...args) {\n  // Escribe tu solución\n}\n',
            teacher,
          ],
        );
        await db.query(
          'INSERT INTO app.exercise_version_concepts(organization_id,exercise_version_id,concept_id,concept_version_id) VALUES($1,$2,$3,$4)',
          [org, id('8', n), id('5', conceptN), id('6', conceptN)],
        );
        for (const [position, visibility, args, expected] of [
          [0, 'VISIBLE', visibleArgs, visibleExpected],
          [1, 'HIDDEN', hiddenArgs, hiddenExpected],
        ]) {
          await db.query(
            'INSERT INTO app_private.exercise_tests(id,organization_id,exercise_version_id,position,visibility,args,expected) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',
            [
              id('b', n * 2 + position),
              org,
              id('8', n),
              position,
              visibility,
              JSON.stringify(args),
              JSON.stringify(expected),
            ],
          );
        }
        await db.query(
          'UPDATE app.exercises SET current_version_id=$2 WHERE id=$1',
          [id('7', n), id('8', n)],
        );
      }
    }
    for (let n = 1; n <= 3; n++) {
      const orgIndex = n < 3 ? 0 : 1;
      const org = foundation.organizations[orgIndex].id;
      const teacher = foundation.users[orgIndex === 0 ? 1 : 4].id;
      await db.query(
        "INSERT INTO app.classes(id,organization_id,course_id,teacher_id,code,name,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,'2026-01-01','2027-12-31') ON CONFLICT(id) DO NOTHING",
        [
          id('4', n),
          org,
          id('3', orgIndex + 1),
          teacher,
          `PROG1-${n}`,
          `Programación I · Sección ${n}`,
        ],
      );
      if (
        !(
          await db.query('SELECT id FROM app.activities WHERE id=$1', [
            id('9', n),
          ])
        ).rowCount
      ) {
        await db.query(
          "INSERT INTO app.activities(id,organization_id,class_id,title,type,instructions,created_by) VALUES($1,$2,$3,$4,'FORMATIVE','Lee el enunciado y prepara tu solución. La ejecución se incorporará en la siguiente entrega.',$5)",
          [
            id('9', n),
            org,
            id('4', n),
            `Práctica inicial · Sección ${n}`,
            teacher,
          ],
        );
        const exercises =
          n === 1 ? [1, 2, 3] : n === 2 ? [4, 5] : [6, 7, 8, 9, 10];
        for (const [position, exerciseN] of exercises.entries())
          await db.query(
            'INSERT INTO app.activity_exercises(id,organization_id,activity_id,exercise_version_id,position,required) VALUES($1,$2,$3,$4,$5,true)',
            [id('a', exerciseN), org, id('9', n), id('8', exerciseN), position],
          );
        await db.query(
          "UPDATE app.activities SET state='PUBLISHED',revision=revision+1 WHERE id=$1",
          [id('9', n)],
        );
      }
    }
    // student.a is intentionally not enrolled: the demo can show confirmation.
    for (const [studentN, classN] of [
      [7, 1],
      [8, 2],
      [9, 2],
      [6, 3],
      [10, 3],
      [11, 3],
      [12, 3],
    ]) {
      const org = foundation.organizations[classN < 3 ? 0 : 1].id;
      await db.query(
        "INSERT INTO app.class_memberships(id,organization_id,class_id,user_id,state) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(organization_id,class_id,user_id) DO NOTHING",
        [id('c', studentN), org, id('4', classN), id('2', studentN)],
      );
    }
    await db.query('COMMIT');
    console.log(
      'Fixture académico preparado: 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases y 10 ejercicios.',
    );
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
