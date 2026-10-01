import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Organization } from '@alunza/contracts';
import { z } from 'zod';
import { ApiError, inactive, notFound, unauthenticated } from '../http/errors';
import type { ApiRequest } from '../http/errors';

export const organizationProjection =
  'SELECT id,code,name,timezone,revision,archived_at FROM app.organizations';
export function iso(value: Date | string | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}
export function projectOrganization(
  row: Record<string, unknown>,
): Organization {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    timezone: String(row.timezone),
    revision: Number(row.revision),
    state: row.archived_at ? 'ARCHIVED' : 'ACTIVE',
    archivedAt: iso(row.archived_at as Date | null),
  };
}
export function actor(request: ApiRequest) {
  if (!request.actorId || !request.sessionId) throw unauthenticated();
  return {
    actorId: request.actorId,
    sessionId: request.sessionId,
    requestId: request.requestId,
  };
}
export type Actor = ReturnType<typeof actor>;
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ApiError(
      'VALIDATION_FAILED',
      'Revisa los campos de la solicitud.',
      422,
      false,
      result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  return result.data;
}
export function uuid(value: string): string {
  return parse(z.uuid(), value);
}
export function revision(header: string | undefined): number {
  if (!header)
    throw new ApiError(
      'PRECONDITION_REQUIRED',
      'La operación requiere la versión vigente.',
      428,
    );
  if (!/^"[1-9][0-9]{0,9}"$/.test(header))
    throw new ApiError('INVALID_REQUEST', 'If-Match no es válido.', 400);
  return Number(header.slice(1, -1));
}
export function checkRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new ApiError(
      'PRECONDITION_FAILED',
      'El recurso cambió. Actualiza los datos antes de continuar.',
      412,
    );
}
export function idempotency(header: string | undefined): string {
  if (!header || !/^[A-Za-z0-9_.:-]{8,128}$/.test(header))
    throw new ApiError(
      'INVALID_REQUEST',
      'Se requiere una clave de idempotencia válida.',
      400,
    );
  return header;
}
export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export const paginationSchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  state: z
    .enum([
      'ACTIVE',
      'DISABLED',
      'INVITED',
      'ARCHIVED',
      'ACCEPTED',
      'REVOKED',
      'EXPIRED',
    ])
    .optional(),
  role: z.enum(['ADMIN', 'TEACHER', 'STUDENT']).optional(),
});
export type PageQuery = z.infer<typeof paginationSchema>;
export const organizationPaginationSchema = paginationSchema
  .omit({ role: true })
  .extend({ state: z.enum(['ACTIVE', 'ARCHIVED']).optional() });
