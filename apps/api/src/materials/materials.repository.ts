import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  materialSourceSchema,
  materialVersionSchema,
  materialJobSchema,
  materialOperationSchema,
} from '@alunza/contracts';
import type {
  MaterialFormat,
  MaterialSource,
  MaterialVersion,
  MaterialJob,
} from '@alunza/contracts';
import type { PoolClient } from 'pg';
import { validateVectors } from '@alunza/ai';
import type { EmbeddingConfiguration, RetrievedChunk } from '@alunza/ai';
import { DatabaseService } from '../database/database.service';
import type { Actor } from '../governance/governance.shared';
import {
  iso,
  pageResult,
  checkRevision,
} from '../governance/governance.shared';
import { classAccess } from '../academic/academic.shared';
import { ApiError, notFound } from '../http/errors';

export const materialQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  activityId: z.uuid().optional(),
});
export type MaterialQuery = z.infer<typeof materialQuerySchema>;
export const materialChunkQuerySchema = z.strictObject({
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export interface UploadMetadata {
  fileName: string;
  format: MaterialFormat;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}
export interface MaterialReservation {
  kind: 'reserved' | 'replay';
  sourceId: string;
  versionId: string;
  generationId: string;
  jobId: string;
  uploadToken?: string;
  storageKey?: string;
  responseStatus?: number;
}
export interface ClaimedMaterialJob {
  kind: 'upload' | 'index';
  id: string;
  token: string;
  sourceId: string;
  versionId: string;
  generationId?: string;
  storageKey: string;
  sha256: string;
  format: MaterialFormat;
  attempt: number;
}
type Row = Record<string, unknown>;
const jobColumns =
  'id,organization_id,class_id,source_id,source_version_id,generation_id,requested_by,kind,lifecycle_status,attempt_count,available_at,last_error_code,correlation_id,created_at,updated_at,completed_at';
const sourceSql = `SELECT s.*,to_jsonb(v) AS active_version,g.chunk_count,g.id AS active_generation_id,
  (SELECT to_jsonb(j) FROM (SELECT ${jobColumns} FROM app.material_jobs WHERE source_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) j) AS latest_job,
  app_private.academic_role(s.organization_id,array['ADMIN']) AS admin_allowed,
  app_private.academic_teacher(s.class_id) AS teacher_allowed
 FROM app.sources s LEFT JOIN app.source_versions v ON v.id=s.current_version_id
 LEFT JOIN app.source_index_generations g ON g.id=v.current_generation_id`;
export const materialErrorMessages: Record<string, string> = {
  CONFIGURATION_MISSING:
    'La configuración de embeddings aún no está disponible. Puedes reintentar cuando esté lista.',
  CONFIGURATION_MISMATCH:
    'La configuración no coincide con el índice existente. Debe corregirse antes de reintentar.',
  NO_TEXT:
    'El archivo no contiene texto extraíble. Carga un PDF con texto, TXT o Markdown.',
  PDF_ENCRYPTED: 'El PDF está protegido. Carga una copia sin contraseña.',
  ENCRYPTED_PDF: 'El PDF está protegido. Carga una copia sin contraseña.',
  INVALID_PDF:
    'El PDF está dañado o no es procesable. Carga una copia válida con texto.',
  INVALID_TEXT: 'El archivo debe contener texto UTF-8 válido.',
  UNSUPPORTED_FORMAT: 'Admite PDF con texto, TXT y Markdown.',
  FILE_TOO_LARGE: 'El archivo supera 10.000.000 bytes.',
  EXTRACTION_LIMIT:
    'El documento supera los límites de páginas, texto o memoria de extracción.',
  EXTRACTION_UNAVAILABLE:
    'El servicio de extracción no está disponible. Puedes reintentar.',
  INVALID_CONFIGURATION:
    'La configuración del proveedor requiere corrección antes de reintentar.',
  INVALID_EMBEDDING:
    'El proveedor devolvió embeddings incompatibles. No se activó la generación.',
  PROVIDER_REJECTED:
    'El proveedor rechazó el procesamiento. Revisa la configuración antes de reintentar.',
  INVALID_DOCUMENT: 'No se pudo procesar el documento. Comprueba su contenido.',
  EXTRACTION_TIMEOUT: 'La extracción superó el tiempo permitido.',
  PROVIDER_FAILURE: 'El proveedor de embeddings no está disponible.',
  PROVIDER_UNAVAILABLE: 'El proveedor de embeddings no está disponible.',
  STORAGE_UNAVAILABLE: 'El almacenamiento no está disponible.',
  UPLOAD_INCOMPLETE: 'La carga no terminó. Carga el archivo de nuevo.',
  CONTENT_MISMATCH: 'El archivo almacenado no coincide con la carga original.',
  PERMISSION_REVOKED: 'La autorización de procesamiento cambió.',
  SOURCE_ARCHIVED: 'La fuente fue archivada.',
  RETRY_LIMIT:
    'Se agotaron los reintentos automáticos. Puedes reintentar manualmente.',
};
export function versionProjection(row: Row): MaterialVersion {
  return materialVersionSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    version: Number(row.version),
    fileName: row.original_name,
    format: row.format,
    sizeBytes: Number(row.size_bytes),
    sha256: row.content_hash,
    createdAt: iso(row.created_at as Date),
  });
}
export function jobProjection(row: Row): MaterialJob {
  const code = row.last_error_code == null ? null : String(row.last_error_code);
  return materialJobSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    versionId: row.source_version_id,
    generationId: row.generation_id,
    state:
      row.lifecycle_status === 'CANCELLED' ? 'FAILED' : row.lifecycle_status,
    attempts: Number(row.attempt_count),
    errorCode: code,
    errorMessage: code
      ? (materialErrorMessages[code] ??
        'No se pudo completar el procesamiento. Revisa el archivo e intenta nuevamente.')
      : null,
    createdAt: iso(row.created_at as Date),
    updatedAt: iso(row.updated_at as Date),
  });
}
export function sourceProjection(row: Row, actorId: string): MaterialSource {
  const admin = row.admin_allowed === true;
  const teacher = row.teacher_allowed === true;
  const active = !row.archived_at;
  const own = teacher && row.owner_id === actorId;
  const job = row.latest_job ? jobProjection(row.latest_job as Row) : null;
  return materialSourceSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    classId: row.class_id,
    activityId: row.activity_id,
    ownerId: row.owner_id,
    title: row.title,
    visible: row.visibility === 'VISIBLE',
    state: active ? 'ACTIVE' : 'ARCHIVED',
    availability: !active
      ? 'ARCHIVED'
      : row.visibility === 'HIDDEN'
        ? 'HIDDEN'
        : row.current_version_id
          ? 'READY'
          : 'NOT_READY',
    revision: Number(row.revision),
    createdAt: iso(row.created_at as Date),
    activeVersion: row.active_version
      ? versionProjection(row.active_version as Row)
      : null,
    activeGenerationId: row.active_generation_id ?? null,
    chunkCount: Number(row.chunk_count ?? 0),
    latestJob: job,
    permissions: {
      replace: active && (admin || own),
      retry:
        active &&
        !['UPLOAD_INCOMPLETE', 'CONTENT_MISMATCH'].includes(
          job?.errorCode ?? '',
        ) &&
        (admin || (own && job?.state === 'FAILED')),
      govern: active && admin,
      history: admin || teacher,
    },
  });
}

