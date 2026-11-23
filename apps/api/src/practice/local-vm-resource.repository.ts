import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { vmResourceSchema, vmCleanupProofSchema } from './local-vm-contract';
import type { VmCleanupProof } from './local-vm-contract';
import type { ExecutionAuthority } from './execution.port';
import type { LocalVmContext } from './local-vm-config';

@Injectable()
export class LocalVmResourceRepository {
  constructor(private readonly database: DatabaseService) {}
  private call(sql: string, parameters: unknown[]) {
    return this.database.internal(
      async (client) => (await client.query(sql, parameters)).rows[0]?.value,
    );
  }
  async load(executionId: string) {
    const result = await this.call(
      'SELECT app_private.load_local_vm_resource($1::uuid) AS value',
      [z.uuid().parse(executionId)],
    );
    return result == null ? null : vmResourceSchema.parse(result);
  }
  async begin(
    executionId: string,
    authority: ExecutionAuthority,
    inputSha256: string,
  ) {
    return vmResourceSchema.parse(
      await this.call(
        'SELECT app_private.begin_local_vm_creation($1::uuid,$2::uuid,$3,$4::double precision,$5::double precision) AS value',
        [
          executionId,
          authority.leaseToken,
          inputSha256,
          authority.normalDeadlineMs,
          authority.cleanupDeadlineMs,
        ],
      ),
    );
  }
  async confirm(executionId: string, creationId: string, resourceId: string) {
    return vmResourceSchema.parse(
      await this.call(
        'SELECT app_private.confirm_local_vm_resource($1::uuid,$2::uuid,$3::uuid) AS value',
        [executionId, creationId, z.uuid().parse(resourceId)],
      ),
    );
  }
  async assertActive(
    executionId: string,
    leaseToken: string,
    context: LocalVmContext,
  ) {
    await this.call(
      'SELECT app_private.assert_local_vm_active($1::uuid,$2::uuid,$3::jsonb) AS value',
      [executionId, leaseToken, JSON.stringify(context)],
    );
  }
  async verifyCleanup(executionId: string, proof: VmCleanupProof) {
    await this.call(
      'SELECT app_private.verify_local_vm_cleanup($1::uuid,$2::jsonb) AS value',
      [executionId, JSON.stringify(vmCleanupProofSchema.parse(proof))],
    );
  }
}
