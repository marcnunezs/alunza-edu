import type { EmbeddingsPort } from '@alunza/ai';

export const MATERIALS_STORAGE = Symbol('MATERIALS_STORAGE');
export const MATERIALS_EMBEDDINGS = Symbol('MATERIALS_EMBEDDINGS');
export interface MaterialsStoragePort {
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  download(key: string): Promise<Uint8Array>;
  stat(key: string): Promise<{ sizeBytes: number; contentType: string } | null>;
  remove(key: string): Promise<void>;
}
export type MaterialsEmbeddingsPort = EmbeddingsPort;
