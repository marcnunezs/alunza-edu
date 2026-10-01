import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function requireFixture(condition) {
  if (!condition) throw new Error('Fixture de fundación inválido.');
}
function literal(value) {
  requireFixture(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 160 &&
      !value.includes('\0') &&
      !value.includes('$alunza_fixture_guard$'),
  );
  return `'${value.replaceAll("'", "''")}'`;
}
export function bootstrapArtifacts(fixture) {
  requireFixture(
    fixture.schemaVersion === 1 &&
      fixture.kind === 'foundation-incremental' &&
      fixture.organizations.length === 2 &&
      fixture.users.length === 6,
  );
  requireFixture(Number.isFinite(Date.parse(fixture.createdAt)));
  const ids = new Set(fixture.organizations.map((item) => item.id));
  requireFixture(ids.size === 2 && [...ids].every((id) => uuid.test(id)));
  requireFixture(
    new Set(fixture.users.map((item) => item.id)).size === 6 &&
      new Set(fixture.users.map((item) => item.email)).size === 6,
  );
  const sql = [
    '-- Generated locally from fixtures/foundation/identity.json. No credentials.',
    '-- Review and apply only to the approved preproduction project after Auth bootstrap.',
    'BEGIN;',
    'SET LOCAL standard_conforming_strings = on;',
  ];
  const check = (query) =>
    sql.push(
      `DO $alunza_fixture_guard$ BEGIN IF NOT EXISTS (${query}) THEN RAISE EXCEPTION 'Foundation fixture mismatch; transaction rolled back'; END IF; END $alunza_fixture_guard$;`,
    );
  const insert = (table, fields, values) =>
    sql.push(
      `INSERT INTO app.${table} (${fields.join(', ')}) VALUES (${values.map(literal).join(', ')}) ON CONFLICT DO NOTHING;`,
    );
  for (const user of fixture.users) {
    requireFixture(
      uuid.test(user.id) &&
        ids.has(user.organizationId) &&
        /^[a-z.]+@alunza\.test$/.test(user.email) &&
        ['ADMIN', 'TEACHER', 'STUDENT'].includes(user.role) &&
        user.accountState === 'ACTIVE' &&
        user.membershipState === 'ACTIVE',
    );
    check(
      `SELECT 1 FROM auth.users WHERE id = ${literal(user.id)}::uuid AND lower(email) = ${literal(user.email)}`,
    );
  }
  for (const org of fixture.organizations) {
    requireFixture(
      fixture.users.filter((user) => user.organizationId === org.id).length ===
        3 &&
        new Set(
          fixture.users
            .filter((user) => user.organizationId === org.id)
            .map((user) => user.role),
        ).size === 3,
    );
    insert(
      'organizations',
      ['id', 'code', 'name', 'timezone'],
      [org.id, org.code, org.name, org.timezone],
    );
    check(
      `SELECT 1 FROM app.organizations WHERE id = ${literal(org.id)}::uuid AND code = ${literal(org.code)} AND name = ${literal(org.name)} AND timezone = ${literal(org.timezone)} AND archived_at IS NULL`,
    );
  }
  for (const user of fixture.users) {
    insert(
      'profiles',
      ['id', 'display_name', 'email_normalized', 'account_state'],
      [user.id, user.displayName, user.email, user.accountState],
    );
    insert(
      'organization_memberships',
      ['organization_id', 'user_id', 'role', 'state', 'joined_at'],
      [
        user.organizationId,
        user.id,
        user.role,
        user.membershipState,
        fixture.createdAt,
      ],
    );
    check(
      `SELECT 1 FROM app.profiles WHERE id = ${literal(user.id)}::uuid AND display_name = ${literal(user.displayName)} AND email_normalized = ${literal(user.email)} AND account_state = 'ACTIVE'`,
    );
    check(
      `SELECT 1 FROM app.organization_memberships WHERE organization_id = ${literal(user.organizationId)}::uuid AND user_id = ${literal(user.id)}::uuid AND role = ${literal(user.role)} AND state = 'ACTIVE' AND disabled_at IS NULL`,
    );
  }
  sql.push('COMMIT;', '');
  return {
    sql: sql.join('\n'),
    authUsers: fixture.users.map(({ id, email }) => ({
      id,
      email,
      email_confirm: true,
    })),
  };
}
export async function prepareBootstrap(
  directory = join(root, '.local/preproduction'),
) {
  const fixture = JSON.parse(
    await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
  );
  const artifacts = bootstrapArtifacts(fixture);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'bootstrap.fixture.sql'), artifacts.sql);
  await writeFile(
    join(directory, 'bootstrap.auth-users.json'),
    JSON.stringify(artifacts.authUsers, null, 2) + '\n',
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await prepareBootstrap();
    console.log(
      'SQL y payloads Auth ficticios preparados localmente, sin passwords ni red.',
    );
  } catch {
    console.error('No se pudo preparar el fixture de preproducción.');
    process.exitCode = 2;
  }
}
