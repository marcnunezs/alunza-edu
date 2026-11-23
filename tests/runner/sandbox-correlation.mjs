import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const operationName = 'probe:sandbox';
const approvalReference = /^[\p{L}\p{N}_.:/@+ -]{1,160}$/u;
const imageDigest = /^[a-z0-9.-]+\/[a-z0-9/_-]+@sha256:[a-f\d]{64}$/;

function requireValue(condition) {
  if (!condition) throw new Error('INVALID_SANDBOX_CORRELATION');
}

function validateApprovalKey(approvalRef, operation) {
  requireValue(
    typeof approvalRef === 'string' &&
      approvalReference.test(approvalRef) &&
      approvalRef === approvalRef.trim() &&
      approvalRef.length > 0 &&
      operation === operationName,
  );
}

export function sandboxCorrelationPath(directory, approvalRef, operation) {
  validateApprovalKey(approvalRef, operation);
  requireValue(typeof directory === 'string' && directory.length > 0);
  // Neither targets, resource UUIDs nor timestamps can grant another dispatch.
  const key = createHash('sha256')
    .update(JSON.stringify([approvalRef, operation]), 'utf8')
    .digest('hex');
  return resolve(directory, `sandbox-correlation-${key}.json`);
}

function approvedCorrelation({ approved, releaseSha, correlation }) {
  requireValue(
    approved === true &&
      typeof releaseSha === 'string' &&
      /^[a-f\d]{40}$/.test(releaseSha),
  );
  requireValue(
    correlation &&
      typeof correlation === 'object' &&
      !Array.isArray(correlation),
  );
  const {
    schemaVersion,
    sandboxName,
    recordedAt,
    teamId,
    projectId,
    image,
    region,
    requestedVmTimeoutMs,
    maxCreateDispatches,
  } = correlation;
  requireValue(
    schemaVersion === 1 &&
      typeof sandboxName === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sandboxName) &&
      typeof recordedAt === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(recordedAt) &&
      Number.isFinite(Date.parse(recordedAt)) &&
      new Date(recordedAt).toISOString() === recordedAt &&
      typeof teamId === 'string' &&
      /^team_[a-zA-Z0-9]{1,155}$/.test(teamId) &&
      typeof projectId === 'string' &&
      /^prj_[a-zA-Z0-9]{1,156}$/.test(projectId) &&
      typeof image === 'string' &&
      imageDigest.test(image) &&
      typeof region === 'string' &&
      /^[a-z][a-z0-9-]{1,40}$/.test(region) &&
      Number.isSafeInteger(requestedVmTimeoutMs) &&
      requestedVmTimeoutMs >= 1 &&
      requestedVmTimeoutMs <= 60000 &&
      maxCreateDispatches === 1,
  );
  // Persist only reconciliation metadata, never token/env/code or hidden tests.
  return {
    schemaVersion,
    sandboxName,
    recordedAt,
    teamId,
    projectId,
    image,
    region,
    requestedVmTimeoutMs,
    maxCreateDispatches,
    approved,
    releaseSha,
  };
}

export async function reserveSandboxCorrelation({
  directory,
  approvalRef,
  operation,
  approved,
  releaseSha,
  correlation,
}) {
  const path = sandboxCorrelationPath(directory, approvalRef, operation);
  const payload = {
    ...approvedCorrelation({ approved, releaseSha, correlation }),
    approvalRef,
    operation,
  };
  await mkdir(directory, { recursive: true });
  try {
    // A failed/uncertain attempt keeps the reservation. Never delete or rewrite
    // it automatically: inspect/reconcile this journal and obtain a new approval.
    await writeFile(path, JSON.stringify(payload, null, 2) + '\n', {
      flag: 'wx',
      flush: true,
      mode: 0o600,
    });
  } catch (cause) {
    if (cause.code === 'EEXIST') {
      const error = new Error('SANDBOX_APPROVAL_ALREADY_RESERVED');
      error.code = 'SANDBOX_APPROVAL_ALREADY_RESERVED';
      error.correlationPath = path;
      throw error;
    }
    throw cause;
  }
  return path;
}
