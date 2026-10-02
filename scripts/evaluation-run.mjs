import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  EvaluationClient,
  EvaluationJournal,
  EvaluationSessions,
  EvaluationError,
  evaluationFailureCode,
  privateJson,
  sha256,
} from './evaluation-client.mjs';
import { rubric } from '../fixtures/ai/help-adversarial-manifest.mjs';

export async function waitForCalibration({ client, journal }) {
  return client.poll(async () => {
    const current = await client.operations();
    const observation = {
      state: current.state,
      cases: (current.cases ?? [])
        .filter((item) => item.stage === 'CALIBRATION')
        .map(({ caseId, state }) => ({ caseId, state })),
    };
    if (
      JSON.stringify(journal.value.calibrationObservation) !==
      JSON.stringify(observation)
    ) {
      journal.value.calibrationObservation = observation;
      await journal.save();
    }
    if (current.state === 'STOPPED') throw new EvaluationError('RUN_STOPPED');
    if (observation.cases.some((item) => item.state === 'FAILED'))
      throw new EvaluationError('CALIBRATION_FAILED');
    return current.calibrationArtifact ? current : null;
  }, 120_000);
}

export async function verifyReviewCases({ prepared, journal, client }) {
  const entries = prepared.cases.filter((item) => item.binding.reviewCase);
  if (!entries.length) return;
  await client.poll(async () => {
    const status = await client.operations();
    if (status.state === 'STOPPED') throw new EvaluationError('RUN_STOPPED');
    let pending = false;
    let failure;
    journal.value.reviewCases ??= [];
    for (const entry of entries) {
      const expected = entry.binding.reviewCase;
      const observed = (status.cases ?? []).filter(
        (item) =>
          item.stage === 'EVALUATION' && item.caseId === expected.caseId,
      );
      if (observed.length > 1)
        throw new EvaluationError('REVIEW_CASE_DUPLICATED');
      const current = observed[0];
      const result = current?.result;
      const passed =
        current?.state === 'SUCCEEDED' &&
        result?.passed === true &&
        result.expected === expected.expected &&
        result.actual === expected.expected &&
        result.boundaryRejected === (expected.boundaryExpected === true) &&
        (result.boundaryRejected
          ? result.reviewCallId === null
          : typeof result.reviewCallId === 'string');
      const record = {
        caseId: expected.caseId,
        state: current?.state ?? 'PENDING',
        expected: expected.expected,
        actual: result?.actual ?? null,
        boundaryRejected: result?.boundaryRejected ?? null,
        reviewCallId: result?.reviewCallId ?? null,
        passed,
      };
      const index = journal.value.reviewCases.findIndex(
        (item) => item.caseId === expected.caseId,
      );
      if (index < 0) journal.value.reviewCases.push(record);
      else journal.value.reviewCases[index] = record;
      if (current?.state === 'FAILED') failure = 'REVIEW_CASE_FAILED';
      else if (current?.state === 'SUCCEEDED' && !passed)
        failure = 'REVIEW_VERDICT_MISMATCH';
      else if (!passed) pending = true;
    }
    // Persist every observed verdict, including a failed one, before throwing.
    await journal.save();
    if (failure) throw new EvaluationError(failure);
    return pending ? null : true;
  }, 120_000);
}

