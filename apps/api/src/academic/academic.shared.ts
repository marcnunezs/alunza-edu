import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Role } from '@alunza/contracts';
import { z } from 'zod';
import { academicPageQuerySchema } from '@alunza/contracts';
import { DatabaseService } from '../database/database.service';
import {
  activeProfile,
  organizationContext,
} from '../governance/governance.shared';
import type { Actor } from '../governance/governance.shared';
import { ApiError, notFound } from '../http/errors';

export type AcademicQuery = z.infer<typeof academicPageQuerySchema>;
export type Context = {
  client: PoolClient;
  who: Actor;
  organizationId: string;
  role: Role;
};
export const forbidden = () =>
  new ApiError(
    'FORBIDDEN',
    'No tienes permiso para realizar esta operación.',
    403,
  );
export const invalid = (message: string, field = '') =>
  new ApiError('VALIDATION_FAILED', message, 422, false, [{ field, message }]);
export const conflict = (message: string) =>
  new ApiError('DEPENDENCIES_ACTIVE', message, 409);
export function operational(row: Record<string, unknown>) {
  if (row.archived_at)
    throw new ApiError(
      'RESOURCE_ARCHIVED',
      'El recurso archivado permite únicamente consultas.',
      409,
    );
}
export function validateDates(
  start: string | null,
  end: string | null,
  parent?: { start: string | null; end: string | null },
) {
  if (start && end && start > end)
    throw invalid('La fecha final no puede preceder a la inicial.', 'endDate');
  if (
    parent &&
    ((start && parent.start && start < parent.start) ||
      (end && parent.end && end > parent.end))
  )
    throw invalid(
      'Las fechas de clase deben pertenecer al período del curso.',
      'startDate',
    );
}
export function normalizeConcept(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es');
}
export function dateValue(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value);
}
export function queryValues(query: AcademicQuery) {
  return [
    query.cursor ?? null,
    query.search ?? null,
    query.state ?? null,
    query.limit + 1,
  ];
}
export const listCondition = `( $2::uuid IS NULL OR id>$2 ) AND ($3::text IS NULL OR name ILIKE '%'||$3||'%') AND ($4::text IS NULL OR (CASE WHEN archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END)=$4)`;

@Injectable()
export class AcademicAccess {
  constructor(private readonly database: DatabaseService) {}

  async organization<T>(
    who: Actor,
    organizationId: string,
    write: boolean,
    roles: Role[],
    action: (context: Context) => Promise<T>,
  ): Promise<T> {
    return this.transaction(who, write, async (client) => {
      const context = await this.context(
        client,
        who,
        organizationId,
        write,
        roles,
      );
      return action(context);
    });
  }

  async resource<T>(
    who: Actor,
    kind: 'course' | 'class' | 'concept' | 'exercise' | 'activity',
    id: string,
    write: boolean,
    roles: Role[],
    action: (context: Context) => Promise<T>,
  ): Promise<T> {
    return this.transaction(who, write, async (client) => {
      const found = await client.query(
        'SELECT app_private.academic_resource_org($1,$2::uuid) AS organization_id',
        [kind, id],
      );
      const organizationId = found.rows[0]?.organization_id as
        string | undefined;
      if (!organizationId) throw notFound();
      return action(
        await this.context(client, who, organizationId, write, roles),
      );
    });
  }

  private async transaction<T>(
    who: Actor,
    write: boolean,
    action: (client: PoolClient) => Promise<T>,
  ) {
    const run = write
      ? this.database.writeAs.bind(this.database)
      : this.database.readAs.bind(this.database);
    return run(
      who.actorId,
      async (client) => {
        await activeProfile(client, who.actorId);
        return action(client);
      },
      who.sessionId,
    );
  }

  private async context(
    client: PoolClient,
    who: Actor,
    organizationId: string,
    write: boolean,
    roles: Role[],
  ): Promise<Context> {
    await organizationContext(client, organizationId, false);
    if (write)
      await client.query(
        'SELECT app_private.lock_academic_organization($1::uuid)',
        [organizationId],
      );
    const org = await organizationContext(client, organizationId, false);
    if (write && org.archived_at)
      throw new ApiError(
        'ORGANIZATION_ARCHIVED',
        'La organización archivada permite únicamente consultas.',
        409,
      );
    const membership = (
      await client.query(
        "SELECT role FROM app.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND state='ACTIVE'",
        [organizationId, who.actorId],
      )
    ).rows[0];
    if (!membership || !roles.includes(membership.role as Role))
      throw forbidden();
    return { client, who, organizationId, role: membership.role as Role };
  }
}

export async function classRow(context: Context, id: string, write = false) {
  const row = (
    await context.client.query(
      'SELECT * FROM app.classes WHERE id=$1 AND organization_id=$2',
      [id, context.organizationId],
    )
  ).rows[0];
  if (!row) throw notFound();
  if (write) operational(row);
  return row;
}

export async function teacherClass(
  context: Context,
  id: string,
  write = false,
) {
  const row = await classRow(context, id, write);
  if (context.role !== 'TEACHER' || row.teacher_id !== context.who.actorId)
    throw forbidden();
  return row;
}
