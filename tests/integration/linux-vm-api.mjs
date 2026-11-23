// Explicit laboratory campaign. Importing this module never starts services,
// logs in, sends requests, installs fixtures or executes a VM.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  attemptResponseSchema,
  errorResponseSchema,
  runExecutionResponseSchema,
} from '@alunza/contracts';
import {
  assertLocalApiUrl,
  describeDurations,
  loginCanonicalActors,
} from './docker-runtime-api.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MODES = ['RUN', 'SUBMIT'];
const LIMIT = 512 * 1024;
const IMAGE =
  'sha256:1f12d0fb7fb18f6e2668669b3b5da37be47fcc71120f7579dbe32155ad5846b0';
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const sha = (value) => createHash('sha256').update(value).digest('hex');
const finite = (value, max = 120000) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;
const exact = (value, fields) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((key) => key in value);

export function canonicalHash(value) {
  const canonical = (item) => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, canonical(item[key])]),
      );
    return item;
  };
  return sha(JSON.stringify(canonical(value)));
}

/** Auth remains real; the canonical seed is retained alongside new fixtures. */
export async function loginLinuxVmActors(state, fixturesByActor) {
  const actors = await loginCanonicalActors(state);
  return actors.map(({ fixture: _canonicalFixture, ...actor }) => ({
    ...actor,
    fixtures: fixturesByActor[actor.id],
  }));
}

export function validateLinuxVmActors(actors) {
  assert(
    Array.isArray(actors) &&
      actors.length === 8 &&
      new Set(actors.map((a) => a.id)).size === 8,
    'EIGHT_ACTORS_REQUIRED',
  );
  for (const actor of actors) {
    assert(
      [actor.id, actor.organizationId, actor.classId].every((v) =>
        UUID.test(v),
      ) &&
        typeof actor.token === 'string' &&
        actor.token.length > 20,
      'REAL_AUTH_ACTOR_REQUIRED',
    );
    for (const mode of MODES) {
      const f = actor.fixtures?.[mode];
      assert(
        f &&
          [f.activityId, f.assignmentId, f.exerciseVersionId].every((v) =>
            UUID.test(v),
          ) &&
          HASH.test(f.testsVersion) &&
          typeof f.successCode === 'string' &&
          typeof f.incorrectCode === 'string' &&
          f.successCode !== f.incorrectCode &&
          Array.isArray(f.visibleTestIds) &&
          Array.isArray(f.hiddenTestIds) &&
          [...f.visibleTestIds, ...f.hiddenTestIds].every(
            (id) => typeof id === 'string' && id.length > 0 && id.length <= 100,
          ) &&
          new Set([...f.visibleTestIds, ...f.hiddenTestIds]).size === 8 &&
          f.visibleTestIds.length + f.hiddenTestIds.length === 8 &&
          f.visibleTestIds.length > 0 &&
          (mode === 'RUN'
            ? f.visibleTestIds.length === 8 && f.hiddenTestIds.length === 0
            : f.hiddenTestIds.length > 0),
        'EIGHT_CASE_FIXTURE_REQUIRED',
      );
      assert(
        Array.isArray(f.hiddenMarkers) &&
          f.hiddenMarkers.every(
            (v) => typeof v === 'string' && v.length >= 16 && v.length <= 128,
          ) &&
          (mode === 'RUN' ||
            (f.hiddenMarkers.length > 0 &&
              typeof f.hiddenProbeCode === 'string')),
        'HIDDEN_PROBE_REQUIRED',
      );
    }
  }
  const organizations = new Set(actors.map((a) => a.organizationId));
  assert(
    organizations.size === 2 &&
      [...organizations].every(
        (id) => actors.filter((a) => a.organizationId === id).length === 4,
      ) &&
      actors.some((a) =>
        actors.some(
          (b) =>
            a.organizationId === b.organizationId && a.classId !== b.classId,
        ),
      ),
    'ISOLATION_FIXTURES_REQUIRED',
  );
}

