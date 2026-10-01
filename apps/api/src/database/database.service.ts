import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ApiError, databaseUnavailable, unauthenticated } from '../http/errors';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl,
      max: 5,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 10_000,
      statement_timeout: 2000,
      query_timeout: 2500,
      idle_in_transaction_session_timeout: 3000,
    });
    // pg removes failed idle clients. Do not print connection details or credentials.
    this.pool.on('error', () => undefined);
  }

  private async assertLimitedRole(client: PoolClient): Promise<void> {
    const result = await client.query<{ allowed: boolean }>(`
      SELECT current_user = 'alunza_app'
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
        AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = roles.oid)
        AND NOT EXISTS (
          SELECT 1 FROM pg_class relations JOIN pg_namespace namespaces
            ON namespaces.oid = relations.relnamespace
          WHERE namespaces.nspname = 'app' AND relations.relowner = roles.oid
        )
        AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app' AND nspowner = roles.oid)
        AS allowed
      FROM pg_roles roles WHERE rolname = current_user
    `);
    if (result.rows[0]?.allowed !== true) throw databaseUnavailable();
  }

  async ready(): Promise<void> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await this.assertLimitedRole(client);
      await client.query(`
        SELECT id, display_name, account_state FROM app.profiles LIMIT 0;
        SELECT user_id, organization_id, role, state FROM app.organization_memberships LIMIT 0;
        SELECT id, code, name, timezone, archived_at FROM app.organizations LIMIT 0
        ; SELECT id,revision,archived_by FROM app.organizations LIMIT 0
        ; SELECT id,user_id,consumed_at FROM app.provisioning_grants LIMIT 0
        ; SELECT id,generation,token_digest FROM app.organization_invitations LIMIT 0
        ; SELECT id,state,lease_until FROM app.invitation_deliveries LIMIT 0
      `);
    } catch {
      throw databaseUnavailable();
    } finally {
      client?.release();
    }
  }

  async readAs<T>(
    actorId: string,
    action: (client: PoolClient) => Promise<T>,
    sessionId?: string,
  ): Promise<T> {
    return this.transaction(actorId, action, true, sessionId);
  }

  async writeAs<T>(
    actorId: string,
    action: (client: PoolClient) => Promise<T>,
    sessionId?: string,
  ): Promise<T> {
    return this.transaction(actorId, action, false, sessionId);
  }

  // Only durable-worker and digest-gated incorporation helpers use an empty actor.
  // These never reuse a browser's session or connection-level authorization state.
  async internal<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction('', action, false);
  }

  private async transaction<T>(
    actorId: string,
    action: (client: PoolClient) => Promise<T>,
    readOnly: boolean,
    sessionId?: string,
  ): Promise<T> {
    let client: PoolClient | undefined;
    let discard = false;
    try {
      client = await this.pool.connect();
      await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
      await this.assertLimitedRole(client);
      await client.query(
        "SELECT set_config('app.actor_id', $1, true), set_config('app.session_id', $2, true), set_config('app.organization_id', '', true)",
        [actorId, sessionId ?? ''],
      );
      if (sessionId) {
        const session = await client.query<{ valid: boolean }>(
          'SELECT app_private.session_is_active($1::uuid, $2::uuid) AS valid',
          [actorId, sessionId],
        );
        if (!session.rows[0]?.valid) throw unauthenticated();
      }
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      }
      if (error instanceof ApiError) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (code === 'P0001' && error instanceof Error) {
        const rules: Record<string, [string, string, number]> = {
          LAST_ADMIN: [
            'LAST_ADMIN',
            'La organización debe conservar un administrador activo.',
            409,
          ],
          DEPENDENCIES_ACTIVE: [
            'DEPENDENCIES_ACTIVE',
            'Existen dependencias activas que impiden archivar.',
            409,
          ],
          ORGANIZATION_ARCHIVED: [
            'ORGANIZATION_ARCHIVED',
            'La organización archivada permite únicamente consultas.',
            409,
          ],
          RESOURCE_ARCHIVED: [
            'RESOURCE_ARCHIVED',
            'El recurso archivado permite únicamente consultas.',
            409,
          ],
          COURSE_UNAVAILABLE: [
            'RESOURCE_ARCHIVED',
            'El curso no está disponible para operaciones académicas.',
            409,
          ],
          CLASS_UNAVAILABLE: [
            'RESOURCE_ARCHIVED',
            'La clase no está disponible para operaciones académicas.',
            409,
          ],
          TEACHER_UNAVAILABLE: [
            'VALIDATION_FAILED',
            'El profesor debe estar activo y pertenecer a la organización.',
            422,
          ],
          JOIN_CODE_INVALID: [
            'VALIDATION_FAILED',
            'El código no está disponible. Verifica su vigencia y organización.',
            422,
          ],
          INVITATION_REQUIRED: [
            'INVITATION_INVALID',
            'La membresía requiere una invitación aceptada.',
            409,
          ],
          INVITATION_ROLE_MISMATCH: [
            'INVITATION_INVALID',
            'El rol no corresponde a la invitación.',
            409,
          ],
          INVITATION_ALREADY_ACCEPTED: [
            'INVITATION_INVALID',
            'La invitación ya fue aceptada.',
            409,
          ],
          INVITATION_REVOKED: [
            'INVITATION_REVOKED',
            'La invitación fue revocada.',
            409,
          ],
          INVITATION_INVALID: [
            'INVITATION_INVALID',
            'La invitación no está disponible.',
            409,
          ],
          FORBIDDEN: [
            'FORBIDDEN',
            'No tienes permiso para realizar esta operación.',
            403,
          ],
        };
        const rule = rules[error.message];
        if (rule) throw new ApiError(...rule);
      }
      if (code === '23505')
        throw new ApiError(
          'DUPLICATE',
          'Ya existe un registro con esos datos.',
          409,
        );
      if (code === '23503' || code === '23514')
        throw new ApiError(
          'INVALID_REQUEST',
          'Los datos no cumplen las reglas del recurso.',
          400,
        );
      if (code === '42501')
        throw new ApiError(
          'FORBIDDEN',
          'No tienes permiso para realizar esta operación.',
          403,
        );
      if (code === '40001' || code === '40P01')
        throw new ApiError(
          'REQUEST_IN_PROGRESS',
          'Otra operación está en curso. Reintenta la solicitud.',
          409,
          true,
        );
      throw databaseUnavailable();
    } finally {
      client?.release(discard);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