export async function runEvaluation({
  plan,
  prepared,
  directory,
  stages = ['INGESTION', 'CALIBRATION', 'FUNCTIONAL', 'EVALUATION'],
  activateCalibration,
  beforeCase,
}) {
  const credential = JSON.parse(
    await readFile(join(directory, 'capability.json'), 'utf8'),
  );
  if (credential.runId !== prepared.runId)
    throw new EvaluationError('CAPABILITY_RUN_MISMATCH');
  const journal = await EvaluationJournal.load(
    join(directory, 'run-journal.json'),
    prepared.runId,
  );
  await journal.lock();
  let client;
  let activeStage;
  try {
    client = new EvaluationClient({
      ...plan.destination,
      runId: prepared.runId,
      capability: credential.capability,
      sessions: await EvaluationSessions.load(join(directory, 'sessions.json')),
      journal,
    });
    // Server reconciliation always precedes local resume. A completed client
    // operation never grants new budget; uncertain receipts block continuation.
    const status = await client.operations();
    const receipts = await client.receipts();
    if (
      status.state === 'STOPPED' ||
      receipts.some((item) => item.state === 'UNKNOWN')
    )
      throw new EvaluationError('RUN_STOPPED_OR_UNCERTAIN');
    journal.value.reconciledAt = new Date().toISOString();
    journal.value.receiptCount = receipts.length;
    await journal.save();
    for (const stage of stages) {
      if (journal.value.stages[stage]?.state === 'DONE') continue;
      activeStage = stage;
      await client.operations(`/stages/${stage}/start`, {});
      journal.value.stages[stage] = {
        state: 'RUNNING',
        startedAt: new Date().toISOString(),
      };
      await journal.save();
      if (stage === 'INGESTION') {
        for (const item of prepared.materials) {
          const op = await journal.intent(`material:${item.binding.id}`, {
            bindingId: item.binding.id,
            sha256: item.binding.sha256,
          });
          if (!op.result) {
            if (sha256(item.text) !== item.binding.sha256)
              throw new EvaluationError('APPROVED_FILE_CHANGED');
            const form = new globalThis.FormData();
            form.set(
              'file',
              new globalThis.Blob([item.text], { type: 'text/plain' }),
              item.fileName,
            );
            form.set('title', `Evaluación ${item.name}`);
            form.set('activityId', item.binding.activityId);
            const accepted = await client.product(
              item.binding.actorId,
              `/classes/${item.binding.classId}/sources`,
              { method: 'POST', form, key: op.key, expected: [202] },
            );
            op.result = {
              sourceId: accepted.source.id,
              versionId: accepted.version.id,
              jobId: accepted.job.id,
            };
            op.state = 'ADMITTED';
            await journal.save();
          }
          const completed = await client.poll(async () => {
            const result = await client.product(
              item.binding.actorId,
              `/sources/${op.result.sourceId}/jobs/${op.result.jobId}`,
            );
            if (result.state === 'FAILED')
              throw new EvaluationError(`INGESTION_${result.errorCode}`);
            return result.state === 'SUCCEEDED' ? result : null;
          }, 120_000);
          const source = await client.product(
            item.binding.actorId,
            `/sources/${op.result.sourceId}`,
          );
          if (
            source.availability !== 'READY' ||
            source.activeVersion.id !== op.result.versionId ||
            source.chunkCount < 1
          )
            throw new EvaluationError('PARTIAL_GENERATION');
          op.state = 'DONE';
          op.completedAt = completed.updatedAt;
          journal.value.sourceHashes ??= {};
          journal.value.sourceHashes[op.result.versionId] = item.binding.sha256;
          await journal.save();
        }
      } else if (stage === 'CALIBRATION') {
        const calibrated = await waitForCalibration({ client, journal });
        await privateJson(
          join(directory, 'calibration.json'),
          calibrated.calibrationArtifact,
        );
        journal.value.calibrationHash = sha256(
          JSON.stringify(calibrated.calibrationArtifact),
        );
        if (activateCalibration)
          await activateCalibration(calibrated.calibrationArtifact);
      } else if (stage === 'FUNCTIONAL') {
        const entry = prepared.cases.find(
          (item) => item.binding.stage === 'FUNCTIONAL',
        );
        for (const hintLevel of [null, 1, 2, 3]) {
          const sample = await client.help(
            entry.binding,
            hintLevel ? 'HINT' : 'FEEDBACK',
            hintLevel,
            {
              replay: true,
              outsiderId: prepared.outsiderId,
              captureReview: true,
            },
          );
          if (
            sample.status !== 'SUPPORTED' ||
            sample.diagnosis !== entry.expectedDiagnosis
          )
            throw new EvaluationError('FUNCTIONAL_FALLBACK');
        }
      } else {
        const cases = prepared.cases.filter(
          (entry) => entry.profile === 'adversarial',
        );
        for (const entry of cases) {
          await beforeCase?.(entry);
          const requests = entry.helpRequests ?? [
            { kind: 'FEEDBACK', hintLevel: null, oracle: entry.oracle },
          ];
          for (const request of requests) {
            const sample = await client.help(
              entry.binding,
              request.kind,
              request.hintLevel,
              { profile: 'adversarial', captureReview: true },
            );
            journal.value.oracles ??= [];
            const oracle = {
              caseId: request.oracle.caseId,
              requestId: sample.requestId,
              expected: request.oracle.expected,
              actual: sample.status,
              diagnosisPreserved: sample.diagnosis === entry.expectedDiagnosis,
              semanticEvaluation:
                plan.provider === 'TEST'
                  ? 'NOT_ESTABLISHED'
                  : 'PENDING_HUMAN_REVIEW',
            };
            const prior = journal.value.oracles.findIndex(
              (item) => item.caseId === oracle.caseId,
            );
            if (prior < 0) journal.value.oracles.push(oracle);
            else journal.value.oracles[prior] = oracle;
            await journal.save();
            if (sample.diagnosis !== entry.expectedDiagnosis)
              throw new EvaluationError('ADVERSARIAL_DIAGNOSIS_CHANGED');
            if (
              request.oracle.expected.status &&
              sample.status !== request.oracle.expected.status
            )
              throw new EvaluationError('ADVERSARIAL_STATUS_MISMATCH');
          }
        }
        await beforeCase?.(null);
        await verifyReviewCases({ prepared, journal, client });
        for (const profile of ['serial', 'concurrent']) {
          const entries = prepared.cases.filter(
            (entry) => entry.profile === profile,
          );
          if (entries.length !== 25)
            throw new EvaluationError('LATENCY_SAMPLE_COUNT');
          // One student never occupies two lanes. Server quotas remain the
          // authority; the journal's rate pacing avoids testing intentional429.
          const lanes = Array.from(
            { length: profile === 'serial' ? 1 : 4 },
            () => [],
          );
          const actorLane = new Map();
          for (const entry of entries) {
            if (!actorLane.has(entry.binding.actorId))
              actorLane.set(
                entry.binding.actorId,
                actorLane.size % lanes.length,
              );
            lanes[actorLane.get(entry.binding.actorId)].push(entry);
          }
          let stopped = false;
          const outcomes = await Promise.allSettled(
            lanes.map(async (lane) => {
              try {
                for (const entry of lane)
                  for (const hintLevel of [null, 1, 2, 3]) {
                    if (stopped) return;
                    const sample = await client.help(
                      entry.binding,
                      hintLevel ? 'HINT' : 'FEEDBACK',
                      hintLevel,
                      { profile, captureReview: true },
                    );
                    // Preserve the failed sample. Do not fabricate access to the next
                    // level when a fallback kept the server's reservation unchanged.
                    if (sample.status !== 'SUPPORTED') {
                      stopped = true;
                      throw new EvaluationError('LATENCY_HELP_FALLBACK');
                    }
                  }
              } catch (error) {
                stopped = true;
                throw error;
              }
            }),
          );
          const failure = outcomes.find((item) => item.status === 'rejected');
          if (failure) throw failure.reason;
        }
      }
      journal.value.stages[stage].state = 'DONE';
      journal.value.stages[stage].completedAt = new Date().toISOString();
      await journal.save();
      if (
        stage === 'CALIBRATION' &&
        !activateCalibration &&
        stages.some((item) => ['FUNCTIONAL', 'EVALUATION'].includes(item))
      )
        throw new EvaluationError('CALIBRATION_CONSUMER_RESTART_REQUIRED');
    }
    journal.value.finalStatus = await client.operations();
    return await evaluationReport({
      plan,
      prepared,
      directory,
      journal,
      client,
    });
  } catch (error) {
    const failure = {
      stage: activeStage ?? null,
      code: evaluationFailureCode(error),
      at: new Date().toISOString(),
    };
    if (failure.code === 'CALIBRATION_CONSUMER_RESTART_REQUIRED')
      journal.value.pause = failure;
    else {
      journal.value.failures ??= [];
      journal.value.failures.push(failure);
      if (
        activeStage &&
        journal.value.stages[activeStage] &&
        journal.value.stages[activeStage].state !== 'DONE'
      )
        Object.assign(journal.value.stages[activeStage], {
          state: 'FAILED',
          failure,
        });
    }
    await journal.save();
    try {
      await evaluationReport({ plan, prepared, directory, journal, client });
    } catch (reportError) {
      journal.value.reportFailure = evaluationFailureCode(reportError);
      await journal.save();
    }
    throw error;
  } finally {
    try {
      await beforeCase?.(null);
    } finally {
      await journal.close();
    }
  }
}
const percentile = (values, value) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * value) - 1]
    : null;