export function validateCandidate(candidate) {
  assert(
    exact(candidate, [
      'runnerVersion',
      'capsuleImageId',
      'runnerSourceDigest',
      'kitManifestSha256',
      'guestSha256',
      'apiSourceDigest',
      'brokerSha256',
    ]) &&
      candidate.runnerVersion === 'imp-03-quickjs.13' &&
      candidate.capsuleImageId === IMAGE &&
      candidate.runnerSourceDigest ===
        '4782224f79163235b3f554b140b2ca40750b51b42dc61695964f7fca3f788fa3' &&
      [
        'kitManifestSha256',
        'guestSha256',
        'apiSourceDigest',
        'brokerSha256',
      ].every((key) => HASH.test(candidate[key])),
    'CANDIDATE_PINS_REQUIRED',
  );
}

export function validateInspection(observed, candidate) {
  assert(
    exact(observed, [
      'provider',
      'candidate',
      'applicationRole',
      'vmCreationsTotal',
      'creationRecordsTotal',
      'activeVms',
      'cleanupUncertain',
    ]) &&
      observed.provider === 'local-vm' &&
      canonicalHash(observed.candidate) === canonicalHash(candidate) &&
      exact(observed.applicationRole, ['name', 'superuser', 'bypassRls']) &&
      observed.applicationRole.name === 'alunza_app' &&
      observed.applicationRole.superuser === false &&
      observed.applicationRole.bypassRls === false &&
      Number.isSafeInteger(observed.vmCreationsTotal) &&
      observed.vmCreationsTotal >= 0 &&
      Number.isSafeInteger(observed.creationRecordsTotal) &&
      observed.creationRecordsTotal >= observed.vmCreationsTotal &&
      observed.activeVms === 0 &&
      observed.cleanupUncertain === false,
    'INSPECTION_OR_RETIREMENT_FAILED',
  );
  return observed;
}

/** Only allowlisted metadata leaves DB/broker observers; never SQL or bodies. */
export function validateObservation(value, candidate) {
  assert(
    exact(value, [
      'executionId',
      'attemptId',
      'completed',
      'resultDurable',
      'attemptCount',
      'technicalResultSha256',
      'codeSha256',
      'testsVersion',
      'visibleTestCount',
      'hiddenTestCount',
      'privateTestCount',
      'vmCreations',
    ]),
    'PRIVATE_OBSERVER_FIELD',
  );
  for (const key of ['executionId', 'attemptId'])
    assert(value[key] === null || UUID.test(value[key]), 'OBSERVER_IDENTITY');
  for (const key of ['technicalResultSha256', 'codeSha256', 'testsVersion'])
    assert(value[key] === null || HASH.test(value[key]), 'OBSERVER_HASH');
  assert(
    typeof value.completed === 'boolean' &&
      typeof value.resultDurable === 'boolean' &&
      [
        'attemptCount',
        'visibleTestCount',
        'hiddenTestCount',
        'privateTestCount',
      ].every(
        (key) =>
          Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 8,
      ) &&
      Array.isArray(value.vmCreations) &&
      value.vmCreations.length <= 1,
    'OBSERVER_COUNTS',
  );
  for (const vm of value.vmCreations) {
    assert(
      exact(vm, [
        'creationId',
        'bootId',
        'executionId',
        'kitManifestSha256',
        'guestSha256',
        'runnerVersion',
        'capsuleImageId',
        'cleanupVerified',
        'receiptSha256',
      ]) &&
        [vm.creationId, vm.bootId, vm.executionId].every((id) =>
          UUID.test(id),
        ) &&
        vm.creationId !== vm.bootId &&
        vm.executionId === value.executionId &&
        [
          'kitManifestSha256',
          'guestSha256',
          'runnerVersion',
          'capsuleImageId',
        ].every((key) => vm[key] === candidate[key]) &&
        typeof vm.cleanupVerified === 'boolean' &&
        (vm.receiptSha256 === null || HASH.test(vm.receiptSha256)),
      'VM_IDENTITY',
    );
  }
  if (value.executionId === null)
    assert(
      value.attemptId === null &&
        value.attemptCount === 0 &&
        !value.completed &&
        !value.resultDurable &&
        value.vmCreations.length === 0 &&
        value.technicalResultSha256 === null,
      'ABSENT_ADMISSION_INVENTS_RESULT',
    );
  return value;
}