export const memberPaginationSchema = paginationSchema.extend({
  state: z.enum(['INVITED', 'ACTIVE', 'DISABLED']).optional(),
});
export const invitationPaginationSchema = paginationSchema.extend({
  state: z.enum(['INVITED', 'ACCEPTED', 'REVOKED', 'EXPIRED']).optional(),
});
export function pageResult<T>(
  rows: T[],
  limit: number,
  id: (row: T) => string,
) {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    page: { hasMore, nextCursor: hasMore && last ? id(last) : null },
  };
}
export async function activeProfile(client: PoolClient, actorId: string) {
  const row = (
    await client.query(
      'SELECT id,display_name,email_normalized,account_state FROM app.profiles WHERE id=$1',
      [actorId],
    )
  ).rows[0];
  if (row?.account_state !== 'ACTIVE') throw inactive();
  return row;
}
export async function organizationContext(
  client: PoolClient,
  organizationId: string,
  write: boolean,
  admin = false,
  allowArchived = false,
) {
  await client.query("SELECT set_config('app.organization_id',$1,true)", [
    organizationId,
  ]);
  let row = (
    await client.query(`${organizationProjection} WHERE id=$1`, [
      organizationId,
    ])
  ).rows[0];
  if (!row) throw notFound();
  if (admin) {
    const permission = await client.query(
      'SELECT app_private.can_admin($1::uuid,true) AS allowed',
      [organizationId],
    );
    if (!permission.rows[0]?.allowed)
      throw new ApiError(
        'FORBIDDEN',
        'Esta operación requiere administración institucional.',
        403,
      );
  }
  if (write && row.archived_at && !allowArchived)
    throw new ApiError(
      'ORGANIZATION_ARCHIVED',
      'La organización archivada permite únicamente consultas.',
      409,
    );
  if (write) {
    const locked = (
      await client.query(`${organizationProjection} WHERE id=$1 FOR UPDATE`, [
        organizationId,
      ])
    ).rows[0];
    if (!locked) {
      const latest = (
        await client.query(`${organizationProjection} WHERE id=$1`, [
          organizationId,
        ])
      ).rows[0];
      if (latest?.archived_at)
        throw new ApiError(
          'ORGANIZATION_ARCHIVED',
          'La organización archivada permite únicamente consultas.',
          409,
        );
      throw notFound();
    }
    row = locked;
    if (
      admin &&
      !(
        await client.query(
          'SELECT app_private.can_admin($1::uuid,true) AS allowed',
          [organizationId],
        )
      ).rows[0]?.allowed
    )
      throw new ApiError(
        'FORBIDDEN',
        'La autorización cambió durante la operación.',
        403,
      );
  }
  return row;
}
export async function audit(
  client: PoolClient,
  who: Actor,
  organizationId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  changes: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO app.audit_events(id,organization_id,actor_id,actor_kind,action,entity_type,entity_id,result,correlation_id,request_id,safe_changes) VALUES($1,$2,$3,'USER',$4,$5,$6,'SUCCEEDED',$7,$7,$8::jsonb)`,
    [
      randomUUID(),
      organizationId,
      who.actorId,
      action,
      entityType,
      entityId,
      who.requestId,
      JSON.stringify(changes),
    ],
  );
}
export async function idempotent<T>(
  client: PoolClient,
  who: Actor,
  organizationId: string | null,
  operation: string,
  key: string,
  payload: unknown,
  status: number,
  action: () => Promise<{ data: T; resourceId: string; resourceType: string }>,
  options: { observed?: T } = {},
): Promise<T> {
  const hash = digest(JSON.stringify(payload));
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    JSON.stringify([organizationId, who.actorId, operation, key]),
  ]);
  const existing = (
    await client.query(
      `SELECT * FROM app.operation_keys WHERE organization_id IS NOT DISTINCT FROM $1::uuid AND actor_id=$2 AND operation=$3 AND key=$4 FOR UPDATE`,
      [organizationId, who.actorId, operation, key],
    )
  ).rows[0];
  if (existing) {
    if (existing.payload_hash !== hash)
      throw new ApiError(
        'IDEMPOTENCY_CONFLICT',
        'La clave ya se utilizó con otros datos.',
        409,
      );
    if (
      new Date(existing.expires_at).getTime() <= Date.now() &&
      options.observed === undefined
    )
      throw new ApiError(
        'IDEMPOTENCY_CONFLICT',
        'La respuesta de esta clave venció. Consulta el recurso existente; la operación no se repetirá.',
        409,
      );
    if (existing.state === 'COMPLETED')
      return options.observed !== undefined
        ? options.observed
        : (existing.response_body as T);
    throw new ApiError(
      'REQUEST_IN_PROGRESS',
      'La solicitud sigue en curso.',
      409,
      true,
    );
  }
  const operationId = randomUUID();
  await client.query(
    `INSERT INTO app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,expires_at,lease_until) VALUES($1,$2,$3,$4,$5,$6,'RUNNING',now()+interval '24 hours',now()+interval '30 seconds')`,
    [operationId, organizationId, who.actorId, operation, key, hash],
  );
  const result = await action();
  await client.query(
    `UPDATE app.operation_keys SET state='COMPLETED',resource_type=$2,resource_id=$3,response_status=$4,response_body=$5::jsonb,updated_at=now(),lease_until=NULL WHERE id=$1`,
    [
      operationId,
      result.resourceType,
      result.resourceId,
      status,
      JSON.stringify(result.data),
    ],
  );
  return result.data;
}
