import { Inject, Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MATERIAL_MAX_BYTES } from '@alunza/contracts';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ApiError } from '../http/errors';
import type { MaterialsStoragePort } from './materials.ports';

export const MATERIALS_BUCKET = 'materials';
// This privileged adapter has no domain-table operations. Only server-generated
// immutable keys reach it after domain authorization; browser JWTs never do.
@Injectable()
export class SupabaseMaterialsStorage implements MaterialsStoragePort {
  private readonly client: SupabaseClient | null;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client =
      config.supabaseUrl && config.supabaseSecretKey
        ? createClient(config.supabaseUrl, config.supabaseSecretKey, {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
              detectSessionInUrl: false,
            },
            global: {
              fetch: (url, init) =>
                fetch(url, {
                  ...init,
                  redirect: 'error',
                  signal: AbortSignal.timeout(30_000),
                }),
            },
          })
        : null;
  }
  private bucket(key: string) {
    // Hierarchical UUIDs, never a user filename, absolute path or traversal.
    if (!/^[a-f0-9-]{36}(\/[a-f0-9-]{36}){2,5}(\.[a-z]+)?$/.test(key))
      throw new ApiError(
        'INVALID_REQUEST',
        'La referencia del archivo no es válida.',
        400,
      );
    if (!this.client) throw this.unavailable();
    return this.client.storage.from(MATERIALS_BUCKET);
  }
  private unavailable(): ApiError {
    return new ApiError(
      'STORAGE_UNAVAILABLE',
      'El almacenamiento no está disponible. Intenta nuevamente.',
      503,
      true,
    );
  }
  async upload(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    if (!bytes.length || bytes.length > MATERIAL_MAX_BYTES)
      throw new ApiError(
        'PAYLOAD_TOO_LARGE',
        'El archivo debe contener entre 1 y 10.000.000 bytes.',
        413,
      );
    try {
      const { error } = await this.bucket(key).upload(key, bytes, {
        contentType,
        upsert: false,
        cacheControl: '0',
      });
      if (error) throw this.unavailable();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw this.unavailable();
    }
  }
  async stat(
    key: string,
  ): Promise<{ sizeBytes: number; contentType: string } | null> {
    try {
      const { data, error } = await this.bucket(key).info(key);
      if (error) {
        if (
          'statusCode' in error &&
          ['404', '400'].includes(String(error.statusCode)) &&
          /not found/i.test(error.message)
        )
          return null;
        throw this.unavailable();
      }
      if (!data || !Number.isSafeInteger(data.size) || !data.contentType)
        throw this.unavailable();
      return { sizeBytes: data.size!, contentType: data.contentType };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw this.unavailable();
    }
  }
  async download(key: string): Promise<Uint8Array> {
    try {
      const metadata = await this.stat(key);
      if (
        !metadata ||
        metadata.sizeBytes < 1 ||
        metadata.sizeBytes > MATERIAL_MAX_BYTES
      )
        throw this.unavailable();
      const { data, error } = await this.bucket(key).download(key);
      if (
        error ||
        !data ||
        data.size !== metadata.sizeBytes ||
        data.size > MATERIAL_MAX_BYTES
      )
        throw this.unavailable();
      return new Uint8Array(await data.arrayBuffer());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw this.unavailable();
    }
  }
  async remove(key: string): Promise<void> {
    try {
      const { error } = await this.bucket(key).remove([key]);
      if (error) throw this.unavailable();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw this.unavailable();
    }
  }
}