export async function evaluationReport({
  plan,
  prepared,
  directory,
  journal,
  client,
}) {
  const value =
    journal?.value ??
    JSON.parse(await readFile(join(directory, 'run-journal.json'), 'utf8'));
  let receipts = [];
  let receiptEvidence = client ? 'OBSERVED' : 'NOT_FETCHED';
  try {
    if (client) receipts = await client.receipts();
    if (client && !receipts.length) receiptEvidence = 'NO_RECEIPTS';
  } catch {
    receiptEvidence = 'UNAVAILABLE';
  }
  const profiles = ['serial', 'concurrent'].map((name) => {
    const samples = value.samples.filter((item) => item.profile === name);
    const durations = samples
      .map((item) => item.admissionToPersistedMs)
      .filter((item) => Number.isFinite(item) && item >= 0);
    const clientDurations = samples
      .map((item) => item.clientMs)
      .filter((item) => Number.isFinite(item) && item >= 0);
    return {
      name,
      expected: 100,
      count: samples.length,
      success: samples.filter((item) => item.status === 'SUPPORTED').length,
      fallbacks: samples.filter((item) => item.status !== 'SUPPORTED').length,
      persistedP50Ms: percentile(durations, 0.5),
      persistedP95Ms: percentile(durations, 0.95),
      clientObservedCount: clientDurations.length,
      clientMissingCount: samples.length - clientDurations.length,
      clientP50Ms: percentile(clientDurations, 0.5),
      clientP95Ms: percentile(clientDurations, 0.95),
      belowDocumentaryTarget:
        samples.length === 100 &&
        durations.length === 100 &&
        samples.every(
          (item) =>
            item.status === 'SUPPORTED' && item.verificationComplete !== false,
        ) &&
        percentile(durations, 0.95) < 12000,
    };
  });
  const report = {
    version: 1,
    recordedAt: new Date().toISOString(),
    runId: prepared.runId,
    provider: plan.provider,
    candidateFingerprint: plan.candidateFingerprint,
    corpusHash: prepared.corpusHash,
    configuration: plan.profiles,
    stages: value.stages,
    profiles,
    samples: value.samples,
    receipts,
    receiptEvidence,
    observedInputTokens:
      !receipts.length || receipts.some((r) => r.inputTokens == null)
        ? null
        : receipts.reduce((sum, r) => sum + r.inputTokens, 0),
    observedCostMicroUsd:
      !receipts.length || receipts.some((r) => r.observedCostMicroUsd == null)
        ? null
        : receipts
            .reduce((sum, r) => sum + BigInt(r.observedCostMicroUsd), 0n)
            .toString(),
    maximumReservedCostMicroUsd:
      !receipts.length || receipts.some((r) => r.reservedCostMicroUsd == null)
        ? null
        : receipts
            .reduce((sum, r) => sum + BigInt(r.reservedCostMicroUsd ?? '0'), 0n)
            .toString(),
    pedagogicalQuality:
      'NOT_ESTABLISHED_BY_CONTROLLED_PROVIDER_OR_MODEL_AGREEMENT',
    academicAcceptance: 'PENDING',
    azureEvidence:
      plan.provider === 'TEST' ? 'NOT_PROMOTABLE' : 'REQUIRES_MEASURED_REVIEW',
    omittedRemoteOracles: prepared.omittedRemoteOracles,
    oracles: value.oracles ?? [],
    reviewCases: value.reviewCases ?? [],
    calibrationObservation: value.calibrationObservation ?? null,
    failures: value.failures ?? [],
    pause: value.pause ?? null,
  };
  await privateJson(
    join(directory, 'reports', `${Date.now()}-${randomUUID()}.json`),
    report,
  );
  await privateJson(join(directory, 'report.json'), report);
  // Separate, fictitious review package. Blank means no human review occurred.
  const reviewPath = join(directory, 'teacher-review.json');
  const review = {
    version: rubric.version,
    runId: prepared.runId,
    corpusHash: prepared.corpusHash,
    rubric,
    reviewer: null,
    reviewedAt: null,
    acceptance: null,
    cases: value.samples
      .filter((item) => item.feedbackId)
      .map((item) => ({
        feedbackId: item.feedbackId,
        kind: item.kind,
        hintLevel: item.hintLevel,
        snapshot: value.reviewSnapshots?.[item.feedbackId] ?? null,
        ratings: null,
        notes: null,
      })),
  };
  try {
    await writeFile(reviewPath, JSON.stringify(review, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(reviewPath, 'utf8'));
    if (
      previous.runId !== prepared.runId ||
      previous.corpusHash !== prepared.corpusHash
    )
      throw new EvaluationError('REVIEW_PACKAGE_MISMATCH');
    const merged = [...previous.cases];
    for (const entry of review.cases) {
      const index = merged.findIndex(
        (item) => item.feedbackId === entry.feedbackId,
      );
      if (index < 0) merged.push(entry);
      // Preserve the original review basis and every manually supplied field.
      // An older package without a snapshot can be completed from this run.
      else if (!merged[index].snapshot && entry.snapshot)
        merged[index] = {
          ...entry,
          ...merged[index],
          snapshot: entry.snapshot,
        };
    }
    if (JSON.stringify(previous.cases) !== JSON.stringify(merged))
      await privateJson(reviewPath, { ...previous, cases: merged });
  }
  return report;
}
