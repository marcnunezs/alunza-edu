import { randomUUID, createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  open,
  unlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');
export async function privateJson(
  path,
  value,
  { renameFile = rename, pause = delay } = {},
) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  const retryDelays = [25, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(temporary, path);
      return;
    } catch (error) {
      if (
        !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) ||
        attempt === retryDelays.length
      )
        throw error;
      // Windows readers/antivirus can hold a transient sharing lock. Retry only
      // this atomic replacement, never unlink the destination or replay product
      // actions. On final failure the original and temporary evidence survive.
      await pause(retryDelays[attempt]);
    }
  }
}
export class EvaluationError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
// Provider/transport messages can contain private content. Persist only codes
// emitted by this client, never arbitrary error messages or response bodies.
export const evaluationFailureCode = (error) =>
  error instanceof EvaluationError && /^[A-Z0-9_]{1,100}$/.test(error.code)
    ? error.code
    : 'EVALUATION_OPERATION_FAILED';
export class EvaluationJournal {
  constructor(path, value) {
    this.path = path;
    this.value = value;
    this.writes = Promise.resolve();
  }
  static async load(path, runId) {
    let value;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      value = { version: 1, runId, operations: {}, samples: [], stages: {} };
    }
    if (value.version !== 1 || value.runId !== runId)
      throw new EvaluationError('JOURNAL_RUN_MISMATCH');
    return new EvaluationJournal(path, value);
  }
  async lock() {
    await mkdir(dirname(this.path), { recursive: true });
    const path = `${this.path}.lock`;
    try {
      this.handle = await open(path, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Exclusive recovery guard prevents two resumers from unlinking a new
      // owner's lock after independently observing the same dead predecessor.
      const recoveryPath = `${path}.recovery`;
      const recovery = await open(recoveryPath, 'wx', 0o600);
      try {
        await recovery.writeFile(JSON.stringify({ pid: process.pid }));
        const previous = await readFile(path, 'utf8');
        const owner = JSON.parse(previous);
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
          throw new EvaluationError('JOURNAL_LOCK_INVALID');
        try {
          process.kill(owner.pid, 0);
          throw new EvaluationError('JOURNAL_IN_USE');
        } catch (running) {
          if (running.code !== 'ESRCH') throw running;
        }
        if ((await readFile(path, 'utf8')) !== previous)
          throw new EvaluationError('JOURNAL_LOCK_CHANGED');
        await unlink(path);
        this.handle = await open(path, 'wx', 0o600);
      } finally {
        await recovery.close();
        await unlink(recoveryPath);
      }
    }
    await this.handle.writeFile(
      JSON.stringify({ pid: process.pid, nonce: randomUUID() }),
    );
  }
  async close() {
    await this.writes;
    if (this.handle) {
      await this.handle.close();
      await unlink(`${this.path}.lock`);
      this.handle = null;
    }
  }
  async save() {
    this.writes = this.writes.then(() => privateJson(this.path, this.value));
    await this.writes;
  }
  async intent(name, payload) {
    const payloadHash = sha256(JSON.stringify(payload));
    const existing = this.value.operations[name];
    if (existing && existing.payloadHash !== payloadHash)
      throw new EvaluationError('JOURNAL_PAYLOAD_MISMATCH');
    if (!existing) {
      this.value.operations[name] = {
        key: randomUUID(),
        payloadHash,
        state: 'INTENT',
        createdAt: new Date().toISOString(),
      };
      await this.save();
    }
    return this.value.operations[name];
  }
}