export function assertDurable(observation, data, actor, mode, code, candidate) {
  validateObservation(observation, candidate);
  const fixture = actor.fixtures[mode],
    success = data.technicalResult.diagnosisCode === 'SUCCESS';
  assert(
    observation.executionId === data.executionId &&
      observation.attemptId === (data.attemptId ?? null) &&
      observation.completed &&
      observation.resultDurable &&
      observation.attemptCount === (mode === 'SUBMIT' ? 1 : 0) &&
      observation.technicalResultSha256 ===
        canonicalHash(data.technicalResult) &&
      observation.codeSha256 === sha(code) &&
      observation.testsVersion === fixture.testsVersion &&
      observation.visibleTestCount === fixture.visibleTestIds.length &&
      observation.hiddenTestCount === fixture.hiddenTestIds.length &&
      (mode !== 'SUBMIT' ||
        !success ||
        observation.privateTestCount === fixture.hiddenTestIds.length) &&
      observation.vmCreations.length === 1 &&
      observation.vmCreations[0].cleanupVerified &&
      HASH.test(observation.vmCreations[0].receiptSha256),
    'DURABLE_RESULT_MISMATCH',
  );
  return observation;
}

export function validateHttpPayload(
  payload,
  {
    actor,
    fixture,
    mode,
    code,
    expectedStatus = 201,
    status,
    expectedDiagnosis = 'SUCCESS',
    expectedInfrastructure = 'OK',
    expectedError,
    expectedDataHash,
  },
) {
  const parsed = (
    status >= 200 && status < 300
      ? mode === 'RUN'
        ? runExecutionResponseSchema
        : attemptResponseSchema
      : errorResponseSchema
  ).safeParse(payload);
  const failures = [];
  if (status !== expectedStatus) failures.push('HTTP_STATUS');
  if (!parsed.success)
    return {
      failures: [...failures, 'PUBLIC_SCHEMA'],
      data: null,
      requestId: null,
    };
  if (status >= 200 && status < 300) {
    const data = parsed.data.data,
      result = data.technicalResult;
    if (
      data.exerciseVersionId !== fixture.exerciseVersionId ||
      result.runnerVersion !== 'imp-03-quickjs.13' ||
      result.visibleTotal !== fixture.visibleTestIds.length ||
      result.visibleTestResults.some(
        (t) => !fixture.visibleTestIds.includes(t.id),
      )
    )
      failures.push('FIXTURE_IDENTITY');
    if (
      result.diagnosisCode !== expectedDiagnosis ||
      result.infrastructureStatus !== expectedInfrastructure ||
      result.runtimeMs > 3000
    )
      failures.push('TECHNICAL_RESULT');
    if (
      mode === 'SUBMIT' &&
      (data.code !== code ||
        data.testsVersion !== fixture.testsVersion ||
        data.activityId !== fixture.activityId ||
        data.assignmentId !== fixture.assignmentId ||
        (expectedDiagnosis === 'SUCCESS' && result.hiddenChecksPassed !== true))
    )
      failures.push('ATTEMPT_IDENTITY');
    if (expectedDataHash && canonicalHash(data) !== expectedDataHash)
      failures.push('REPLAY_DIFFERENCE');
    const projection = JSON.stringify({ ...data, code: undefined });
    if (
      [...fixture.hiddenTestIds, ...fixture.hiddenMarkers, actor.token].some(
        (marker) => projection.includes(marker),
      )
    )
      failures.push('PRIVATE_DISCLOSURE');
    return { failures, data, requestId: parsed.data.requestId };
  }
  if (expectedError && parsed.data.error.code !== expectedError)
    failures.push('ERROR_CODE');
  const errorProjection = JSON.stringify(parsed.data);
  if (
    [...fixture.hiddenTestIds, ...fixture.hiddenMarkers, actor.token].some(
      (marker) => errorProjection.includes(marker),
    )
  )
    failures.push('PRIVATE_DISCLOSURE');
  return { failures, data: null, requestId: parsed.data.requestId };
}

