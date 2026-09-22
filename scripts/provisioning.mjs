import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { context, readState, root } from './local.mjs';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const usage = `Permisos técnicos locales de aprovisionamiento (un uso por permiso).
  node scripts/provisioning.mjs grant --user UUID --by ACTOR --reason MOTIVO --expires-at ISO_UTC [--id UUID] [--test]
  node scripts/provisioning.mjs list --user UUID [--test]
  node scripts/provisioning.mjs revoke --grant UUID --by ACTOR --reason MOTIVO [--test]
Requiere una identidad con perfil ACTIVE (puede no tener membresías).
Usa exclusivamente la BD local validada por scripts/local.mjs. No crea cuentas,
no envía correo y no concede administración de organizaciones existentes.`;

export function parseProvisioningArguments(argv) {
  if (argv.length === 0 || argv.includes('--help')) return { command: 'help' };
  const [command, ...args] = argv;
  if (!['grant', 'list', 'revoke'].includes(command))
    throw new Error('Comando técnico no reconocido. Usa --help.');
  const options = { command, test: false };
  const allowed = {
    grant: ['user', 'by', 'reason', 'expires-at', 'id'],
    list: ['user'],
    revoke: ['grant', 'by', 'reason'],
  }[command];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--test') {
      if (options.test) throw new Error('Opción repetida.');
      options.test = true;
      continue;
    }
    const key = argument.startsWith('--') ? argument.slice(2) : '';
    const value = args[index + 1];
    if (
      !allowed.includes(key) ||
      !value ||
      value.startsWith('--') ||
      key in options
    )
      throw new Error('Opciones inválidas. Usa --help.');
    options[key] = value;
    index += 1;
  }
  const required = allowed.filter((key) => key !== 'id');
  for (const key of required) {
    if (!options[key]?.trim()) throw new Error(`Falta --${key}.`);
  }
  for (const key of ['user', 'grant', 'id']) {
    if (options[key] && !uuid.test(options[key]))
      throw new Error(`--${key} debe ser UUID.`);
  }
  if (options.by && options.by.trim().length > 120)
    throw new Error('Actor demasiado largo.');
  if (options.reason && options.reason.trim().length > 500)
    throw new Error('Motivo demasiado largo.');
  if (command === 'grant') {
    const expiresAt = options['expires-at'];
    const timestamp = Date.parse(expiresAt);
    const canonical = expiresAt.replace(
      /(?:\.(\d{1,3}))?Z$/,
      (_suffix, fraction = '') => `.${fraction.padEnd(3, '0')}Z`,
    );
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expiresAt) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString() !== canonical ||
      timestamp <= Date.now()
    )
      throw new Error(
        '--expires-at debe ser un instante UTC futuro terminado en Z.',
      );
  }
  return options;
}

export async function runProvisioning(options) {
  if (options.command === 'help') {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const projectDir = options.test
    ? join(root, '.local/integration-workspace')
    : root;
  const ctx = context(projectDir, options.test);
  const state = await readState(ctx);
  const client = new pg.Client({ connectionString: state.migrationUrl });
  await client.connect();
  try {
    if (options.command === 'list') {
      const result = await client.query(
        `SELECT id, granted_at, expires_at, revoked_at, consumed_at, consumed_organization_id
         FROM app.provisioning_grants WHERE user_id=$1 ORDER BY granted_at,id`,
        [options.user],
      );
      process.stdout.write(`${JSON.stringify({ grants: result.rows })}\n`);
      return;
    }
    await client.query('BEGIN');
    if (options.command === 'grant') {
      const recipient = await client.query(
        `SELECT id FROM app.profiles WHERE id=$1 AND account_state='ACTIVE' FOR UPDATE`,
        [options.user],
      );
      if (recipient.rowCount !== 1)
        throw new Error('El destinatario requiere un perfil ACTIVE existente.');
      const id = options.id ?? randomUUID();
      const result = await client.query(
        `INSERT INTO app.provisioning_grants(id,user_id,granted_by,reason,expires_at)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id`,
        [
          id,
          options.user,
          options.by.trim(),
          options.reason.trim(),
          options['expires-at'],
        ],
      );
      if (result.rowCount === 0) {
        const previous = await client.query(
          `SELECT id FROM app.provisioning_grants WHERE id=$1 AND user_id=$2
           AND granted_by=$3 AND reason=$4 AND expires_at=$5`,
          [
            id,
            options.user,
            options.by.trim(),
            options.reason.trim(),
            options['expires-at'],
          ],
        );
        if (previous.rowCount !== 1)
          throw new Error('El ID ya identifica otro permiso.');
      }
      await client.query('COMMIT');
      process.stdout.write(
        `${JSON.stringify({ grantId: id, status: result.rowCount === 1 ? 'GRANTED' : 'UNCHANGED' })}\n`,
      );
    } else {
      const result = await client.query(
        `UPDATE app.provisioning_grants SET revoked_at=now(), revoked_by=$2, revocation_reason=$3
         WHERE id=$1 AND revoked_at IS NULL AND consumed_at IS NULL RETURNING id`,
        [options.grant, options.by.trim(), options.reason.trim()],
      );
      if (result.rowCount !== 1)
        throw new Error('El permiso no está disponible para revocación.');
      await client.query('COMMIT');
      process.stdout.write(
        `${JSON.stringify({ grantId: options.grant, status: 'REVOKED' })}\n`,
      );
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (['23503', '23505', '23514'].includes(error.code))
      throw new Error(
        'El permiso no satisface las restricciones de identidad o unicidad.',
        { cause: error },
      );
    throw error;
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runProvisioning(parseProvisioningArguments(process.argv.slice(2)));
  } catch {
    // Driver/provider errors can contain credentials and are never printed.
    process.stderr.write(
      'No se completó la operación técnica. Verifica argumentos, identidad y estado local.\n',
    );
    process.exitCode = 1;
  }
}