// Only product sessions are read here. The maintenance connection is confined to
// authorize/prepare and is never passed to a run/resume process.
export class EvaluationSessions {
  constructor(path, value) {
    this.path = path;
    this.value = value;
    this.clients = new Map();
    this.renewals = new Map();
    this.writes = Promise.resolve();
  }
  static async load(path) {
    return new EvaluationSessions(
      path,
      JSON.parse(await readFile(path, 'utf8')),
    );
  }
  async token(actorId) {
    const session = this.value.actors[actorId];
    if (!session) throw new EvaluationError('SESSION_ACTOR_MISSING');
    let client = this.clients.get(actorId);
    if (!client) {
      client = createClient(this.value.authUrl, this.value.publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      this.clients.set(actorId, client);
    }
    if (session.expires_at * 1000 < Date.now() + 30_000) {
      let renewal = this.renewals.get(actorId);
      if (!renewal) {
        renewal = (async () => {
          const renewed = await client.auth.refreshSession({
            refresh_token: session.refresh_token,
          });
          if (renewed.error || renewed.data.session?.user.id !== actorId)
            throw new EvaluationError('SESSION_RENEWAL_FAILED');
          const replacement = {
            access_token: renewed.data.session.access_token,
            refresh_token: renewed.data.session.refresh_token,
            expires_at: renewed.data.session.expires_at,
          };
          // Build each vault snapshot inside the serialized write, after the
          // previous actor's durable update. Never return a rotated token before
          // its refresh token has been saved, or replace another actor's update.
          this.writes = this.writes.then(async () => {
            const next = {
              ...this.value,
              actors: { ...this.value.actors, [actorId]: replacement },
            };
            await privateJson(this.path, next);
            this.value = next;
          });
          await this.writes;
        })().finally(() => this.renewals.delete(actorId));
        this.renewals.set(actorId, renewal);
      }
      await renewal;
    }
    return this.value.actors[actorId].access_token;
  }
}
export class EvaluationClient {
  constructor({
    apiOrigin,
    operationsOrigin,
    runId,
    capability,
    sessions,
    journal,
  }) {
    Object.assign(this, {
      apiOrigin,
      operationsOrigin,
      runId,
      capability,
      sessions,
      journal,
    });
    this.httpRequests = 0;
  }
  async product(
    actorId,
    path,
    {
      method = 'GET',
      body,
      form,
      key,
      binary = false,
      expected = [200],
      revision,
    } = {},
  ) {
    this.httpRequests++;
    const response = await fetch(`${this.apiOrigin}/api/v1${path}`, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${await this.sessions.token(actorId)}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(revision ? { 'If-Match': `"${revision}"` } : {}),
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(45_000),
    });
    if (!expected.includes(response.status)) {
      const code =
        response.status === 429
          ? 'QUOTA_WAIT'
          : `PRODUCT_HTTP_${response.status}`;
      throw new EvaluationError(code, response.status);
    }
    if (response.status >= 400) return { status: response.status };
    if (!response.headers.get('cache-control')?.includes('no-store'))
      throw new EvaluationError('CACHE_POLICY_MISMATCH');
    if (binary) return new Uint8Array(await response.arrayBuffer());
    return (await response.json()).data;
  }
  async operations(path = '', body) {
    const response = await fetch(
      `${this.operationsOrigin}/operations/ai-runs/${this.runId}${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.capability}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new EvaluationError(
        `OPERATIONS_HTTP_${response.status}`,
        response.status,
      );
    return response.json();
  }
  async receipts() {
    const receipts = [];
    let cursor;
    do {
      const page = await this.operations(
        `/receipts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      receipts.push(...(page.items ?? page.data ?? []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return receipts;
  }
  async poll(check, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await delay(150);
    }
    throw new EvaluationError('POLL_DEADLINE');
  }
  async reviewContext(binding) {
    this.journal.value.reviewContexts ??= {};
    const previous = this.journal.value.reviewContexts[binding.attemptId];
    if (previous) return previous;
    const attempt = await this.product(
      binding.actorId,
      `/attempts/${binding.attemptId}`,
    );
    if (
      attempt.attemptId !== binding.attemptId ||
      attempt.activityId !== binding.activityId ||
      (binding.codeHash && sha256(attempt.code) !== binding.codeHash)
    )
      throw new EvaluationError('REVIEW_CONTEXT_MISMATCH');
    const exercise = await this.product(
      binding.actorId,
      `/activities/${attempt.activityId}/exercises/${attempt.assignmentId}`,
    );
    if (
      exercise.organizationId !== binding.organizationId ||
      exercise.classId !== binding.classId ||
      exercise.activityId !== binding.activityId ||
      exercise.exerciseVersionId !== attempt.exerciseVersionId
    )
      throw new EvaluationError('REVIEW_CONTEXT_MISMATCH');
    // This is a deliberately narrow student projection. Never copy entire
    // technical results, exercise objects, tokens, or private runner evidence.
    const context = {
      attemptId: attempt.attemptId,
      exerciseVersionId: attempt.exerciseVersionId,
      title: exercise.title,
      statement: exercise.statement,
      concepts: exercise.concepts.map(({ name, description }) => ({
        name,
        description,
      })),
      code: attempt.code,
      diagnosisCode: attempt.technicalResult.diagnosisCode,
      infrastructureStatus: attempt.technicalResult.infrastructureStatus,
      visibleTests: attempt.technicalResult.visibleTestResults.map(
        ({ id, passed }) => ({ id, passed }),
      ),
    };
    this.journal.value.reviewContexts[binding.attemptId] = context;
    return context;
  }
  async help(
    binding,
    kind,
    hintLevel,
    { profile, replay = false, outsiderId, captureReview = false } = {},
  ) {
    const body = { kind, ...(hintLevel ? { hintLevel } : {}) };
    const name = `help:${binding.id}:${kind}:${hintLevel ?? 0}`;
    const previousOperation = this.journal.value.operations[name];
    const op = await this.journal.intent(name, {
      attemptId: binding.attemptId,
      ...body,
    });
    if (op.state === 'DONE') return op.result;
    const observeFromStart =
      !previousOperation ||
      previousOperation.transport?.observation === 'NOT_STARTED';
    op.transport ??= {
      firstDispatchedAt: null,
      observation: 'NOT_STARTED',
      clientMs: null,
      attempts: [],
    };
    const transport = op.transport;
    if (transport.observation !== 'COMPLETE')
      transport.observation = observeFromStart ? 'OBSERVING' : 'INCOMPLETE';
    let start = performance.now();
    const admissionWaitStarted = start;
    if (!op.requestId) {
      for (;;) {
        const now = Date.now();
        const admissions = this.journal.value.admissions ?? [];
        const recent = admissions.filter((item) => item.at > now - 60_100);
        const actor = recent.filter((item) => item.actorId === binding.actorId);
        const org = recent.filter(
          (item) => item.organizationId === binding.organizationId,
        );
        if (actor.length < 6 && org.length < 60) {
          // Reserve locally before another concurrent lane checks the window.
          this.journal.value.admissions = [
            ...recent,
            {
              actorId: binding.actorId,
              organizationId: binding.organizationId,
              at: now,
            },
          ];
          await this.journal.save();
          break;
        }
        const first = Math.min(
          ...(actor.length >= 6 ? actor : org).map((item) => item.at),
        );
        await delay(Math.min(1000, Math.max(100, first + 60_100 - now)));
      }
    }
    let quotaWaitMs = Math.round(performance.now() - admissionWaitStarted);
    // INTENT and saved keys are reconciled through the authoritative API. Replays
    // consume no admission quota and cannot authorize a second paid dispatch.
    const dispatch = async (verificationReplay = false) => {
      const attempt = {
        sequence: transport.attempts.length + 1,
        purpose: verificationReplay ? 'REPLAY_CHECK' : 'ADMISSION',
        dispatchedAt: new Date().toISOString(),
        state: 'DISPATCHED',
        settledAt: null,
        httpStatus: null,
        errorCode: null,
      };
      transport.firstDispatchedAt ??= attempt.dispatchedAt;
      transport.attempts.push(attempt);
      await this.journal.save();
      if (!verificationReplay) start = performance.now();
      try {
        const accepted = await this.product(
          binding.actorId,
          `/attempts/${binding.attemptId}/feedback-requests`,
          { method: 'POST', body, key: op.key, expected: [202] },
        );
        attempt.state = 'RESPONSE';
        attempt.httpStatus = 202;
        attempt.settledAt = new Date().toISOString();
        await this.journal.save();
        return accepted;
      } catch (error) {
        attempt.state =
          error.code === 'QUOTA_WAIT' ? 'QUOTA_REJECTED' : 'UNCERTAIN';
        attempt.httpStatus =
          error instanceof EvaluationError && error.status > 0
            ? error.status
            : null;
        attempt.errorCode = evaluationFailureCode(error);
        attempt.settledAt = new Date().toISOString();
        if (error.code !== 'QUOTA_WAIT' && transport.observation !== 'COMPLETE')
          transport.observation = 'INCOMPLETE';
        await this.journal.save();
        throw error;
      }
    };
    let request;
    for (;;) {
      try {
        request = await dispatch();
        break;
      } catch (error) {
        if (error.code !== 'QUOTA_WAIT') throw error;
        if (performance.now() - admissionWaitStarted > 120_000)
          throw new EvaluationError('ADMISSION_QUOTA_DEADLINE');
        const status = await this.operations();
        if (status.state === 'STOPPED')
          throw new EvaluationError('RUN_STOPPED');
        await delay(1000);
        quotaWaitMs = Math.round(performance.now() - admissionWaitStarted);
      }
    }
    op.requestId = request.id;
    op.state = 'ADMITTED';
    await this.journal.save();
    let completed;
    let feedback;
    try {
      if (replay) {
        const same = await dispatch(true);
        if (same.id !== request.id)
          throw new EvaluationError('IDEMPOTENCY_MISMATCH');
      }
      completed = await this.poll(async () => {
        const result = await this.product(
          binding.actorId,
          `/feedback-requests/${request.id}`,
        );
        return ['SUCCEEDED', 'FAILED'].includes(result.state) ? result : null;
      });
      if (completed.feedbackId)
        feedback = await this.product(
          binding.actorId,
          `/feedback/${completed.feedbackId}`,
        );
    } catch (error) {
      if (transport.observation !== 'COMPLETE')
        transport.observation = 'INCOMPLETE';
      transport.observationError = evaluationFailureCode(error);
      await this.journal.save();
      throw error;
    }
    if (observeFromStart && transport.observation === 'OBSERVING') {
      transport.observation = 'COMPLETE';
      transport.clientMs = Math.round((performance.now() - start) * 100) / 100;
      transport.observedAt = new Date().toISOString();
    }
    const clientMs =
      transport.observation === 'COMPLETE' ? transport.clientMs : null;
    // The provider outcome is evidence even if a later ACK, citation check or
    // profile assertion fails. A transport replay updates this same sample.
    let result = this.journal.value.samples.find(
      (item) => item.requestId === request.id,
    );
    if (!result) {
      result = {
        requestId: request.id,
        feedbackId: completed.feedbackId,
        kind,
        hintLevel: hintLevel ?? null,
        status: feedback?.help.status ?? 'PROVIDER_UNAVAILABLE',
        diagnosis: feedback?.help.diagnosis_code ?? null,
        errorCode: completed.errorCode,
        admissionToPersistedMs: completed.completedAt
          ? Date.parse(completed.completedAt) - Date.parse(completed.createdAt)
          : null,
        clientMs,
        quotaWaitMs,
        profile: profile ?? 'functional',
        verificationComplete: false,
      };
      this.journal.value.samples.push(result);
    }
    result.clientMs = clientMs;
    result.firstDispatchedAt = transport.firstDispatchedAt;
    result.clientObservation = transport.observation;
    result.transportAttempts = transport.attempts.length;
    await this.journal.save();
    try {
      if (feedback) {
        const { ragHelpSchema } = await import('@alunza/contracts');
        const response = ragHelpSchema.parse(feedback.help);
        if (kind === 'FEEDBACK' && feedback.help.hint !== '')
          throw new EvaluationError('EXPLANATION_CONSUMED_HINT');
        let snapshot;
        if (captureReview) {
          snapshot = {
            corpusKind: 'FICTITIOUS_ADVERSARIAL',
            capturedAt: new Date().toISOString(),
            response,
            context: await this.reviewContext(binding),
            references: [],
          };
          this.journal.value.reviewSnapshots ??= {};
          this.journal.value.reviewSnapshots[feedback.id] = snapshot;
          await this.journal.save();
        }
        if (outsiderId)
          await this.product(outsiderId, `/feedback/${feedback.id}`, {
            expected: [403, 404],
          });
        if (replay || captureReview)
          for (const ref of feedback.help.source_refs) {
            const reference = await this.product(
              binding.actorId,
              `/feedback/${feedback.id}/sources/${ref.chunk_id}`,
            );
            if (
              reference.sourceId !== ref.source_id ||
              reference.chunkId !== ref.chunk_id ||
              reference.versionId !== ref.source_version_id ||
              reference.locator !== ref.locator
            )
              throw new EvaluationError('REFERENCE_MISMATCH');
            if (snapshot) {
              const { helpReferenceSchema } = await import('@alunza/contracts');
              snapshot.references.push(helpReferenceSchema.parse(reference));
              await this.journal.save();
            }
            if (!replay) continue;
            const file = await this.product(
              binding.actorId,
              `/feedback/${feedback.id}/sources/${ref.chunk_id}/content`,
              { binary: true },
            );
            if (!file.byteLength)
              throw new EvaluationError('EMPTY_CITATION_CONTENT');
            const expectedHash =
              this.journal.value.sourceHashes?.[ref.source_version_id];
            if (!expectedHash || sha256(file) !== expectedHash)
              throw new EvaluationError('CITATION_FILE_MISMATCH');
            if (outsiderId)
              await this.product(
                outsiderId,
                `/feedback/${feedback.id}/sources/${ref.chunk_id}/content`,
                { expected: [403, 404] },
              );
          }
        if (
          feedback.presentationToken &&
          (kind === 'FEEDBACK' || feedback.help.status === 'SUPPORTED')
        ) {
          const viewed = {
            method: 'POST',
            body: { presentationToken: feedback.presentationToken },
            expected: [200],
          };
          await this.product(
            binding.actorId,
            `/feedback/${feedback.id}/viewed`,
            viewed,
          );
          if (replay)
            await this.product(
              binding.actorId,
              `/feedback/${feedback.id}/viewed`,
              viewed,
            );
        }
      }
    } catch (error) {
      result.verificationErrors ??= [];
      result.verificationErrors.push({
        code: evaluationFailureCode(error),
        at: new Date().toISOString(),
      });
      await this.journal.save();
      throw error;
    }
    result.verificationComplete = true;
    op.state = 'DONE';
    op.result = result;
    await this.journal.save();
    return result;
  }
}
