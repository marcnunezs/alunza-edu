import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, types } from 'pg';
import type { PoolClient } from 'pg';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ApiError, databaseUnavailable, unauthenticated } from '../http/errors';
import { phaseAsync, phasePool } from '../http/phase-diagnostics';

// PostgreSQL DATE is a civil academic date, not a midnight timestamp. Keeping
// OID 1082 as text avoids shifting the day through the host's timezone.
types.setTypeParser(1082, (value: string) => value);

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;
  private closing: Promise<void> | undefined;

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
    let discard = false;
    const onClientError = () => {
      discard = true;
    };
    try {
      client = await this.pool.connect();
      // pg-pool only listens while a client is idle. A borrowed connection can
      // emit an error independently of the current query promise.
      client.on('error', onClientError);
      await this.assertLimitedRole(client);
      await client.query(`
        SELECT id, display_name, account_state FROM app.profiles LIMIT 0;
        SELECT user_id, organization_id, role, state FROM app.organization_memberships LIMIT 0;
        SELECT id, code, name, timezone, archived_at FROM app.organizations LIMIT 0
        ; SELECT id,revision,archived_by FROM app.organizations LIMIT 0
        ; SELECT id,user_id,consumed_at FROM app.provisioning_grants LIMIT 0
        ; SELECT id,generation,token_digest FROM app.organization_invitations LIMIT 0
        ; SELECT id,state,lease_until FROM app.invitation_deliveries LIMIT 0
        ; SELECT id,organization_id,revision FROM app.courses LIMIT 0
        ; SELECT id,organization_id,teacher_id FROM app.classes LIMIT 0
        ; SELECT id,current_version_id FROM app.concept_tags LIMIT 0
        ; SELECT id,current_version_id FROM app.exercises LIMIT 0
        ; SELECT id,state,revision FROM app.activities LIMIT 0
        ; SELECT id,lifecycle_status,lease_until FROM app.executions LIMIT 0
        ; SELECT id,execution_id,attempt_number,technical_result FROM app.attempts LIMIT 0
        ; SELECT id,current_version_id,visibility FROM app.sources LIMIT 0
        ; SELECT id,current_generation_id FROM app.source_versions LIMIT 0
        ; SELECT id,index_status FROM app.source_index_generations LIMIT 0
        ; SELECT id,lifecycle_status,attempt_count FROM app.material_jobs LIMIT 0
        ; SELECT 'app_private.stage_practice_submit_result(uuid,uuid,jsonb,jsonb)'::regprocedure,
          'app_private.finish_practice_submit(uuid,uuid,boolean)'::regprocedure,
          'app_private.list_practice_attempts(uuid,uuid,bigint,integer)'::regprocedure,
          'app_private.practice_activity_progress(uuid)'::regprocedure,
          'app_private.student_progress(uuid,uuid,uuid,timestamp with time zone)'::regprocedure,
          'app_private.student_progress_observed(uuid,jsonb)'::regprocedure,
          'app_private.dashboard_read(uuid,jsonb)'::regprocedure,
          'app_private.dashboard_evidence(uuid,jsonb)'::regprocedure,
          'app_private.dashboard_signals(uuid,jsonb)'::regprocedure,
          'app_private.dashboard_signal(uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_progress(uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_evidence(uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_attempt(uuid,uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_feedback_history(uuid,uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_feedback(uuid,uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_reference(uuid,uuid,uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_signals(uuid,uuid,jsonb)'::regprocedure,
          'app_private.student_detail_signal(uuid,uuid,uuid,jsonb)'::regprocedure,
          'app_private.exercise_bank_list(uuid,jsonb)'::regprocedure,
          'app_private.exercise_bank_detail(uuid)'::regprocedure,
          'app_private.exercise_bank_versions(uuid,jsonb)'::regprocedure,
          'app_private.exercise_bank_uses(uuid,jsonb)'::regprocedure,
          'app_private.guard_exercise_governance_owner()'::regprocedure,
          'app_private.record_activity_open(uuid,text)'::regprocedure,
          'app_private.signal_rule_organization(uuid)'::regprocedure,
          'app_private.signal_review(uuid)'::regprocedure,
          'app_private.audit_events_list(uuid,jsonb)'::regprocedure,
          'app_private.audit_export_reserve(uuid,text,jsonb)'::regprocedure,
          'app_private.audit_export_authorize(uuid)'::regprocedure,
          'app_private.audit_export_fail(uuid,uuid,text,integer)'::regprocedure,
          'app_private.audit_export_capture(uuid,uuid,uuid)'::regprocedure,
          'app_private.audit_export_finish(uuid,uuid,uuid,timestamp with time zone,bytea,integer,text)'::regprocedure,
          'app_private.audit_export_metadata(uuid,uuid)'::regprocedure,
          'app_private.audit_export_content(uuid,uuid)'::regprocedure,
          'app_private.audit_export_delivery_begin(uuid,uuid)'::regprocedure,
          'app_private.audit_export_delivery_finish(uuid,uuid,text)'::regprocedure,
          'app_private.audit_export_maintain()'::regprocedure,
          'app_private.get_rule_version(uuid,uuid)'::regprocedure,
          'app_private.list_rule_versions(uuid,text,uuid,integer)'::regprocedure,
          'app_private.create_rule_version(uuid,jsonb,text)'::regprocedure,
          'app_private.activate_rule_version(uuid,uuid,uuid,text)'::regprocedure,
          'app_private.help_claim()'::regprocedure,
          'app_private.help_feedback(uuid)'::regprocedure,
          'app_private.help_configuration_matches(uuid,uuid,jsonb)'::regprocedure
      `);
      if (discard) throw databaseUnavailable();
    } catch {
      throw databaseUnavailable();
    } finally {
      client?.release(discard);
      client?.removeListener('error', onClientError);
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
    const onClientError = () => {
      discard = true;
    };
    try {
      phasePool('before', this.pool);
      client = await phaseAsync('db.pool', () => this.pool.connect());
      client.on('error', onClientError);
      const connection = client;
      await phaseAsync('db.begin', () =>
        connection.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN'),
      );
      await phaseAsync('db.role', () => this.assertLimitedRole(connection));
      await phaseAsync('db.context', () =>
        connection.query(
          "SELECT set_config('app.actor_id', $1, true), set_config('app.session_id', $2, true), set_config('app.organization_id', '', true)",
          [actorId, sessionId ?? ''],
        ),
      );
      if (sessionId) {
        const session = await phaseAsync('db.session', () =>
          connection.query<{ valid: boolean }>(
            'SELECT app_private.session_is_active($1::uuid, $2::uuid) AS valid',
            [actorId, sessionId],
          ),
        );
        if (!session.rows[0]?.valid) throw unauthenticated();
      }
      const result = await phaseAsync('db.action', () => action(connection));
      if (discard) throw databaseUnavailable();
      await phaseAsync('db.commit', () => connection.query('COMMIT'));
      if (discard) throw databaseUnavailable();
      return result;
    } catch (error) {
      if (client) {
        try {
          const connection = client;
          await phaseAsync('db.rollback', () => connection.query('ROLLBACK'));
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
        const dashboardFields: Record<string, [string, string]> = {
          AUDIT_CURSOR_INVALID: [
            'cursor',
            'El cursor no corresponde al ámbito, filtros y corte solicitados.',
          ],
          AUDIT_FILTER_INVALID: ['filters', 'Revisa los filtros de auditoría.'],
          AUDIT_PERIOD_INVALID: [
            'from',
            'El inicio debe ser anterior o igual al corte.',
          ],
          EXERCISE_BANK_CURSOR_INVALID: [
            'cursor',
            'El cursor no corresponde al ámbito, filtros y orden solicitados.',
          ],
          EXERCISE_BANK_FILTER_INVALID: [
            'filters',
            'Revisa los filtros del banco de ejercicios.',
          ],
          DASHBOARD_CURSOR_INVALID: [
            'cursor',
            'El cursor no corresponde al ámbito, filtros y corte solicitados.',
          ],
          DASHBOARD_PERIOD_INVALID: [
            'from',
            'El inicio debe ser anterior o igual al corte.',
          ],
          DASHBOARD_FILTER_INVALID: [
            'filters',
            'Revisa los filtros de la consulta.',
          ],
        };
        const dashboardField = dashboardFields[error.message];
        if (dashboardField)
          throw new ApiError(
            'VALIDATION_FAILED',
            'Revisa los campos de la solicitud.',
            422,
            false,
            [{ field: dashboardField[0], message: dashboardField[1] }],
          );
        if (
          ['RULE_PARAMETERS_INVALID', 'RULE_CURSOR_INVALID'].includes(
            error.message,
          )
        )
          throw new ApiError(
            'VALIDATION_FAILED',
            'Revisa los campos de la solicitud.',
            422,
            false,
            [
              {
                field:
                  error.message === 'RULE_CURSOR_INVALID'
                    ? 'cursor'
                    : 'parameters',
                message:
                  error.message === 'RULE_CURSOR_INVALID'
                    ? 'El cursor no corresponde al ámbito y filtro solicitados.'
                    : 'Los parámetros no cumplen el schema de la regla.',
              },
            ],
          );
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
          RESOURCE_ARCHIVED: [
            'ACADEMIC_ARCHIVED',
            'El recurso archivado permite únicamente consultas.',
            409,
          ],
          INVALID_TRANSITION: [
            'INVALID_TRANSITION',
            'El estado de la actividad no permite esta operación.',
            409,
          ],
          RESOURCE_NOT_FOUND: [
            'RESOURCE_NOT_FOUND',
            'Recurso no encontrado.',
            404,
          ],
          INVALID_PROGRESS_CUTOFF: [
            'INVALID_REQUEST',
            'La fecha de corte no puede estar en el futuro.',
            400,
          ],
          RULE_VERSION_CONFLICT: [
            'RULE_VERSION_CONFLICT',
            'La versión vigente de la regla cambió. Recarga la configuración.',
            409,
          ],
          RULE_VERSION_ALREADY_ACTIVATED: [
            'RULE_VERSION_ALREADY_ACTIVATED',
            'La versión ya tuvo vigencia. Crea una versión nueva para cambiar la regla.',
            409,
          ],
          INVALID_REQUEST: [
            'INVALID_REQUEST',
            'La solicitud no es válida.',
            400,
          ],
          VERSION_CONFLICT: [
            'VERSION_CONFLICT',
            'La versión del ejercicio cambió. Recarga la actividad.',
            409,
          ],
          IDEMPOTENCY_CONFLICT: [
            'IDEMPOTENCY_CONFLICT',
            'La clave ya se utilizó con otros datos.',
            409,
          ],
          IDEMPOTENCY_EXPIRED: [
            'IDEMPOTENCY_EXPIRED',
            'La respuesta temporal venció. Ejecuta de nuevo con una solicitud nueva.',
            409,
          ],
          REQUEST_IN_PROGRESS: [
            'REQUEST_IN_PROGRESS',
            'La ejecución sigue en curso. Reintenta con la misma solicitud.',
            409,
          ],
          ACTIVITY_CLOSED: [
            'ACTIVITY_CLOSED',
            'La actividad está cerrada y no admite ejecuciones nuevas.',
            409,
          ],
          ACTIVITY_NOT_AVAILABLE: [
            'ACTIVITY_NOT_AVAILABLE',
            'La actividad está fuera de su ventana de disponibilidad.',
            409,
          ],
          DEPENDENCY_UNAVAILABLE: [
            'DEPENDENCY_UNAVAILABLE',
            'El servicio de ejecución no está disponible. Conserva tu código.',
            503,
          ],
          RATE_LIMITED: [
            'RATE_LIMITED',
            'Se alcanzó el cupo de ejecución. Conserva tu código y espera antes de reintentar.',
            429,
          ],
          RUNNER_BUSY: [
            'RUNNER_BUSY',
            'El ejecutor está ocupado. Conserva tu código y vuelve a intentar.',
            503,
          ],
        };
        const rule = rules[error.message];
        if (rule)
          throw new ApiError(
            ...rule,
            [
              'REQUEST_IN_PROGRESS',
              'DEPENDENCY_UNAVAILABLE',
              'RATE_LIMITED',
              'RUNNER_BUSY',
            ].includes(error.message),
          );
      }
      if (code === '23505')
        throw new ApiError(
          'DUPLICATE',
          'Ya existe un registro con esos datos.',
          409,
        );
      if (code === '22P05' || code === '22021')
        throw new ApiError(
          'VALIDATION_FAILED',
          'El texto contiene caracteres que no se pueden guardar.',
          422,
          false,
          [{ field: 'body', message: 'Revisa la codificación del texto.' }],
        );
      if (
        code === '23514' &&
        error instanceof Error &&
        error.message === 'EXERCISE_OWNER_INVALID'
      )
        throw new ApiError(
          'VALIDATION_FAILED',
          'El propietario debe estar activo y autorizado en esta organización.',
          422,
          false,
          [
            {
              field: 'ownerId',
              message:
                'Selecciona un administrador o docente activo de la organización.',
            },
          ],
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
      client?.removeListener('error', onClientError);
      phasePool('after', this.pool);
    }
  }

  onApplicationShutdown(): Promise<void> {
    // Workers and resource drains finish their module-destroy hooks first.
    return (this.closing ??= this.pool.end());
  }
}
