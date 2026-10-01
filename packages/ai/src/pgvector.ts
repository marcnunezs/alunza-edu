import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { SourceRef } from '@alunza/contracts';
import { AiBoundaryError, validateVectors } from './ports';
import type {
  EmbeddingConfiguration,
  RetrievedChunk,
  RetrievalPort,
  RetrievalScope,
} from './ports';
import { referenceKey } from './assay';

const scopeSchema = z.strictObject({
  actorId: z.uuid(),
  organizationId: z.uuid(),
  classId: z.uuid(),
  activityId: z.uuid(),
});
export class PgvectorAssayRepository implements RetrievalPort {
  readonly pool: Pool;
  constructor(connectionString: string) {
    const url = new URL(connectionString);
    // This prototype can never be pointed at development or a remote database.
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '16422' ||
      url.username !== 'alunza_app' ||
      url.search ||
      url.hash ||
      url.pathname !== '/postgres'
    )
      throw new AiBoundaryError('INVALID_CONFIGURATION');
    this.pool = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 1500,
      query_timeout: 2500,
      statement_timeout: 2000,
      idle_in_transaction_session_timeout: 3000,
    });
    this.pool.on('error', () => undefined);
  }
  private async read<T>(
    scope: RetrievalScope,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!scopeSchema.safeParse(scope).success)
      throw new AiBoundaryError('ACCESS_DENIED');
    let client: PoolClient | undefined;
    let discard = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN READ ONLY');
      const role =
        await client.query(`SELECT current_user='alunza_app' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolreplication
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','rag_probe') AND c.relowner=r.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('app','rag_probe') AND nspowner=r.oid) AS allowed FROM pg_roles r WHERE rolname=current_user`);
      if (role.rows[0]?.allowed !== true)
        throw new AiBoundaryError('DATABASE_UNAVAILABLE');
      await client.query(
        "SELECT set_config('app.actor_id',$1,true), set_config('app.organization_id','',true), set_config('app.class_id','',true), set_config('app.activity_id','',true)",
        [scope.actorId],
      );
      const allowed = await client.query(
        `SELECT 1 FROM rag_probe.scope_grants g
        JOIN app.profiles p ON p.id=g.user_id
        JOIN app.organization_memberships m ON m.user_id=g.user_id AND m.organization_id=g.organization_id
        WHERE g.user_id=$1 AND g.organization_id=$2 AND g.class_id=$3 AND g.activity_id=$4
          AND g.active AND p.account_state='ACTIVE' AND m.state='ACTIVE'`,
        [scope.actorId, scope.organizationId, scope.classId, scope.activityId],
      );
      if (allowed.rowCount !== 1) throw new AiBoundaryError('ACCESS_DENIED');
      await client.query(
        "SELECT set_config('app.organization_id',$1,true), set_config('app.class_id',$2,true), set_config('app.activity_id',$3,true)",
        [scope.organizationId, scope.classId, scope.activityId],
      );
      const organization = await client.query(
        'SELECT 1 FROM app.organizations WHERE id=$1 AND archived_at IS NULL',
        [scope.organizationId],
      );
      if (organization.rowCount !== 1)
        throw new AiBoundaryError('ACCESS_DENIED');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client)
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      if (error instanceof AiBoundaryError) throw error;
      throw new AiBoundaryError('DATABASE_UNAVAILABLE');
    } finally {
      client?.release(discard);
    }
  }
  async authorize(scope: RetrievalScope): Promise<void> {
    await this.read(scope, async () => undefined);
  }
  async retrieve(
    scope: RetrievalScope,
    vector: readonly number[],
    config: EmbeddingConfiguration,
  ): Promise<RetrievedChunk[]> {
    validateVectors([vector], 1, config.dimensions);
    return this.read(scope, async (client) => {
      const result = await client.query<RetrievedChunk>(
        `WITH scoped AS MATERIALIZED (
        SELECT c.source_id,c.source_version_id,c.id AS chunk_id,c.locator,c.text,c.embedding
        FROM rag_probe.chunks c JOIN rag_probe.sources s ON s.id=c.source_id
        WHERE s.organization_id=$1 AND s.class_id=$2 AND (s.activity_id IS NULL OR s.activity_id=$3)
          AND s.visible AND NOT s.archived AND s.index_status='READY' AND s.active_generation
          AND s.configuration_id=$4 AND s.dimensions=$5
      ) SELECT source_id,source_version_id,chunk_id,locator,text,
        embedding OPERATOR(extensions.<=>) $6::extensions.vector AS distance
        FROM scoped ORDER BY distance,chunk_id LIMIT 5`,
        [
          scope.organizationId,
          scope.classId,
          scope.activityId,
          config.id,
          config.dimensions,
          JSON.stringify(vector),
        ],
      );
      return result.rows;
    });
  }
  async revalidate(
    scope: RetrievalScope,
    refs: readonly SourceRef[],
  ): Promise<boolean> {
    try {
      return await this.read(scope, async (client) => {
        const result = await client.query<SourceRef>(
          `SELECT c.source_id,c.source_version_id,c.id AS chunk_id,c.locator
          FROM rag_probe.chunks c WHERE c.id=ANY($1::uuid[])`,
          [refs.map((ref) => ref.chunk_id)],
        );
        const found = new Set(result.rows.map(referenceKey));
        return refs.every((ref) => found.has(referenceKey(ref)));
      });
    } catch (error) {
      if (error instanceof AiBoundaryError && error.reason === 'ACCESS_DENIED')
        return false;
      throw error;
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
