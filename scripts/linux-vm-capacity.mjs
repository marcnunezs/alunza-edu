// Six controlled saturation waves. Not a throughput or latency acceptance run.
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { errorResponseSchema } from '@alunza/contracts';
import { canonicalHash } from '../tests/integration/linux-vm-api.mjs';
import {
  loadManifest,
  control,
  capacityPlan,
  racePlan,
  requireValue as check,
  UUID,
} from './linux-vm-browser-contract.mjs';

export function assessCapacityWave(plan, rows, before, after, release) {
  const admitted = rows.filter((r) => r.status === 201 && r.durable === true),
    busy = rows.filter(
      (r) =>
        r.status === 503 &&
        r.errorCode === 'RUNNER_BUSY' &&
        r.retryAfter === 1 &&
        r.zeroState === true,
    );
  const failures = [];
  if (
    rows.length !== plan.width ||
    admitted.length !== 1 ||
    busy.length !== plan.width - 1
  )
    failures.push('OFFER_COUNTS');
  if (
    rows.some(
      (r) => !Number.isFinite(r.durationMs) || r.durationMs < 0 || !r.complete,
    )
  )
    failures.push('INCOMPLETE_HTTP');
  if (rows.some((r) => r.failureCode)) failures.push('OFFER_VERIFICATION');
  if (
    new Set(rows.map((r) => r.actorId)).size !== plan.width ||
    new Set(rows.map((r) => r.key)).size !== plan.width
  )
    failures.push('OFFER_IDENTITY');
  if (new Set(rows.map((r) => r.api)).size !== 2)
    failures.push('TWO_API_REPLICAS');
  if (
    after.totals.qemuStarted - before.totals.qemuStarted !== 1 ||
    after.records.length - before.records.length !== 1 ||
    after.ledger?.total - before.ledger?.total !== 1
  )
    failures.push('EXTRA_RESOURCE');
  if (
    after.totals.active !== 0 ||
    after.totals.uncertain !== 0 ||
    after.ledger?.pending !== 0 ||
    after.records.some((r) => r.state !== 'CLOSED' || !r.cleanupVerified)
  )
    failures.push('RETIREMENT');
  if (
    plan.controlled !== false &&
    (release?.released !== true || release.automatic !== false)
  )
    failures.push('BARRIER_EXPIRED');
  if (plan.controlled !== false && release?.ddlCleaned !== true)
    failures.push('BARRIER_DDL_RETAINED');
  return {
    id: plan.id,
    controlled: plan.controlled !== false,
    width: plan.width,
    offered: rows.length,
    admitted: admitted.length,
    busy: busy.length,
    releaseReason: release?.releaseReason ?? null,
    releaseRequestedAfterMs: release?.releaseRequestedAfterMs ?? null,
    barrierDdlCleaned: release?.ddlCleaned ?? null,
    barrierCleanupFailureCode: release?.cleanupFailureCode ?? null,
    pass: failures.length === 0,
    failureCodes: failures,
  };
}
// Private payloads and credentials never become enumerable receipt properties.
// HTTP observation ends before any PostgreSQL/broker verification begins.
const deferredChecks = new WeakMap();
const safeFailure = (error, fallback) =>
  /^[A-Z_]{3,80}$/.test(error?.message ?? '') ? error.message : fallback;