/** Includes all outcomes; incomplete campaigns never yield a passing percentile. */
export function summarizeLinuxVmSamples(rows) {
  return Object.fromEntries(
    MODES.map((mode) => {
      const samples = rows.filter(
        (row) => row.profile === 'normal' && row.mode === mode,
      );
      const complete =
        samples.length === 20 && samples.every((row) => finite(row.durationMs));
      const stats = describeDurations(samples.map((row) => row.durationMs));
      return [
        mode,
        {
          ...stats,
          p95Ms: complete ? stats.p95Ms : null,
          planned: 20,
          complete,
          failures: samples.filter((row) => !row.pass).length,
          strictTargetMet:
            complete && samples.every((row) => row.pass) && stats.p95Ms < 5000,
        },
      ];
    }),
  );
}

/** Operator hooks use real SQL and private broker observations; never pass flags. */
export async function runLinuxVmApiCampaign({
  baseUrl,
  actors,
  candidate,
  outputDir,
  inspect,
  observe,
  faults,
  variant = 'baseline',
}) {
  const origin = assertLocalApiUrl(baseUrl);
  validateLinuxVmActors(actors);
  validateCandidate(candidate);
  assert(
    ['baseline', 'resident-sealed-bases'].includes(variant) &&
      typeof inspect === 'function' &&
      typeof observe === 'function' &&
      ['armCommitFault', 'reconcile', 'waitForAdmission'].every(
        (key) => typeof faults?.[key] === 'function',
      ),
    'REAL_OPERATOR_HOOKS_REQUIRED',
  );
  const initial = validateInspection(await inspect(), candidate);
  await mkdir(outputDir, { recursive: false });
  const plan = Array.from({ length: 20 }, (_, round) =>
    MODES.map((mode, offset) => ({
      id: `${mode.toLowerCase()}-${round + 1}`,
      mode,
      actorId: actors[(round * 2 + offset) % 8].id,
    })),
  ).flat();
  const protocol = {
    schemaVersion: 1,
    candidate,
    variant,
    plannedNormal: plan,
    fixtures: actors.flatMap((actor) =>
      MODES.map((mode) => {
        const fixture = actor.fixtures[mode];
        return {
          actorId: actor.id,
          organizationId: actor.organizationId,
          classId: actor.classId,
          mode,
          activityId: fixture.activityId,
          assignmentId: fixture.assignmentId,
          exerciseVersionId: fixture.exerciseVersionId,
          testsVersion: fixture.testsVersion,
          visibleCases: fixture.visibleTestIds.length,
          hiddenCases: fixture.hiddenTestIds.length,
          successCodeSha256: sha(fixture.successCode),
        };
      }),
    ),
    targetMs: 5000,
    concurrency: 1,
    maximumVms: 1,
    actorRequestsPerMinute: 10,
    timeoutMs: 45000,
    clock: 'CLIENT_PERFORMANCE_NOW_FETCH_DISPATCH_THROUGH_FINAL_BODY_BYTE',
    authentication:
      'Real Auth login before campaign; JWT/session and authorization checks inside each measured API request.',
    startup:
      'API/broker startup reported separately; functional gates precede normal samples, so API is warm; every normal sample retained; no host page-cache flush claim.',
    exclusions: [],
    startedAt: new Date().toISOString(),
  };
  const protocolRaw = JSON.stringify(protocol, null, 2) + '\n';
  await writeFile(join(outputDir, 'protocol.json'), protocolRaw, {
    flag: 'wx',
  });
  const log = await open(join(outputDir, 'requests.jsonl'), 'wx');
  const rows = [],
    gates = [],
    observations = [],
    seenVms = new Map();
  const histories = new Map(actors.map((actor) => [actor.id, []]));
  let sequence = 0,
    stoppedReason = null,
    lastInspection = initial;
  const read = async (actor, mode, key) =>
    validateObservation(
      await observe({ actorId: actor.id, mode, key }),
      candidate,
    );
  const audit = async () => {
    lastInspection = validateInspection(await inspect(), candidate);
    return lastInspection;
  };
  async function quota(actor) {
    const before = performance.now(),
      history = histories.get(actor.id);
    while (true) {
      const now = performance.now();
      while (history.length && history[0] <= now - 60000) history.shift();
      if (history.length < 10) {
        history.push(now);
        return performance.now() - before;
      }
      await sleep(Math.max(1, history[0] + 60050 - now));
    }
  }
  async function request({
    actor,
    mode,
    label,
    profile = 'functional',
    key = randomUUID(),
    fixture = actor.fixtures[mode],
    code = fixture.successCode,
    method = 'POST',
    path,
    token = actor.token,
    expectedStatus = 201,
    expectedDiagnosis = 'SUCCESS',
    expectedInfrastructure = 'OK',
    expectedError,
    expectedDataHash,
    signal,
    expectAbort = false,
  }) {
    const clientQuotaWaitMs = method === 'POST' ? await quota(actor) : 0;
    const route =
      path ??
      `/api/v1/activities/${fixture.activityId}/exercises/${fixture.assignmentId}/${mode === 'RUN' ? 'executions' : 'attempts'}`;
    const body =
      method === 'POST'
        ? JSON.stringify({ code, exerciseVersionId: fixture.exerciseVersionId })
        : undefined;
    const row = {
      sequence: ++sequence,
      profile,
      label,
      mode,
      actorId: actor.id,
      requestKey: key,
      requestPayloadSha256: body ? sha(body) : null,
      clientQuotaWaitMs,
      httpStartedAt: new Date().toISOString(),
      status: null,
      bytes: 0,
      responseComplete: false,
      requestId: null,
      executionId: null,
      attemptId: null,
      responseSha256: null,
      dataSha256: null,
      runtimeMs: null,
      failureCodes: [],
    };
    let data = null,
      finished;
    const started = performance.now();
    try {
      const response = await fetch(origin + route, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body
            ? { 'Content-Type': 'application/json', 'Idempotency-Key': key }
            : {}),
        },
        ...(body ? { body } : {}),
        redirect: 'manual',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
          : AbortSignal.timeout(45000),
      });
      row.status = response.status;
      const chunks = [];
      for await (const chunk of response.body) {
        row.bytes += chunk.length;
        if (row.bytes > LIMIT) throw new Error('RESPONSE_LIMIT');
        chunks.push(chunk);
      }
      finished = performance.now();
      row.httpFinishedAt = new Date().toISOString();
      row.responseComplete = true;
      const buffer = Buffer.concat(chunks);
      row.responseSha256 = sha(buffer);
      if (!response.headers.get('cache-control')?.includes('no-store'))
        row.failureCodes.push('CACHE_CONTROL');
      const validated = validateHttpPayload(
        JSON.parse(buffer.toString('utf8')),
        {
          actor,
          fixture,
          mode,
          code,
          expectedStatus,
          status: row.status,
          expectedDiagnosis,
          expectedInfrastructure,
          expectedError,
          expectedDataHash,
        },
      );
      data = validated.data;
      row.requestId = validated.requestId;
      row.failureCodes.push(...validated.failures);
      if (data)
        Object.assign(row, {
          executionId: data.executionId,
          attemptId: data.attemptId ?? null,
          dataSha256: canonicalHash(data),
          runtimeMs: data.technicalResult.runtimeMs,
        });
      if (expectAbort) row.failureCodes.push('DISCONNECT_TOO_LATE');
    } catch (error) {
      const expectedDisconnect =
        expectAbort &&
        signal?.aborted &&
        ['AbortError', 'TimeoutError'].includes(error?.name);
      if (!expectedDisconnect)
        row.failureCodes.push(
          error?.message === 'RESPONSE_LIMIT'
            ? 'RESPONSE_LIMIT'
            : error?.name === 'TimeoutError'
              ? 'HTTP_TIMEOUT'
              : 'TRANSPORT_OR_JSON_FAILURE',
        );
      row.transportAborted = expectedDisconnect;
    } finally {
      row.durationMs = (finished ?? performance.now()) - started;
      row.httpFinishedAt ??= new Date().toISOString();
    }
    return { row, data, key, actor, mode, code };
  }
  async function retain(result) {
    result.row.pass = result.row.failureCodes.length === 0;
    rows.push(result.row);
    await log.write(JSON.stringify(result.row) + '\n');
    await log.sync();
    return result;
  }
  async function durable(result) {
    assert(
      result.data && result.row.failureCodes.length === 0,
      'HTTP_GATE_FAILED',
    );
    const observed = assertDurable(
      await read(result.actor, result.mode, result.key),
      result.data,
      result.actor,
      result.mode,
      result.code,
      candidate,
    );
    const vm = observed.vmCreations[0];
    for (const id of [vm.creationId, vm.bootId]) {
      assert(
        !seenVms.has(id) || seenVms.get(id) === observed.executionId,
        'VM_REUSED',
      );
      seenVms.set(id, observed.executionId);
    }
    observations.push({
      sequence: result.row.sequence,
      mode: result.mode,
      key: result.key,
      ...observed,
    });
    return observed;
  }
  function assertCreationDelta(before, after, count) {
    assert(
      after.vmCreationsTotal === before.vmCreationsTotal + count &&
        after.creationRecordsTotal === before.creationRecordsTotal + count,
      'UNEXPECTED_VM_CREATION',
    );
  }
  async function successful({ expectedCreations = 1, ...options }) {
    const before = await audit();
    const result = await request(options);
    try {
      await durable(result);
      assertCreationDelta(before, await audit(), expectedCreations);
    } catch {
      result.row.failureCodes.push('DURABILITY_GATE');
    }
    await retain(result);
    assert(result.row.pass, 'HTTP_OR_DURABILITY_GATE_FAILED');
    return result;
  }
  async function noNewVm(action) {
    const before = await audit();
    await action();
    const after = await audit();
    assertCreationDelta(before, after, 0);
  }
  async function recovered(actor, mode, key) {
    const deadline = performance.now() + 60000;
    while (performance.now() < deadline) {
      const value = await read(actor, mode, key);
      if (
        value.completed &&
        value.resultDurable &&
        value.vmCreations.length === 1 &&
        value.vmCreations[0].cleanupVerified
      )
        return value;
      await sleep(200);
    }
    throw new Error('RECOVERY_OBSERVATION_TIMEOUT');
  }
  async function gate(name, action) {
    try {
      await action();
      gates.push({ name, pass: true });
    } catch {
      gates.push({ name, pass: false });
      throw new Error('FUNCTIONAL_GATE_FAILED');
    }
  }
  try {
    for (const mode of MODES) {
      const actor = actors[mode === 'RUN' ? 0 : 1];
      await gate(`${mode}-replay-conflict`, async () => {
        const first = await successful({ actor, mode, label: 'first' });
        await audit();
        await noNewVm(async () => {
          await successful({
            actor,
            mode,
            label: 'replay',
            expectedCreations: 0,
            key: first.key,
            expectedDataHash: first.row.dataSha256,
          });
          const conflict = await retain(
            await request({
              actor,
              mode,
              label: 'conflict',
              key: first.key,
              code: actor.fixtures[mode].incorrectCode,
              expectedStatus: 409,
              expectedError: 'IDEMPOTENCY_CONFLICT',
            }),
          );
          assert(conflict.row.pass, 'CONFLICT_GATE');
          assertDurable(
            await read(actor, mode, first.key),
            first.data,
            actor,
            mode,
            first.code,
            candidate,
          );
        });
        if (mode === 'SUBMIT') {
          await noNewVm(async () => {
            const get = await retain(
              await request({
                actor,
                mode,
                label: 'read-attempt',
                method: 'GET',
                path: `/api/v1/attempts/${first.data.attemptId}`,
                expectedStatus: 200,
                expectedDataHash: first.row.dataSha256,
              }),
            );
            assert(get.row.pass, 'ATTEMPT_READ_GATE');
            const outsider = actors.find(
              (other) => other.organizationId !== actor.organizationId,
            );
            const denied = await retain(
              await request({
                actor: outsider,
                mode,
                label: 'read-other-attempt',
                method: 'GET',
                path: `/api/v1/attempts/${first.data.attemptId}`,
                expectedStatus: 404,
                expectedError: 'RESOURCE_NOT_FOUND',
              }),
            );
            assert(denied.row.pass, 'ATTEMPT_ISOLATION_GATE');
          });
        }
      });
      await gate(`${mode}-permissions`, async () => {
        const same = actors.find((a) =>
          actors.some(
            (b) =>
              a.organizationId === b.organizationId && a.classId !== b.classId,
          ),
        );
        for (const other of [
          actors.find(
            (b) =>
              same.organizationId === b.organizationId &&
              same.classId !== b.classId,
          ),
          actors.find((b) => same.organizationId !== b.organizationId),
        ]) {
          await noNewVm(async () => {
            const denied = await retain(
              await request({
                actor: same,
                mode,
                label: 'scope-denied',
                fixture: other.fixtures[mode],
                expectedStatus: 404,
                expectedError: 'RESOURCE_NOT_FOUND',
              }),
            );
            assert(
              denied.row.pass &&
                (await read(same, mode, denied.key)).executionId === null,
              'PERMISSION_ADMITTED',
            );
          });
        }
        await noNewVm(async () => {
          const denied = await retain(
            await request({
              actor,
              mode,
              label: 'auth-required',
              token: '',
              expectedStatus: 401,
            }),
          );
          assert(
            denied.row.pass &&
              (await read(actor, mode, denied.key)).executionId === null,
            'UNAUTHENTICATED_ADMISSION',
          );
        });
      });
      await gate(`${mode}-commit-recovery`, async () => {
        const key = randomUUID(),
          code = 'module.exports.solve=()=>{while(true){}};';
        const before = await audit();
        const fault = await faults.armCommitFault({
          actorId: actor.id,
          mode,
          key,
        });
        assert(typeof fault?.restore === 'function', 'FAULT_RESTORE_REQUIRED');
        let pending;
        try {
          const failed = await retain(
            await request({
              actor,
              mode,
              key,
              code,
              label: 'commit-failed',
              expectedStatus: 503,
              expectedError: 'PERSISTENCE_UNAVAILABLE',
            }),
          );
          pending = await read(actor, mode, key);
          assert(
            failed.row.pass &&
              pending.executionId &&
              !pending.completed &&
              pending.attemptCount === 0 &&
              pending.vmCreations.length === 1,
            'ROLLBACK_NOT_OBSERVED',
          );
        } finally {
          await fault.restore();
        }
        await faults.reconcile({ actorId: actor.id, mode, key });
        const restored = await recovered(actor, mode, key);
        assert(
          restored.executionId === pending.executionId &&
            restored.vmCreations[0].creationId ===
              pending.vmCreations[0].creationId,
          'RECOVERY_REEXECUTED',
        );
        await successful({
          actor,
          mode,
          key,
          code,
          label: 'commit-recovered',
          expectedCreations: 0,
          expectedDiagnosis: mode === 'RUN' ? 'UNKNOWN' : 'TIMEOUT',
          expectedInfrastructure: mode === 'RUN' ? 'FAILED' : 'OK',
        });
        assertCreationDelta(before, await audit(), 1);
      });
      await gate(`${mode}-disconnect-recovery`, async () => {
        const key = randomUUID(),
          before = await audit(),
          controller = new AbortController();
        const pending = request({
          actor,
          mode,
          key,
          label: 'disconnect',
          signal: controller.signal,
          expectAbort: true,
        });
        let admitted,
          admissionFailure = false;
        try {
          admitted = await faults.waitForAdmission({
            actorId: actor.id,
            mode,
            key,
            signal: AbortSignal.timeout(15000),
          });
          assert(
            exact(admitted, ['executionId', 'creationId', 'bootId']) &&
              Object.values(admitted).every((id) => UUID.test(id)),
            'ADMISSION_OBSERVATION_REQUIRED',
          );
        } catch {
          admissionFailure = true;
        } finally {
          controller.abort();
        }
        const disconnected = await retain(await pending);
        assert(!admissionFailure, 'ADMISSION_OBSERVATION_REQUIRED');
        assert(
          disconnected.row.pass &&
            disconnected.row.transportAborted &&
            !disconnected.row.responseComplete,
          'DISCONNECT_NOT_OBSERVED',
        );
        const restored = await recovered(actor, mode, key);
        assert(
          restored.executionId === admitted.executionId &&
            restored.vmCreations[0].creationId === admitted.creationId &&
            restored.vmCreations[0].bootId === admitted.bootId,
          'DISCONNECT_REEXECUTED',
        );
        await successful({
          actor,
          mode,
          key,
          label: 'disconnect-recovered',
          expectedCreations: 0,
        });
        assertCreationDelta(before, await audit(), 1);
      });
    }
    await gate('SUBMIT-hidden-projection', async () => {
      const actor = actors[2];
      await successful({
        actor,
        mode: 'SUBMIT',
        label: 'hidden-projection',
        code: actor.fixtures.SUBMIT.hiddenProbeCode,
      });
      await audit();
    });
    for (const planned of plan) {
      const actor = actors.find((a) => a.id === planned.actorId),
        before = await audit();
      const result = await request({
        actor,
        mode: planned.mode,
        profile: 'normal',
        label: planned.id,
      });
      try {
        await durable(result);
        assertCreationDelta(before, await audit(), 1);
      } catch {
        result.row.failureCodes.push('DURABILITY_OR_VM_GATE');
      }
      await retain(result);
      await audit(); // Uncertain retirement stops further creation; slow failures remain.
    }
  } catch (error) {
    stoppedReason = [
      'FUNCTIONAL_GATE_FAILED',
      'INSPECTION_OR_RETIREMENT_FAILED',
    ].includes(error?.message)
      ? error.message
      : 'CAMPAIGN_OR_OBSERVER_FAILED';
  } finally {
    await log.close();
  }
  let final = null;
  try {
    final = await audit();
  } catch {
    stoppedReason ??= 'FINAL_RETIREMENT_UNCERTAIN';
  }
  const latency = summarizeLinuxVmSamples(rows),
    functionalPassed = gates.length === 9 && gates.every((g) => g.pass);
  const summary = {
    schemaVersion: 1,
    protocolSha256: sha(protocolRaw),
    candidate,
    variant,
    functionalGates: gates,
    functionalPassed,
    latency,
    stoppedReason,
    requestsRetained: rows.length,
    normalSamples: rows.filter((r) => r.profile === 'normal').length,
    initialInspection: initial,
    finalInspection: final,
    durableObservations: observations,
    pass:
      !stoppedReason &&
      functionalPassed &&
      MODES.every((mode) => latency[mode].strictTargetMet),
    scope: 'LOCAL_PHYSICAL_HTTP_AUTH_POSTGRES_ONE_FRESH_VM_PER_NEW_EXECUTION',
    remoteOrBrowserAcceptance: false,
    hardRealtimeAcceptance: false,
  };
  await writeFile(
    join(outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
    { flag: 'wx' },
  );
  return summary;
}
