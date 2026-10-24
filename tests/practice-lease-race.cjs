/* eslint @typescript-eslint/no-require-imports: "off" */
const { randomUUID, createHash } = require('node:crypto');

// Uses two real PostgreSQL connections and verifies an actual lock wait before
// expiring the lease. No Docker work, runner mock or disabled trigger is needed.
async function expiredLeaseWhileWaiting({
  pool,
  ids,
  student,
  source,
  mode,
  asApplication,
  eventually,
}) {
  const submit = mode === 'SUBMIT';
  if (!submit && mode !== 'RUN') throw new Error('Invalid lease race mode');
  const table = submit
    ? 'app_private.submission_reservations'
    : 'app.executions';
  const executionId = randomUUID();
  const operationId = randomUUID();
  const token = randomUUID();
  const codeHash = createHash('sha256').update(source).digest('hex');
  const result = {
    runnerVersion: 'lease-race-fixture',
    diagnosisCode: 'UNKNOWN',
    terminationReason: 'PROVIDER_FAILURE',
    infrastructureStatus: 'FAILED',
    visibleTestResults: [],
    visiblePassed: 0,
    visibleTotal: 1,
    outputTruncated: false,
    outputBytes: 0,
    runtimeMs: 0,
    lifecycleMs: 0,
    ...(submit ? { hiddenChecksPassed: null, allRequiredPassed: false } : {}),
  };
  const blocker = await pool.connect();
  let completion;
  try {
    await blocker.query('BEGIN');
    await blocker.query(
      "INSERT INTO app.operation_keys(id,organization_id,actor_id,operation,key,payload_hash,state,resource_type,resource_id,lease_until) VALUES($1,$2,$3,$4,$5,$6,'RUNNING',$7,$8,clock_timestamp()+interval '60 seconds')",
      [
        operationId,
        ids.org,
        student.id,
        submit ? 'practice.submit' : 'practice.run',
        randomUUID(),
        codeHash,
        submit ? 'submission' : 'execution',
        executionId,
      ],
    );
    const commonColumns =
      'id,organization_id,class_id,activity_id,activity_exercise_id,exercise_version_id,student_id,operation_id,code_hash,test_suite_hash,limits_snapshot,runner_version,visible_total,admitted_at,lease_until,lease_token,response_expires_at,request_id';
    const commonValues =
      "$1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'{\"memoryBytes\":134217728,\"runtimeMs\":3000,\"outputBytes\":65536}','lease-race-fixture',1,clock_timestamp(),clock_timestamp()+interval '60 seconds',$10,clock_timestamp()+interval '24 hours',$11";
    const extraColumns = submit
      ? ',code,total_required,attempt_number,staged_result,staged_private_results'
      : ',started_at';
    const extraValues = submit
      ? ",$12,2,1,$13::jsonb,'[]'::jsonb"
      : ',clock_timestamp()';
    await blocker.query(
      `INSERT INTO ${table}(${commonColumns}${extraColumns}) VALUES(${commonValues}${extraValues})`,
      [
        executionId,
        ids.org,
        ids.class,
        ids.activity,
        ids.assignment,
        ids.version,
        student.id,
        operationId,
        codeHash,
        token,
        randomUUID(),
        ...(submit ? [source, JSON.stringify(result)] : []),
      ],
    );
    await blocker.query('COMMIT');

    await blocker.query('BEGIN');
    await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
      executionId,
    ]);
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid'))
      .rows[0].pid;
    let workerPid;
    // Handle rejection immediately so it cannot become an unhandled promise
    // while the controlling connection is waiting for expiry.
    completion = asApplication(null, async (client) => {
      workerPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid;
      await client.query("SET LOCAL statement_timeout='8s'");
      return submit
        ? client.query(
            'SELECT app_private.finish_practice_submit($1,$2,true)',
            [executionId, token],
          )
        : client.query(
            'SELECT app_private.finish_practice_run($1,$2,$3,true)',
            [executionId, token, JSON.stringify(result)],
          );
    }).then(
      () => ({ accepted: true }),
      (error) => ({ error }),
    );
    await eventually(async () => {
      if (!workerPid) return false;
      return (
        await pool.query(
          'SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked',
          [workerPid, blockerPid],
        )
      ).rows[0].blocked;
    }, 3000);
    // The worker already entered finish with a live lease. Keep it blocked
    // while that lease expires, then release precisely the same token/row.
    await blocker.query(
      `UPDATE ${table} SET lease_until=clock_timestamp()+interval '250 milliseconds' WHERE id=$1`,
      [executionId],
    );
    await eventually(
      async () =>
        (
          await blocker.query(
            `SELECT lease_until<=clock_timestamp() AS expired FROM ${table} WHERE id=$1`,
            [executionId],
          )
        ).rows[0].expired,
      3000,
    );
    await blocker.query('COMMIT');
    expect(await completion).toMatchObject({
      error: { code: 'P0001', message: 'REQUEST_IN_PROGRESS' },
    });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (completion) await completion;
  }
}

module.exports = { expiredLeaseWhileWaiting };