export async function capacityHttpOffer(
  m,
  scope,
  a,
  mode,
  key,
  api,
  { fetchImpl = fetch, controlImpl = control } = {},
) {
  const f = a.fixtures[mode],
    start = performance.now();
  const row = {
    scope,
    actorId: a.id,
    mode,
    key,
    api,
    status: null,
    durationMs: 0,
    complete: false,
    retryAfter: null,
    requestId: null,
    errorCode: null,
    failureCode: null,
    zeroState: false,
    durable: false,
  };
  try {
    const r = await fetchImpl(
      `${api}/api/v1/activities/${f.activityId}/exercises/${f.assignmentId}/${mode === 'RUN' ? 'executions' : 'attempts'}`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${a.token}`,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({
          exerciseVersionId: f.exerciseVersionId,
          code: f.successCode,
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    row.status = r.status;
    row.retryAfter = r.headers.has('retry-after')
      ? Number(r.headers.get('retry-after'))
      : null;
    const text = await r.text();
    row.durationMs = performance.now() - start;
    row.complete = true;
    check(Buffer.byteLength(text) < 524288, 'CAPACITY_BODY_LIMIT');
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('CAPACITY_JSON_INVALID');
    }
    if (UUID.test(payload?.requestId ?? '')) row.requestId = payload.requestId;
    const error = errorResponseSchema.safeParse(payload);
    if (error.success) row.errorCode = error.data.error.code;
    if (r.status === 503) {
      check(
        error.success &&
          error.data.error.code === 'RUNNER_BUSY' &&
          error.data.error.retryable === true &&
          row.retryAfter === 1,
        'BUSY_RESPONSE',
      );
      deferredChecks.set(row, async () => {
        await controlImpl(m, 'absent', { scope, actorId: a.id, mode, key });
        row.zeroState = true;
      });
    } else if (r.status === 201) {
      deferredChecks.set(row, async () => {
        const proof = await controlImpl(m, 'verify', {
          scope,
          actorId: a.id,
          mode,
          key,
          status: r.status,
          payload,
          code: f.successCode,
          diagnosis: 'SUCCESS',
        });
        row.durable = true;
        row.executionId = proof.executionId;
        row.observationSha256 = proof.observationSha256;
      });
    } else row.failureCode = 'UNEXPECTED_HTTP_STATUS';
  } catch (error) {
    row.failureCode = safeFailure(error, 'CAPACITY_TRANSPORT_FAILED');
    if (!row.complete) row.durationMs = performance.now() - start;
  }
  return row;
}
export async function verifyCapacityOffer(row) {
  const verify = deferredChecks.get(row);
  deferredChecks.delete(row);
  if (!verify) return row;
  try {
    await verify();
  } catch (error) {
    row.failureCode = safeFailure(error, 'PRIVATE_OBSERVATION_FAILED');
  }
  return row;
}

export async function controlledCapacityBatch({
  first,
  waitBarrier,
  startOthers,
  releaseBarrier,
}) {
  let others = [],
    released,
    gateFailed = false,
    observedAt = null,
    timer,
    releaseReason = 'BARRIER_OBSERVATION_FAILED';
  try {
    await waitBarrier();
    observedAt = performance.now();
    others = startOthers();
    releaseReason = await Promise.race([
      Promise.all(others).then(() => 'OTHER_HTTP_COMPLETE'),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve('HTTP_WAIT_DEADLINE'),
          Math.max(0, 1200 - (performance.now() - observedAt)),
        );
      }),
    ]);
  } catch {
    gateFailed = true;
  } finally {
    clearTimeout(timer);
    const releaseRequestedAfterMs =
      observedAt === null ? null : performance.now() - observedAt;
    try {
      released = {
        ...(await releaseBarrier()),
        releaseReason,
        releaseRequestedAfterMs,
      };
    } catch {
      gateFailed = true;
      released = {
        released: false,
        automatic: null,
        releaseReason,
        releaseRequestedAfterMs,
      };
    }
  }
  // Replies can finish after the deliberate hold is released. The committed
  // PENDING host ledger must then maintain exclusion; all offers still count.
  return { batch: await Promise.all([first, ...others]), released, gateFailed };
}
export async function runCapacity(m) {
  await mkdir(m.outputDir, { recursive: false, mode: 0o700 });
  const scope = 'CAPACITY',
    context = await control(m, 'prepare', { scope }),
    plans = [
      ...capacityPlan().map((p) => ({ ...p, controlled: true })),
      ...racePlan().map((p) => ({ ...p, controlled: false })),
    ],
    rows = [],
    waves = [];
  const initial = await control(m, 'inspect');
  check(
    canonicalHash(initial.candidate) === canonicalHash(m.candidate) &&
      initial.totals.active === 0 &&
      initial.totals.uncertain === 0,
    'CAPACITY_INITIAL',
  );
  const actors = [];
  for (const actor of context.actors) {
    const session = await control(m, 'login', { scope, actorId: actor.id });
    check(session.user.id === actor.id, 'CAPACITY_AUTH');
    actors.push({ ...actor, token: session.access_token });
  }
  // Alternate organizations, then classes/actors; same-host exclusion cannot be
  // satisfied accidentally by the existing per-student or organization quota.
  const orgs = [...new Set(actors.map((a) => a.organizationId))];
  const ordered = Array.from({ length: 4 }, (_, i) =>
    orgs.map((org) => actors.filter((a) => a.organizationId === org)[i]),
  ).flat();
  await writeFile(
    join(m.outputDir, 'protocol.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        campaignId: m.campaignId,
        candidate: m.candidate,
        planned: plans,
        controlledOffered: 18,
        uncontrolledOffered: 6,
        expectedAdmissions: { controlled: 6, uncontrolled: 2 },
        maximumVms: 1,
        apiReplicas: [m.endpoints.api, m.endpoints.apiReplica],
        barrier: 'TEST_TRANSACTION_ADVISORY_LOCK_AFTER_HOST_GUARD',
        barrierHttpWaitMs: 1200,
        privateVerification: 'AFTER_BARRIER_RELEASE',
        durableExclusionAfterRelease: 'PENDING_HOST_LEDGER',
        excludedFromLatency: true,
        automaticRetry: false,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  let stoppedReason = null;
  try {
    for (const [index, plan] of plans.entries()) {
      const selected = plan.modes.map((mode, i) => ({
        a: ordered[(index + i) % 8],
        mode,
        key: randomUUID(),
        api: i % 2 ? m.endpoints.apiReplica : m.endpoints.api,
      }));
      const before = await control(m, 'inspect'),
        winner = selected[0];
      let batch;
      let released = null,
        gateFailed = false;
      if (plan.controlled) {
        await control(m, 'barrier-arm', {
          scope,
          actorId: winner.a.id,
          mode: winner.mode,
          key: winner.key,
        });
        const first = capacityHttpOffer(
          m,
          scope,
          winner.a,
          winner.mode,
          winner.key,
          winner.api,
        );
        ({ batch, released, gateFailed } = await controlledCapacityBatch({
          first,
          waitBarrier: () => control(m, 'barrier-wait'),
          startOthers: () =>
            selected
              .slice(1)
              .map((v) =>
                capacityHttpOffer(m, scope, v.a, v.mode, v.key, v.api),
              ),
          releaseBarrier: () => control(m, 'barrier-release'),
        }));
      } else {
        batch = await Promise.all(
          selected.map((v) =>
            capacityHttpOffer(m, scope, v.a, v.mode, v.key, v.api),
          ),
        );
      }
      // Private DB/broker checks cannot prolong the application transaction hold.
      await Promise.all(batch.map(verifyCapacityOffer));
      if (plan.controlled) {
        try {
          check(
            (await control(m, 'barrier-cleanup')).cleaned === true,
            'BARRIER_DDL_RETAINED',
          );
          released = {
            ...released,
            ddlCleaned: true,
            cleanupFailureCode: null,
          };
        } catch (error) {
          gateFailed = true;
          released = {
            ...released,
            ddlCleaned: false,
            cleanupFailureCode: safeFailure(
              error,
              'BARRIER_DDL_CLEANUP_FAILED',
            ),
          };
        }
      }
      batch.forEach(
        (r) => (r.profile = plan.controlled ? 'controlled' : 'uncontrolled'),
      );
      rows.push(...batch);
      await appendFile(
        join(m.outputDir, 'requests.jsonl'),
        batch.map((r) => JSON.stringify({ ...r, wave: plan.id })).join('\n') +
          '\n',
        { mode: 0o600 },
      );
      const after = await control(m, 'inspect'),
        assessment = assessCapacityWave(plan, batch, before, after, released);
      waves.push(assessment);
      if (gateFailed || !assessment.pass) {
        stoppedReason = 'CAPACITY_GATE_FAILED';
        break;
      }
    }
  } catch {
    stoppedReason = 'CAPACITY_OPERATION_FAILED';
  }
  const final = await control(m, 'inspect');
  const result = {
    schemaVersion: 1,
    scope: 'LOCAL_CAPACITY_REJECTION',
    campaignId: m.campaignId,
    candidate: m.candidate,
    waves,
    offered: rows.length,
    admitted: rows.filter((r) => r.durable).length,
    busy: rows.filter((r) => r.zeroState).length,
    initial,
    final,
    stoppedReason,
    excludedFromLatency: true,
    pass:
      stoppedReason === null &&
      waves.length === 8 &&
      waves.every((w) => w.pass) &&
      rows.length === 24 &&
      final.totals.qemuStarted - initial.totals.qemuStarted === 8 &&
      final.records.length - initial.records.length === 8 &&
      final.ledger.total - initial.ledger.total === 8 &&
      final.ledger.pending === 0 &&
      final.totals.active === 0 &&
      final.totals.uncertain === 0,
  };
  result.profiles = Object.fromEntries(
    ['controlled', 'uncontrolled'].map((profile) => {
      const sample = rows.filter((r) => r.profile === profile);
      return [
        profile,
        {
          offered: sample.length,
          admitted: sample.filter((r) => r.durable).length,
          busy: sample.filter((r) => r.zeroState).length,
        },
      ];
    }),
  );
  await writeFile(
    join(m.outputDir, 'summary.json'),
    JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600 },
  );
  if (result.pass) await control(m, 'close', { scope });
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    check(
      process.argv.length === 4 && process.argv[2] === '--manifest',
      'USAGE_MANIFEST',
    );
    const r = await runCapacity(await loadManifest(process.argv[3]));
    console.log(
      JSON.stringify({
        status: r.pass ? 'passed' : 'failed',
        offered: r.offered,
        admitted: r.admitted,
        busy: r.busy,
      }),
    );
    if (!r.pass) process.exitCode = 1;
  } catch {
    console.error(
      'PHYSICAL_CAPACITY_FAILED: inspect private sanitized receipts.',
    );
    process.exitCode = 1;
  }
}