@Injectable()
export class MaterialsRepository {
  constructor(private readonly database: DatabaseService) {}
  async retrieve(
    who: Actor,
    classId: string,
    activityId: string,
    config: EmbeddingConfiguration,
    vector: readonly number[],
  ): Promise<RetrievedChunk[]> {
    validateVectors([vector], 1, config.dimensions);
    return this.database
      .readAs(
        who.actorId,
        async (client) =>
          (
            await client.query<RetrievedChunk>(
              'SELECT * FROM app_private.material_retrieve($1::uuid,$2::uuid,$3,$4,$5::extensions.vector)',
              [
                classId,
                activityId,
                config.id,
                config.dimensions,
                JSON.stringify(vector),
              ],
            )
          ).rows,
        who.sessionId,
      )
      .catch((error: unknown) =>
        this.denied(who, classId, null, 'retrieve', error),
      );
  }
  private async source(client: PoolClient, who: Actor, id: string) {
    const row = (await client.query(`${sourceSql} WHERE s.id=$1`, [id]))
      .rows[0];
    if (!row) throw notFound();
    return sourceProjection(row, who.actorId);
  }
  detail(who: Actor, id: string) {
    return this.database.readAs(
      who.actorId,
      (client) => this.source(client, who, id),
      who.sessionId,
    );
  }
  list(who: Actor, cls: string, q: MaterialQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        await classAccess(client, who, cls);
        const rows = (
          await client.query(
            `${sourceSql} WHERE s.class_id=$1 AND ($2::uuid IS NULL OR s.id>$2)
        AND ($3::uuid IS NULL OR s.activity_id IS NULL OR s.activity_id=$3) ORDER BY s.id LIMIT $4`,
            [cls, q.cursor ?? null, q.activityId ?? null, q.limit + 1],
          )
        ).rows;
        return pageResult(
          rows.map((row) => sourceProjection(row, who.actorId)),
          q.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  scopes(who: Actor, cls: string, q: MaterialQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const rows = (
          await client.query(
            'SELECT * FROM app_private.material_scopes($1) WHERE ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
            [cls, q.cursor ?? null, q.limit + 1],
          )
        ).rows;
        return pageResult(
          rows as Array<{ id: string; title: string; state: string }>,
          q.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  versions(who: Actor, source: string, q: MaterialQuery) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const visible = await this.source(client, who, source);
        if (!visible.permissions.history) throw notFound();
        const rows = (
          await client.query(
            'SELECT * FROM app.source_versions WHERE source_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
            [source, q.cursor ?? null, q.limit + 1],
          )
        ).rows;
        return pageResult(
          rows.map(versionProjection),
          q.limit,
          (row) => row.id,
        );
      },
      who.sessionId,
    );
  }
  chunks(
    who: Actor,
    source: string,
    version: string,
    q: z.infer<typeof materialChunkQuerySchema>,
  ) {
    return this.database.readAs(
      who.actorId,
      async (client) =>
        (
          await client.query(
            'SELECT app_private.material_chunks($1,$2,$3,$4) AS result',
            [source, version, q.cursor ?? -1, q.limit],
          )
        ).rows[0].result as {
          data: unknown[];
          page: { nextCursor: string | null; hasMore: boolean };
        },
      who.sessionId,
    );
  }
  job(who: Actor, source: string, id: string) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const row = (
          await client.query(
            `SELECT ${jobColumns} FROM app.material_jobs WHERE id=$1 AND source_id=$2`,
            [id, source],
          )
        ).rows[0];
        if (!row) throw notFound();
        return jobProjection(row);
      },
      who.sessionId,
    );
  }
  authorizeUpload(who: Actor, cls: string | null, source?: string) {
    return this.database
      .writeAs(
        who.actorId,
        async (client) => {
          if (source) {
            const visible = await this.source(client, who, source);
            if (!visible.permissions.replace)
              throw new ApiError(
                'FORBIDDEN',
                'No puedes reemplazar este material.',
                403,
              );
            cls = visible.classId;
          }
          await client.query('SELECT app_private.material_assert_class($1)', [
            cls,
          ]);
        },
        who.sessionId,
      )
      .catch((error: unknown) =>
        this.denied(who, cls, source ?? null, 'upload', error),
      );
  }
  reserve(
    who: Actor,
    cls: string | null,
    source: string | null,
    revision: number | null,
    title: string | null,
    activity: string | null,
    metadata: UploadMetadata,
    key: string,
  ) {
    return this.database
      .writeAs(
        who.actorId,
        async (client) => {
          const row = (
            await client.query(
              'SELECT app_private.material_reserve_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result',
              [
                cls,
                activity,
                source,
                revision,
                title,
                metadata.fileName,
                metadata.format,
                metadata.mimeType,
                metadata.sizeBytes,
                metadata.sha256,
                key,
                who.requestId,
              ],
            )
          ).rows[0]?.result;
          if (row?.kind === 'precondition') checkRevision(0, 1);
          return row as MaterialReservation;
        },
        who.sessionId,
      )
      .catch((error: unknown) =>
        this.denied(who, cls, source, 'upload', error),
      );
  }
  confirm(job: string, token: string) {
    return this.internalBoolean('material_confirm_upload', [job, token]);
  }
  operation(who: Actor, reservation: MaterialReservation) {
    return this.database.readAs(
      who.actorId,
      async (client) => {
        const source = await this.source(client, who, reservation.sourceId);
        const version = (
          await client.query(
            'SELECT * FROM app.source_versions WHERE id=$1 AND source_id=$2',
            [reservation.versionId, source.id],
          )
        ).rows[0];
        const job = (
          await client.query(
            `SELECT ${jobColumns} FROM app.material_jobs WHERE id=$1 AND source_id=$2`,
            [reservation.jobId, source.id],
          )
        ).rows[0];
        if (!version || !job) throw notFound();
        return materialOperationSchema.parse({
          source,
          version: versionProjection(version),
          job: jobProjection(job),
        });
      },
      who.sessionId,
    );
  }
  reindex(
    who: Actor,
    source: string,
    version: string | undefined,
    revision: number,
    key: string,
  ) {
    return this.database
      .writeAs(
        who.actorId,
        async (client) => {
          const row = (
            await client.query(
              'SELECT app_private.material_reindex($1,$2,$3,$4,$5) AS result',
              [source, version ?? null, revision, key, who.requestId],
            )
          ).rows[0]?.result;
          if (row?.kind === 'precondition') checkRevision(0, 1);
          return row as MaterialReservation;
        },
        who.sessionId,
      )
      .catch((error: unknown) =>
        this.denied(who, null, source, 'reindex', error),
      );
  }
  async govern(
    who: Actor,
    source: string,
    revision: number,
    visible: boolean | null,
    archive: boolean,
    reason?: string,
    key?: string,
  ) {
    await this.database
      .writeAs(
        who.actorId,
        async (client) => {
          const row = (
            await client.query(
              'SELECT app_private.material_govern($1,$2,$3,$4,$5,$6,$7) AS result',
              [
                source,
                revision,
                visible == null ? null : visible ? 'VISIBLE' : 'HIDDEN',
                archive,
                who.requestId,
                reason ?? null,
                key ?? null,
              ],
            )
          ).rows[0];
          if (!row?.result) checkRevision(0, 1);
        },
        who.sessionId,
      )
      .catch((error: unknown) =>
        this.denied(who, null, source, 'govern', error),
      );
    return this.detail(who, source);
  }
  content(who: Actor, source: string, version: string) {
    return this.database
      .readAs(
        who.actorId,
        async (client) =>
          (
            await client.query(
              'SELECT app_private.material_content($1,$2) AS result',
              [source, version],
            )
          ).rows[0].result as {
            key: string;
            fileName: string;
            mimeType: string;
            sizeBytes: number;
            sha256: string;
          },
        who.sessionId,
      )
      .catch((error: unknown) =>
        this.denied(who, null, source, 'content', error),
      );
  }
  private async denied(
    who: Actor,
    cls: string | null,
    source: string | null,
    operation: string,
    error: unknown,
  ): Promise<never> {
    if (
      error instanceof ApiError &&
      [400, 403, 404, 422].includes(error.getStatus())
    ) {
      try {
        await this.database.writeAs(
          who.actorId,
          async (client) => {
            await client.query(
              'SELECT app_private.material_record_denial($1,$2,$3,$4)',
              [cls, source, operation, who.requestId],
            );
          },
          who.sessionId,
        );
      } catch {
        /* Audit failure never turns a denial into successful access. */
      }
    }
    throw error;
  }
  claim(): Promise<ClaimedMaterialJob | null> {
    return this.database.internal(
      async (client) =>
        (
          await client.query(
            'SELECT app_private.material_claim_job() AS result',
          )
        ).rows[0]?.result ?? null,
    );
  }
  renew(job: ClaimedMaterialJob) {
    return this.internalBoolean('material_renew_job', [job.id, job.token]);
  }
  fail(
    job: { id: string; token: string },
    code: string,
    retryable = false,
    retryAfterMs = 0,
  ) {
    return this.internalBoolean('material_fail_job', [
      job.id,
      job.token,
      code,
      retryable,
      Math.min(300000, Math.max(0, Math.trunc(retryAfterMs))),
    ]);
  }
  prepare(
    job: ClaimedMaterialJob,
    config: { id: string; model: string; dimensions: number },
    extraction: string,
    tokenizer: string,
    count: number,
    manifest: string,
  ): Promise<number> {
    return this.database.internal(async (client) =>
      Number(
        (
          await client.query(
            'SELECT app_private.material_prepare_generation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
            [
              job.id,
              job.token,
              config.id,
              config.model,
              config.dimensions,
              extraction,
              tokenizer,
              count,
              manifest,
            ],
          )
        ).rows[0]?.result,
      ),
    );
  }
  stage(
    job: ClaimedMaterialJob,
    chunks: unknown[],
    usage?: { inputTokens: number; model: string; requestId?: string },
  ) {
    return this.internalBoolean('material_stage_chunks', [
      job.id,
      job.token,
      JSON.stringify(chunks),
      usage ? JSON.stringify(usage) : null,
    ]);
  }
  publish(job: ClaimedMaterialJob) {
    return this.internalBoolean('material_publish_job', [job.id, job.token]);
  }
  claimCleanup(): Promise<{
    id: string;
    token: string;
    storageKey: string;
  } | null> {
    return this.database.internal(
      async (client) =>
        (
          await client.query(
            'SELECT app_private.material_claim_cleanup() AS result',
          )
        ).rows[0]?.result ?? null,
    );
  }
  finishCleanup(job: { id: string; token: string }) {
    return this.internalBoolean('material_finish_cleanup', [job.id, job.token]);
  }
  private internalBoolean(name: string, values: unknown[]) {
    return this.database.internal(
      async (client) =>
        (
          await client.query(
            `SELECT app_private.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`,
            values,
          )
        ).rows[0]?.result === true,
    );
  }
}
