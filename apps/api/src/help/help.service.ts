import { Inject, Injectable } from '@nestjs/common';
import { helpReferenceSchema } from '@alunza/contracts';
import type { Actor } from '../governance/governance.shared';
import { ApiError } from '../http/errors';
import { MATERIALS_STORAGE } from '../materials/materials.ports';
import type { MaterialsStoragePort } from '../materials/materials.ports';
import { materialHash } from '../materials/materials.service';
import { HelpRepository } from './help.repository';

@Injectable()
export class HelpService {
  constructor(
    private readonly repository: HelpRepository,
    @Inject(MATERIALS_STORAGE) private readonly storage: MaterialsStoragePort,
  ) {}

  async reference(who: Actor, feedback: string, chunk: string) {
    const value = await this.repository.reference(who, feedback, chunk);
    return helpReferenceSchema.parse({
      sourceId: value.sourceId,
      versionId: value.versionId,
      chunkId: value.chunkId,
      title: value.title,
      version: value.version,
      fileName: value.fileName,
      format: value.format,
      locator: value.locator,
      text: value.text,
    });
  }

  async content(who: Actor, feedback: string, chunk: string) {
    const value = await this.repository.reference(who, feedback, chunk);
    const bytes = await this.storage.download(value.storageKey);
    if (
      bytes.length !== value.sizeBytes ||
      materialHash(bytes) !== value.sha256
    )
      throw new ApiError(
        'STORAGE_UNAVAILABLE',
        'No se pudo verificar el documento citado.',
        503,
        true,
      );
    // Authorize again after external storage I/O. Historical citations never
    // grant access to arbitrary versions or outlive current source permissions.
    await this.repository.reference(who, feedback, chunk);
    return { bytes, mimeType: value.mimeType, fileName: value.fileName };
  }
}
