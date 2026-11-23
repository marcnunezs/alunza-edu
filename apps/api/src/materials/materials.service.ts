import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { detectMaterialFormat, MaterialIngestionError } from '@alunza/ai';
import { MATERIAL_MAX_BYTES } from '@alunza/contracts';
import type { Actor } from '../governance/governance.shared';
import { ApiError } from '../http/errors';
import { MATERIALS_STORAGE } from './materials.ports';
import type { MaterialsStoragePort } from './materials.ports';
import { MaterialsRepository } from './materials.repository';
import type { MaterialQuery } from './materials.repository';

export const materialHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
@Injectable()
export class MaterialsService {
  constructor(
    private readonly repository: MaterialsRepository,
    @Inject(MATERIALS_STORAGE) private readonly storage: MaterialsStoragePort,
  ) {}
  list(who: Actor, cls: string, q: MaterialQuery) {
    return this.repository.list(who, cls, q);
  }
  detail(who: Actor, source: string) {
    return this.repository.detail(who, source);
  }
  scopes(who: Actor, cls: string, q: MaterialQuery) {
    return this.repository.scopes(who, cls, q);
  }
  versions(who: Actor, source: string, q: MaterialQuery) {
    return this.repository.versions(who, source, q);
  }
  chunks(
    who: Actor,
    source: string,
    version: string,
    q: { cursor?: number; limit: number },
  ) {
    return this.repository.chunks(who, source, version, q);
  }
  job(who: Actor, source: string, job: string) {
    return this.repository.job(who, source, job);
  }
  async upload(
    who: Actor,
    cls: string | null,
    source: string | null,
    revision: number | null,
    fields: { title?: string; activityId?: string },
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
    key: string,
  ) {
    // Scope is checked by the multipart guard before bytes are buffered, and again
    // transactionally when reserving the immutable object identity.
    if (!file || !file.buffer.length)
      throw new ApiError(
        'VALIDATION_FAILED',
        'Selecciona un archivo con contenido.',
        422,
      );
    if (
      file.buffer.length > MATERIAL_MAX_BYTES ||
      file.size !== file.buffer.length
    )
      throw new ApiError(
        'PAYLOAD_TOO_LARGE',
        'El archivo supera 10.000.000 bytes.',
        413,
      );
    const fileName = file.originalname.normalize('NFC');
    if (
      fileName.length < 1 ||
      fileName.length > 255 ||
      Array.from(fileName).some(
        (char) =>
          char.codePointAt(0)! < 32 ||
          char.codePointAt(0) === 127 ||
          char === '/' ||
          char === '\\',
      )
    )
      throw new ApiError(
        'VALIDATION_FAILED',
        'El nombre del archivo no es válido.',
        422,
      );
    let format;
    try {
      format = detectMaterialFormat(file.buffer, fileName);
    } catch (error) {
      if (error instanceof MaterialIngestionError)
        throw new ApiError(
          error.code === 'FILE_TOO_LARGE'
            ? 'PAYLOAD_TOO_LARGE'
            : 'UNSUPPORTED_MEDIA_TYPE',
          'Admite PDF con texto, TXT y Markdown UTF-8 de hasta 10.000.000 bytes.',
          error.code === 'FILE_TOO_LARGE' ? 413 : 415,
        );
      throw error;
    }
    const metadata = {
      fileName,
      format,
      mimeType:
        format === 'PDF'
          ? 'application/pdf'
          : format === 'MARKDOWN'
            ? 'text/markdown'
            : 'text/plain',
      sizeBytes: file.buffer.length,
      sha256: materialHash(file.buffer),
    };
    const reservation = await this.repository.reserve(
      who,
      cls,
      source,
      revision,
      fields.title ?? null,
      fields.activityId ?? null,
      metadata,
      key,
    );
    if ((reservation.responseStatus ?? 202) >= 400)
      throw new ApiError(
        'STORAGE_UNAVAILABLE',
        'La carga anterior no se confirmó. Reemplaza el archivo para crear una nueva carga.',
        503,
        false,
      );
    if (reservation.kind === 'reserved') {
      const storageKey = reservation.storageKey!;
      // Reconcile uncertain delivery before retry: an immutable existing object
      // is accepted only when its actual bytes match the reserved digest.
      const existing = await this.storage.stat(storageKey);
      if (existing) {
        const bytes = await this.storage.download(storageKey);
        if (
          bytes.length !== metadata.sizeBytes ||
          materialHash(bytes) !== metadata.sha256
        ) {
          await this.repository.fail(
            { id: reservation.jobId, token: reservation.uploadToken! },
            'CONTENT_MISMATCH',
          );
          throw new ApiError(
            'STORAGE_UNAVAILABLE',
            'No se pudo verificar el archivo almacenado.',
            503,
            true,
          );
        }
      } else {
        await this.storage.upload(storageKey, file.buffer, metadata.mimeType);
        const stored = await this.storage.download(storageKey);
        if (
          stored.length !== metadata.sizeBytes ||
          materialHash(stored) !== metadata.sha256
        ) {
          await this.repository.fail(
            { id: reservation.jobId, token: reservation.uploadToken! },
            'CONTENT_MISMATCH',
          );
          throw new ApiError(
            'STORAGE_UNAVAILABLE',
            'No se pudo verificar el archivo almacenado.',
            503,
            true,
          );
        }
      }
      // A lost Storage response or commit leaves a durable reservation for the
      // worker to reconcile. The caller receives no accepted response early.
      if (
        !(await this.repository.confirm(
          reservation.jobId,
          reservation.uploadToken!,
        ))
      )
        throw new ApiError(
          'REQUEST_IN_PROGRESS',
          'La carga está siendo reconciliada. Consulta su estado.',
          409,
          true,
        );
    }
    return this.repository.operation(who, reservation);
  }
  async reindex(
    who: Actor,
    source: string,
    version: string | undefined,
    revision: number,
    key: string,
  ) {
    const reservation = await this.repository.reindex(
      who,
      source,
      version,
      revision,
      key,
    );
    return this.repository.operation(who, reservation);
  }
  visibility(who: Actor, source: string, visible: boolean, revision: number) {
    return this.repository.govern(who, source, revision, visible, false);
  }
  archive(
    who: Actor,
    source: string,
    reason: string,
    revision: number,
    key: string,
  ) {
    return this.repository.govern(
      who,
      source,
      revision,
      null,
      true,
      reason,
      key,
    );
  }
  async content(who: Actor, source: string, version: string) {
    const metadata = await this.repository.content(who, source, version);
    const bytes = await this.storage.download(metadata.key);
    if (
      bytes.length !== metadata.sizeBytes ||
      materialHash(bytes) !== metadata.sha256
    )
      throw new ApiError(
        'STORAGE_UNAVAILABLE',
        'No se pudo verificar el archivo.',
        503,
        true,
      );
    // Reauthorize after Storage I/O, immediately before returning private bytes.
    await this.repository.content(who, source, version);
    return { ...metadata, bytes };
  }
}
