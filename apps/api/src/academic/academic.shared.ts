import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, notFound } from '../http/errors';
import {
  activeProfile,
  organizationContext,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';

export const academicPaginationSchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  state: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type AcademicQuery = z.infer<typeof academicPaginationSchema>;
export const activityPaginationSchema = academicPaginationSchema.extend({
  state: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).optional(),
});
export const exercisePaginationSchema = academicPaginationSchema.extend({
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  conceptId: z.uuid().optional(),
});
export function forbidden(): never {
  throw new ApiError(
    'FORBIDDEN',
    'No tienes permiso para realizar esta operación.',
    403,
  );
}
export function conflict(message: string): never {
  throw new ApiError('INVALID_REQUEST', message, 409);
}
export function available(row: Record<string, unknown>) {
  if (row.archived_at)
    conflict('El recurso archivado permite únicamente consultas.');
}
export async function academicContext(
  client: PoolClient,
  who: Actor,
  orgId: string,
  write: boolean,
  roles: string[] = [],
) {
  await activeProfile(client, who.actorId);
  const initial = await organizationContext(client, orgId, false);
  if (write && initial.archived_at)
    throw new ApiError(
      'ORGANIZATION_ARCHIVED',
      'La organización archivada permite únicamente consultas.',
      409,
    );
  if (write)
    await client.query(
      'SELECT app_private.lock_academic_organization($1::uuid)',
      [orgId],
    );
  const org = write ? await organizationContext(client, orgId, false) : initial;
  if (write && org.archived_at)
    throw new ApiError(
      'ORGANIZATION_ARCHIVED',
      'La organización archivada permite únicamente consultas.',
      409,
    );
  const membership = (
    await client.query(
      'SELECT role,state FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2',
      [orgId, who.actorId],
    )
  ).rows[0];
  if (!membership || membership.state !== 'ACTIVE') forbidden();
  if (roles.length && !roles.includes(membership.role)) forbidden();
  return { role: String(membership.role), timezone: String(org.timezone) };
}
const resourceTables = {
  course: 'courses',
  class: 'classes',
  concept: 'concept_tags',
  exercise: 'exercises',
  activity: 'activities',
} as const;
export async function resource(
  client: PoolClient,
  who: Actor,
  kind: keyof typeof resourceTables,
  id: string,
  write = false,
  roles: string[] = [],
) {
  const table = resourceTables[kind];
  const initial = (
    await client.query(`SELECT * FROM app.${table} WHERE id=$1`, [id])
  ).rows[0];
  if (!initial) throw notFound();
  const context = await academicContext(
    client,
    who,
    initial.organization_id,
    write,
    roles,
  );
  const row = (
    await client.query(`SELECT * FROM app.${table} WHERE id=$1`, [id])
  ).rows[0];
  if (!row) throw notFound();
  return { ...context, row };
}
export async function classAccess(
  client: PoolClient,
  who: Actor,
  id: string,
  write = false,
  teacherOnly = false,
) {
  const result = await resource(client, who, 'class', id, write);
  const { row, role } = result;
  const assigned = role === 'TEACHER' && row.teacher_id === who.actorId;
  if (teacherOnly && !assigned) forbidden();
  if (role === 'TEACHER' && !assigned) throw notFound();
  if (role === 'STUDENT') {
    const member = (
      await client.query(
        'SELECT id FROM app.class_memberships WHERE organization_id=$1 AND class_id=$2 AND user_id=$3 AND ended_at IS NULL',
        [row.organization_id, id, who.actorId],
      )
    ).rows[0];
    if (!member) throw notFound();
    if (write) forbidden();
  }
  if (write) available(row);
  return result;
}
export function dateOnly(value: unknown): string | null {
  return value == null
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
}
