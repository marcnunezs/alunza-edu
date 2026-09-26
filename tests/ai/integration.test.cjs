const { assertLaboratoryTestState } = require('../laboratory-test-state.cjs');
const fs = require('node:fs/promises');
const { Pool } = require('pg');
const { PgvectorAssayRepository, runRagAssay } = require('@alunza/ai');
let f, state, admin, repository;
beforeAll(async () => {
  f = await import('../../fixtures/ai/corpus.mjs');
  state = JSON.parse(await fs.readFile(process.env.ALUNZA_TEST_STATE, 'utf8'));
  assertLaboratoryTestState(state);
  if (
    state.projectId !== 'alunza-edu-laboratorio-test' ||
    state.authUrl !== 'http://127.0.0.1:18421'
  )
    throw new Error('Wrong isolated test project');
  admin = new Pool({ connectionString: state.migrationUrl });
  const url = new URL(state.migrationUrl);
  url.username = 'alunza_app';
  url.password = state.applicationPassword;
  repository = new PgvectorAssayRepository(url.href);
});
afterAll(async () => {
  await repository?.close();
  await admin?.end();
});
afterEach(async () => {
  await admin.query(
    'UPDATE app.organizations SET archived_at=NULL WHERE id=$1',
    [f.orgA],
  );
  await admin.query(
    "UPDATE app.profiles SET account_state='ACTIVE' WHERE id=$1",
    [f.studentA],
  );
  await admin.query(
    "UPDATE app.organization_memberships SET state='ACTIVE' WHERE user_id=$1",
    [f.studentA],
  );
  await admin.query('UPDATE rag_probe.scope_grants SET active=true');
  for (const source of f.sources)
    await admin.query(
      "UPDATE rag_probe.sources SET archived=$1,visible=true,index_status='READY',active_generation=true WHERE id=$2",
      [source.archived, source.id],
    );
});
test('AI-DB-15 archived organization denies authorization before query embeddings', async () => {
  await admin.query(
    'UPDATE app.organizations SET archived_at=now() WHERE id=$1',
    [f.orgA],
  );
  await expect(repository.authorize(f.scope)).rejects.toMatchObject({
    reason: 'ACCESS_DENIED',
  });
  const embeddings = {
    ...f.embeddingDouble,
    embed: jest.fn(f.embeddingDouble.embed),
  };
  const generation = { generate: jest.fn(f.generationDouble.generate) };
  await expect(
    runRagAssay({
      diagnosis: 'FAILED_TEST',
      query: f.query,
      scope: f.scope,
      embeddings,
      generation,
      retrieval: repository,
      evidence: f.fixturePolicy,
    }),
  ).rejects.toMatchObject({ reason: 'ACCESS_DENIED' });
  expect(embeddings.embed).not.toHaveBeenCalled();
  expect(generation.generate).not.toHaveBeenCalled();
});
async function arbitraryContext(scope, action) {
  const client = await repository.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.actor_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.class_id',$3,true),set_config('app.activity_id',$4,true)",
      [
        scope.actorId ?? '',
        scope.organizationId ?? '',
        scope.classId ?? '',
        scope.activityId ?? '',
      ],
    );
    return await action(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
function query() {
  return repository.retrieve(f.scope, [1, 0, 0], f.doubleConfiguration);
}
test('AI-DB-01 real pgvector ranks five authorized chunks before LIMIT', async () => {
  const result = await query();
  expect(result).toHaveLength(5);
  expect(
    result.every((chunk) =>
      [f.sources[0].id, f.sources[1].id].includes(chunk.source_id),
    ),
  ).toBe(true);
  expect(result[0].distance).toBeCloseTo(0.00124766, 6);
  expect(result.map((row) => row.distance)).toEqual(
    [...result.map((row) => row.distance)].sort((a, b) => a - b),
  );
});
test('AI-DB-02 SQL hides closer foreign organization/class/activity and archived decoys', async () => {
  const result = await arbitraryContext(f.scope, (client) =>
    client.query('SELECT source_id FROM rag_probe.chunks'),
  );
  expect(result.rows).toHaveLength(7);
  expect(
    result.rows.every((row) =>
      [f.sources[0].id, f.sources[1].id].includes(row.source_id),
    ),
  ).toBe(true);
});
test.each(['organization', 'class', 'activity', 'no-context'])(
  'AI-DB-03 denies fabricated %s context in SQL',
  async (kind) => {
    const scope = { ...f.scope };
    if (kind === 'organization') scope.organizationId = f.orgB;
    if (kind === 'class') scope.classId = f.otherClassA;
    if (kind === 'activity') scope.activityId = f.otherActivityA;
    const result = await arbitraryContext(
      kind === 'no-context' ? {} : scope,
      (client) => client.query('SELECT id FROM rag_probe.chunks'),
    );
    expect(result.rowCount).toBe(0);
  },
);
test.each(['ADMIN', 'foreign-class', 'foreign-organization'])(
  'AI-DB-04 denies ungranted %s in repository',
  async (kind) => {
    const scope = { ...f.scope };
    if (kind === 'ADMIN') scope.actorId = f.adminA;
    if (kind === 'foreign-class') scope.classId = f.otherClassA;
    if (kind === 'foreign-organization') scope.organizationId = f.orgB;
    await expect(repository.authorize(scope)).rejects.toMatchObject({
      reason: 'ACCESS_DENIED',
    });
  },
);
test('AI-DB-05 teacher has only explicit fictitious grant', async () => {
  await expect(
    repository.authorize({ ...f.scope, actorId: f.teacherA }),
  ).resolves.toBeUndefined();
});
test.each(['profile', 'membership', 'grant'])(
  'AI-DB-06 live %s revocation removes access',
  async (kind) => {
    const sql =
      kind === 'profile'
        ? "UPDATE app.profiles SET account_state='DISABLED' WHERE id=$1"
        : kind === 'membership'
          ? "UPDATE app.organization_memberships SET state='DISABLED' WHERE user_id=$1"
          : 'UPDATE rag_probe.scope_grants SET active=false WHERE user_id=$1';
    await admin.query(sql, [f.studentA]);
    await expect(repository.authorize(f.scope)).rejects.toMatchObject({
      reason: 'ACCESS_DENIED',
    });
    expect(
      (
        await arbitraryContext(f.scope, (client) =>
          client.query('SELECT id FROM rag_probe.chunks'),
        )
      ).rowCount,
    ).toBe(0);
  },
);
test.each(['archived', 'invisible', 'partial', 'inactive-generation'])(
  'AI-DB-07 removes %s source after retrieval',
  async (kind) => {
    const refs = await query();
    const assignment = {
      archived: 'archived=true',
      invisible: 'visible=false',
      partial: "index_status='PROCESSING'",
      'inactive-generation': 'active_generation=false',
    }[kind];
    await admin.query(
      `UPDATE rag_probe.sources SET ${assignment} WHERE id=$1`,
      [refs[0].source_id],
    );
    expect(await repository.revalidate(f.scope, [refs[0]])).toBe(false);
  },
);
test('AI-DB-08 pool has no actor/scope after success and authorization rollback', async () => {
  await query();
  await expect(
    repository.authorize({ ...f.scope, classId: f.otherClassA }),
  ).rejects.toThrow('ACCESS_DENIED');
  const client = await repository.pool.connect();
  try {
    const result = await client.query(
      "SELECT nullif(current_setting('app.actor_id',true),'') AS actor,nullif(current_setting('app.organization_id',true),'') AS organization",
    );
    expect(result.rows).toEqual([{ actor: null, organization: null }]);
    expect(
      (await client.query('SELECT id FROM rag_probe.chunks')).rowCount,
    ).toBe(0);
  } finally {
    client.release();
  }
  expect((await query()).length).toBe(5);
});
test('AI-DB-09 ordinary role cannot write corpus', async () => {
  await expect(
    arbitraryContext(f.scope, (client) =>
      client.query("UPDATE rag_probe.chunks SET text='tampered'"),
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
test.each(['anon', 'authenticated'])(
  'AI-DB-10 %s cannot read private corpus',
  async (role) => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      await expect(
        client.query('SELECT id FROM rag_probe.chunks'),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);
test.each(['dimensions', 'foreign-source'])(
  'AI-DB-11 constraints reject %s writes even by fixture bootstrap',
  async (kind) => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      const sql =
        kind === 'dimensions'
          ? "UPDATE rag_probe.chunks SET embedding='[1,0]'::extensions.vector WHERE id=$1"
          : 'UPDATE rag_probe.chunks SET organization_id=$2 WHERE id=$1';
      await expect(
        client.query(
          sql,
          kind === 'dimensions'
            ? [f.sources[0].chunks[0].id]
            : [f.sources[0].chunks[0].id, f.orgB],
        ),
      ).rejects.toMatchObject({
        code: kind === 'dimensions' ? '23514' : '23503',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);
test('AI-DB-12 excludes incompatible configuration before distance', async () => {
  expect(
    await repository.retrieve(f.scope, [1, 0, 0], {
      ...f.doubleConfiguration,
      id: 'different-model',
    }),
  ).toEqual([]);
});
test('AI-DB-13 standalone end-to-end uses real retrieval and named doubles', async () => {
  const result = await runRagAssay({
    diagnosis: 'FAILED_TEST',
    query: f.query,
    scope: f.scope,
    embeddings: f.embeddingDouble,
    retrieval: repository,
    generation: f.generationDouble,
    evidence: f.fixturePolicy,
  });
  expect(result.help.status).toBe('SUPPORTED');
  expect(result.help.source_refs).toHaveLength(1);
  expect(result.semanticPolicy).toContain('fixture');
});
test('AI-DB-14 real SQL separates the synthetic 3D corpus from a provider-shaped 4D generation', async () => {
  const ids = [
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000003',
    '90000000-0000-4000-8000-000000000004',
  ];
  const config = {
    id: 'explicit-provider-transport-double-4d',
    model: 'not-real-azure',
    dimensions: 4,
  };
  try {
    await admin.query(
      "INSERT INTO rag_probe.sources VALUES($1,$2,$3,$4,$5,NULL,true,false,'READY',true,$6,4)",
      [ids[0], ids[1], ids[2], f.orgA, f.classA, config.id],
    );
    await admin.query(
      "INSERT INTO rag_probe.chunks VALUES($1,$2,$3,$4,$5,$6,$7,4,0,'Fragmento de dimensión distinta','Sección 1','[1,0,0,0]'::extensions.vector)",
      [ids[3], ids[0], ids[1], ids[2], f.orgA, f.classA, config.id],
    );
    const result = await repository.retrieve(f.scope, [1, 0, 0, 0], config);
    expect(result).toHaveLength(1);
    expect(result[0].chunk_id).toBe(ids[3]);
    expect(result[0].distance).toBe(0);
    expect((await query()).length).toBe(5);
  } finally {
    await admin.query('DELETE FROM rag_probe.chunks WHERE id=$1', [ids[3]]);
    await admin.query('DELETE FROM rag_probe.sources WHERE id=$1', [ids[0]]);
  }
});
