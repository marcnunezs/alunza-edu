import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Readable, addAbortSignal } from 'node:stream';
import type { CommandFinished, Sandbox } from '@vercel/sandbox';
import type { CapsuleAdapter, CapsuleInput, CapsuleResult } from './index.js';
import { remoteCapsuleResultSchema } from './remote-result.js';
import {
  remoteDriverExitCodes,
  remoteDriverFailureMarker,
  safeRemoteStartFailureDetail,
  type RemoteStartFailureDetail,
} from '../../../infra/runner/timing.mjs';

const supervisorNode = '/usr/local/bin/node';
const supervisorBootstrap = '/opt/alunza/supervisor/remote-init.mjs';
const supervisorDriver = '/opt/alunza/supervisor/remote-driver.mjs';

export class SandboxRequestBudget {
  private normalCalls = 0;
  private cleanupCalls = 0;
  private cleanupDeadline?: number;
  constructor(
    private readonly maximum: number,
    private readonly deadline: number,
    private readonly now = () => Date.now(),
  ) {
    if (
      !Number.isInteger(maximum) ||
      maximum < 10 ||
      maximum > 100 ||
      !Number.isFinite(deadline) ||
      deadline <= now()
    )
      throw new Error(
        'Sandbox budget requires at least10 requests and a live deadline',
      );
  }
  consume(cleanup: boolean) {
    if (cleanup) {
      this.cleanupDeadline ??= this.now() + 30000;
      if (this.cleanupCalls >= 8 || this.now() >= this.cleanupDeadline)
        throw new Error('Sandbox cleanup budget exhausted');
      this.cleanupCalls++;
    } else {
      if (
        this.cleanupDeadline !== undefined ||
        this.normalCalls >= this.maximum - 8 ||
        this.now() >= this.deadline
      )
        throw new Error('Sandbox request budget exhausted');
      this.normalCalls++;
    }
  }
  get requests() {
    return this.normalCalls + this.cleanupCalls;
  }
}

export type SandboxCorrelation = {
  schemaVersion: 1;
  sandboxName: string;
  recordedAt: string;
  teamId: string;
  projectId: string;
  image: string;
  region: string;
  requestedVmTimeoutMs: number;
  maxCreateDispatches: 1;
  owner: string;
  correlationId: string;
};

export type SandboxResource = {
  sandboxName: string;
  /** The immutable VM session ID; SDK 3 identifies the named sandbox by name. */
  sandboxId: string;
  owner: string;
  correlationId: string;
  teamId: string;
  projectId: string;
  image: string;
  region: string;
};

export type VercelOptions = {
  authorized: true;
  expiresAtMs: number;
  token: string;
  teamId: string;
  projectId: string;
  image: string;
  region: string;
  allowRequest: (cleanup: boolean) => void | Promise<void>;
  recordCorrelation: (correlation: SandboxCorrelation) => Promise<void>;
  sandboxName?: string;
  owner?: string;
  correlationId?: string;
  recordResource?: (resource: SandboxResource) => Promise<void>;
  assertActive?: () => Promise<void>;
  normalDeadlineMs?: number;
  cleanupDeadlineMs?: number;
  /** Trusted acceptance harness only; never populate from an HTTP request. */
  acceptance?: {
    discardCreateResponse?: true;
    naturalTimeoutObservation?: true;
    onCapsuleDispatched?: () => void;
  };
  /** Fixed trusted acceptance probe, never sourced from the execution input. */
  trustedProbe?:
    | 'identity'
    | 'permissions'
    | 'memory'
    | 'descendant-memory'
    | 'processes'
    | 'network';
};

export type VercelRecoveryOptions = Pick<
  VercelOptions,
  'token' | 'teamId' | 'projectId' | 'image' | 'region' | 'recordResource'
> & {
  sandboxName: string;
  sandboxId: string | null;
  owner: string;
  correlationId: string;
  creationState: 'PREPARED' | 'UNKNOWN' | 'CONFIRMED';
  allowRequest?: (cleanup: boolean) => void | Promise<void>;
  cleanupDeadlineMs?: number;
};

type DriverPhase = keyof typeof remoteDriverExitCodes;
export type RemoteDriverCommandEvidence = {
  exitCode: number | null;
  stdoutPresent: boolean;
  stderrPresent: boolean;
  failureMarker: boolean;
  phase: DriverPhase | null;
};

const driverPhases = new Map<number, DriverPhase>(
  (Object.keys(remoteDriverExitCodes) as DriverPhase[]).map((phase) => [
    remoteDriverExitCodes[phase],
    phase,
  ]),
);

// SDK 3.2.2's foreground runCommand returns both channels already cached on
// CommandFinished. Inspect their lengths and the one fixed marker in place.
async function driverCommandEvidence(
  command: CommandFinished,
  operation: 'execute' | 'cleanup',
): Promise<RemoteDriverCommandEvidence> {
  const stdoutPresent = (await command.stdout()).length !== 0;
  const stderr = await command.stderr();
  const failureMarker =
    stderr.length === remoteDriverFailureMarker.length &&
    stderr === remoteDriverFailureMarker;
  const exitCode =
    Number.isInteger(command.exitCode) &&
    command.exitCode >= 0 &&
    command.exitCode <= 255
      ? command.exitCode
      : null;
  const phase =
    !stdoutPresent && failureMarker && exitCode !== null
      ? driverPhases.get(exitCode)
      : undefined;
  const allowedPhase =
    operation === 'cleanup'
      ? phase === 'ARGUMENTS' || phase === 'FILE_CLEANUP'
      : phase !== 'FILE_CLEANUP';
  return {
    exitCode,
    stdoutPresent,
    stderrPresent: stderr.length !== 0,
    failureMarker,
    phase: phase && allowedPhase ? phase : null,
  };
}

export type VercelEvidence = {
  remote: string;
  sandboxName?: string;
  sandboxId?: string;
  owner?: string;
  correlationId?: string;
  region?: string;
  vcpus?: number;
  memoryMb?: number;
  image?: string;
  requestedImage?: string;
  requestedRegion?: string;
  requestedVmTimeoutMs?: number;
  effectiveVmTimeoutMs: number | null;
  persistent?: boolean;
  networkPolicy?: 'deny-all' | 'UNVERIFIED';
  cpuCfsQuota: boolean | null;
  cpuCfsPeriod: boolean | null;
  driverCommand: RemoteDriverCommandEvidence | null;
  driverStartFailure: RemoteStartFailureDetail | null;
  driverCleanupCommand: RemoteDriverCommandEvidence | null;
  creationStatus: string;
  createDispatches: number;
  cleanupCheck: string;
  snapshotsRemaining: number | null;
  activeCpuMs: number | null;
  provisionedDurationMs: number | null;
  durationSource: string | null;
  networkIngressBytes: number | null;
  networkEgressBytes: number | null;
  sessionSnapshotObserved: boolean | null;
  cleanupDurationMs: number | null;
  stopOutcome: string | null;
  cleanupVerified: boolean;
  acceptanceFault?: 'CREATE_RESPONSE_DISCARDED';
  naturalTimeout?: SandboxNaturalTimeoutObservation;
};

export type SandboxNaturalTimeoutObservation = {
  observedAt: string;
  sandboxId: string | null;
  sessionStatus: string;
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  expiresAtMs: number | null;
  requestedVmTimeoutMs: number | null;
  verified: boolean;
};

function deadlineSignal(deadline: number, signal?: AbortSignal) {
  const remaining = Math.ceil(deadline - Date.now());
  const timeout =
    remaining <= 0
      ? AbortSignal.abort(new Error('Sandbox operation deadline'))
      : AbortSignal.timeout(remaining);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function bounded<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) void operation.catch(() => undefined);
  signal.throwIfAborted();
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () =>
      reject(new Error('Sandbox operation deadline or cancellation'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, interrupted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function observedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error))
    return undefined;
  const response = error.response;
  if (
    typeof response !== 'object' ||
    response === null ||
    !('status' in response)
  )
    return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

async function readPrivateJson(
  session: ReturnType<Sandbox['currentSession']>,
  path: string,
  signal: AbortSignal,
  limit: number,
): Promise<unknown> {
  const source = await session.readFile({ path }, { signal });
  if (!source) throw new Error('Remote supervisor result missing');
  const stream = source as Readable;
  addAbortSignal(signal, stream);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      const size = Buffer.byteLength(chunk);
      if (size > limit - length)
        throw new Error('Remote supervisor protocol limit');
      if (!size) continue;
      length += size;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    signal.throwIfAborted();
    try {
      return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    } catch {
      throw new Error('Remote supervisor protocol invalid');
    }
  } finally {
    stream.destroy();
  }
}

function startFailureDetail(
  document: unknown,
): RemoteStartFailureDetail | null {
  if (
    !document ||
    typeof document !== 'object' ||
    Object.keys(document).length !== 3 ||
    !('kind' in document) ||
    document.kind !== 'START_FAILURE' ||
    !('schemaVersion' in document) ||
    document.schemaVersion !== 1 ||
    !('detail' in document)
  )
    return null;
  return safeRemoteStartFailureDetail(document.detail);
}

export class VercelAdapter implements CapsuleAdapter {
  readonly provider = 'vercel' as const;
  private sandbox?: Sandbox;
  private closed = false;
  private readonly closeController = new AbortController();
  private creationAttempted = false;
  private creationDispatched = false;
  private closePromise?: Promise<void>;
  private readonly sandboxName: string;
  private readonly owner: string;
  private readonly correlationId: string;
  private readonly normalDeadlineMs: number;
  private readonly cleanupDeadlineMs: number;
  private sandboxId?: string;
  private recoveryOnly = false;
  private resourceRecorded = false;
  private initialized = false;
  private observingNaturalTimeout = false;
  private stopDispatched = false;
  private capsuleDispatchObserved = false;
  private readonly options: VercelOptions;
  readonly evidence: VercelEvidence = {
    remote: 'NOT_RUN',
    creationStatus: 'NOT_DISPATCHED',
    createDispatches: 0,
    effectiveVmTimeoutMs: null,
    cpuCfsQuota: null,
    cpuCfsPeriod: null,
    driverCommand: null,
    driverStartFailure: null,
    driverCleanupCommand: null,
    cleanupCheck: 'NOT_RUN',
    snapshotsRemaining: null,
    activeCpuMs: null,
    provisionedDurationMs: null,
    durationSource: null,
    networkIngressBytes: null,
    networkEgressBytes: null,
    sessionSnapshotObserved: null,
    cleanupDurationMs: null,
    stopOutcome: null,
    cleanupVerified: false,
  };
  constructor(options: VercelOptions) {
    const acceptance = options.acceptance;
    if (
      acceptance !== undefined &&
      (!acceptance ||
        typeof acceptance !== 'object' ||
        Array.isArray(acceptance) ||
        Object.keys(acceptance).length !== 1 ||
        Object.entries(acceptance).some(([key, value]) =>
          key === 'onCapsuleDispatched'
            ? typeof value !== 'function'
            : !['discardCreateResponse', 'naturalTimeoutObservation'].includes(
                key,
              ) || value !== true,
        ))
    )
      throw new Error('Invalid trusted Sandbox acceptance options');
    if (
      options.authorized !== true ||
      !Number.isFinite(options.expiresAtMs) ||
      typeof options.recordCorrelation !== 'function' ||
      options.expiresAtMs <= Date.now() ||
      !options.token ||
      !/^team_[A-Za-z0-9]+$/.test(options.teamId) ||
      !/^prj_[A-Za-z0-9]+$/.test(options.projectId) ||
      !/^.+@sha256:[a-f0-9]{64}$/.test(options.image) ||
      !/^[a-z][a-z0-9-]{1,40}$/.test(options.region) ||
      (options.sandboxName !== undefined &&
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(options.sandboxName)) ||
      [options.owner, options.correlationId].some(
        (value) =>
          value !== undefined &&
          !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value),
      ) ||
      [options.normalDeadlineMs, options.cleanupDeadlineMs].some(
        (value) =>
          value !== undefined &&
          (!Number.isFinite(value) || value <= Date.now()),
      ) ||
      (options.trustedProbe !== undefined &&
        ![
          'identity',
          'permissions',
          'memory',
          'descendant-memory',
          'processes',
          'network',
        ].includes(options.trustedProbe))
    )
      throw new Error('Authorized Sandbox configuration required');
    this.options = {
      ...options,
      acceptance: acceptance ? { ...acceptance } : undefined,
    };
    this.sandboxName = options.sandboxName ?? `alunza-runner-${randomUUID()}`;
    this.owner = options.owner ?? 'alunza-imp-00-06';
    this.correlationId = options.correlationId ?? this.sandboxName;
    this.normalDeadlineMs = Math.min(
      options.normalDeadlineMs ?? Infinity,
      options.expiresAtMs,
      Date.now() + 30000,
    );
    this.cleanupDeadlineMs = Math.min(
      options.cleanupDeadlineMs ?? Infinity,
      Date.now() + (acceptance?.naturalTimeoutObservation ? 90000 : 40000),
    );
    this.evidence.sandboxName = this.sandboxName;
    this.evidence.owner = this.owner;
    this.evidence.correlationId = this.correlationId;
    this.evidence.requestedImage = options.image;
    this.evidence.requestedRegion = options.region;
  }

  private readonly singleReadSignals = new WeakSet<AbortSignal>();
  private readonly budgetedFetch: typeof fetch = async (url, init) => {
    if (!init?.signal || !this.singleReadSignals.has(init.signal))
      return this.dispatchRequest(url, init);
    // SDK 3.2.2 retries network errors, throttling and 5xx. A diagnostic has
    // one normal request and never needs the provider's error body.
    try {
      const response = await this.dispatchRequest(url, init);
      if (
        response.ok &&
        response.headers
          .get('content-type')
          ?.includes('application/octet-stream')
      )
        return response;
      void response.body?.cancel().catch(() => undefined);
    } catch {
      // AbortError terminates SDK retry without exposing a provider error.
    }
    throw new DOMException('Private diagnostic unavailable', 'AbortError');
  };

  private readonly dispatchRequest: typeof fetch = async (url, init) => {
    const cleanupRequest = this.closed || this.observingNaturalTimeout;
    const address = new URL(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
    );
    const method = (
      init?.method ?? (url instanceof Request ? url.method : 'GET')
    ).toUpperCase();
    const path = address.pathname.replace(/^\/api(?=\/)/, '');
    if (
      !['vercel.com', 'api.vercel.com'].includes(address.hostname) ||
      address.protocol !== 'https:' ||
      (address.searchParams.has('resume') &&
        address.searchParams.get('resume') !== 'false') ||
      (/\/(?:fork|snapshots?)(?:\/|$)/.test(path) && method !== 'GET') ||
      ['PATCH', 'PUT'].includes(method)
    )
      throw new Error('Sandbox lifecycle operation forbidden');
    const createsSandbox =
      method === 'POST' && /^\/v[23]\/sandboxes$/.test(path);
    const exactSandboxPath = `/v2/sandboxes/${encodeURIComponent(this.sandboxName)}`;
    const sessionPath = this.sandboxId
      ? `/v2/sandboxes/sessions/${this.sandboxId}`
      : null;
    if (
      this.observingNaturalTimeout &&
      !(
        method === 'GET' &&
        path === exactSandboxPath &&
        address.searchParams.get('resume') === 'false'
      )
    )
      throw new Error('Natural timeout observation is read-only');
    if (!(
      createsSandbox ||
      (method === 'GET' &&
        path === exactSandboxPath &&
        address.searchParams.get('resume') === 'false') ||
      (method === 'GET' &&
        path === '/v2/sandboxes/snapshots' &&
        address.searchParams.get('name') === this.sandboxName) ||
      (method === 'DELETE' && path === exactSandboxPath) ||
      (sessionPath &&
        method === 'POST' &&
        [
          `${sessionPath}/fs/write`,
          `${sessionPath}/fs/read`,
          `${sessionPath}/cmd`,
          `${sessionPath}/stop`,
        ].includes(path)) ||
      (sessionPath &&
        method === 'GET' &&
        path.startsWith(`${sessionPath}/cmd/`))
    ))
      throw new Error('Sandbox transport operation forbidden');
    if (
      (this.closed || this.recoveryOnly) &&
      !(
        (method === 'GET' &&
          path === exactSandboxPath &&
          address.searchParams.get('resume') === 'false') ||
        (method === 'GET' &&
          path === '/v2/sandboxes/snapshots' &&
          address.searchParams.get('name') === this.sandboxName) ||
        (method === 'POST' &&
          this.sandboxId &&
          path === `/v2/sandboxes/sessions/${this.sandboxId}/stop`) ||
        (method === 'DELETE' && path === exactSandboxPath)
      )
    )
      throw new Error('Sandbox recovery only permits observation and cleanup');
    const session = /^\/v2\/sandboxes\/sessions\/([^/]+)/.exec(path)?.[1];
    if (session && this.sandboxId && session !== this.sandboxId)
      throw new Error('Sandbox session identity changed');
    if (
      createsSandbox &&
      (this.creationDispatched || this.closed || this.recoveryOnly)
    )
      throw new Error(
        'Sandbox creation already dispatched; reconciliation required',
      );
    const signal = deadlineSignal(
      cleanupRequest ? this.cleanupDeadlineMs : this.normalDeadlineMs,
      init?.signal ?? undefined,
    );
    if (!cleanupRequest) {
      await this.assertActive(signal);
      this.assertOpen(signal);
    }
    await bounded(
      Promise.resolve(this.options.allowRequest(cleanupRequest)),
      signal,
    );
    if (init?.signal && this.singleReadSignals.has(init.signal)) {
      // The durable call reservation may outlive this worker's lease.
      await this.assertActive(signal);
    }
    if (cleanupRequest) signal.throwIfAborted();
    else this.assertOpen(signal);
    if (createsSandbox && this.creationDispatched)
      throw new Error(
        'Sandbox creation already dispatched; reconciliation required',
      );
    if (createsSandbox) {
      this.creationDispatched = true;
      this.evidence.createDispatches = 1;
      this.evidence.creationStatus = 'UNCERTAIN';
    }
    if (method === 'POST' && path.endsWith('/stop')) this.stopDispatched = true;
    const response = await fetch(url, { ...init, signal });
    if (createsSandbox && this.options.acceptance?.discardCreateResponse) {
      this.evidence.acceptanceFault = 'CREATE_RESPONSE_DISCARDED';
      await response.body?.cancel();
      throw new Error('Sandbox create response deliberately discarded');
    }
    if (
      !this.capsuleDispatchObserved &&
      response.ok &&
      method === 'POST' &&
      path.endsWith('/cmd') &&
      typeof init?.body === 'string'
    ) {
      const body = JSON.parse(init.body);
      if (
        body.command === supervisorNode &&
        body.sudo === true &&
        body.args?.[0] === supervisorDriver &&
        body.args?.[1] === 'execute'
      ) {
        this.capsuleDispatchObserved = true;
        this.options.acceptance?.onCapsuleDispatched?.();
      }
    }
    return response;
  };

  async observeNaturalTimeout(): Promise<SandboxNaturalTimeoutObservation> {
    if (
      !this.options.acceptance?.naturalTimeoutObservation ||
      !this.initialized ||
      this.closed ||
      this.recoveryOnly ||
      this.stopDispatched ||
      this.observingNaturalTimeout
    )
      throw new Error(
        'Natural timeout observation requires its dedicated live acceptance resource',
      );
    const result: SandboxNaturalTimeoutObservation = {
      observedAt: new Date().toISOString(),
      sandboxId: this.sandboxId ?? null,
      sessionStatus: 'UNVERIFIED',
      startedAtMs: null,
      stoppedAtMs: null,
      expiresAtMs: null,
      requestedVmTimeoutMs: this.evidence.effectiveVmTimeoutMs,
      verified: false,
    };
    this.observingNaturalTimeout = true;
    try {
      const { Sandbox } = await import('@vercel/sandbox');
      const observed = await Sandbox.get({
        token: this.options.token,
        teamId: this.options.teamId,
        projectId: this.options.projectId,
        name: this.sandboxName,
        resume: false,
        fetch: this.budgetedFetch,
        signal: deadlineSignal(this.cleanupDeadlineMs),
      });
      const session = observed.currentSession();
      if (!this.owns(observed) || session.sessionId !== this.sandboxId)
        throw new Error('Sandbox timeout observation identity mismatch');
      result.sessionStatus = session.status;
      result.startedAtMs = observedNumber(session.startedAt?.getTime());
      result.stoppedAtMs = observedNumber(session.stoppedAt?.getTime());
      result.expiresAtMs =
        result.startedAtMs !== null && result.requestedVmTimeoutMs !== null
          ? result.startedAtMs + result.requestedVmTimeoutMs
          : null;
      result.verified =
        session.status === 'stopped' &&
        result.requestedVmTimeoutMs === 60000 &&
        result.expiresAtMs !== null &&
        result.stoppedAtMs !== null &&
        result.stoppedAtMs >= result.expiresAtMs;
      this.sandbox = observed;
    } catch (error) {
      if (responseStatus(error) !== 404) throw error;
      result.sessionStatus = 'ABSENT_WITHOUT_EXPIRY_EVIDENCE';
    } finally {
      this.observingNaturalTimeout = false;
    }
    this.evidence.naturalTimeout = result;
    return result;
  }

  private owns(sandbox: Sandbox): boolean {
    return (
      sandbox.name === this.sandboxName &&
      sandbox.tags?.owner === this.owner &&
      sandbox.tags?.correlation === this.correlationId
    );
  }

  private observeResources(sandbox: Sandbox) {
    this.evidence.region = sandbox.region;
    this.evidence.vcpus = sandbox.vcpus;
    this.evidence.memoryMb = sandbox.memory;
    this.evidence.image = sandbox.image;
    this.evidence.persistent = sandbox.persistent;
    this.evidence.effectiveVmTimeoutMs = observedNumber(sandbox.timeout);
    this.evidence.networkPolicy =
      sandbox.networkPolicy === 'deny-all' ? 'deny-all' : 'UNVERIFIED';
  }

  private async rememberResource(sandbox: Sandbox) {
    const sandboxId = sandbox.currentSession().sessionId;
    if (
      !/^[a-zA-Z0-9_-]{1,160}$/.test(sandboxId) ||
      (this.sandboxId && this.sandboxId !== sandboxId)
    )
      throw new Error('Sandbox session identity changed');
    this.sandboxId = sandboxId;
    this.evidence.sandboxId = sandboxId;
    if (this.resourceRecorded) return;
    await bounded(
      this.options.recordResource?.({
        sandboxName: this.sandboxName,
        sandboxId,
        owner: this.owner,
        correlationId: this.correlationId,
        teamId: this.options.teamId,
        projectId: this.options.projectId,
        image: this.options.image,
        region: this.options.region,
      }) ?? Promise.resolve(),
      deadlineSignal(this.cleanupDeadlineMs),
    );
    this.resourceRecorded = true;
  }

  private assertOpen(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.closed || this.recoveryOnly || Date.now() >= this.normalDeadlineMs)
      throw new Error('Sandbox execution is no longer active');
  }

  private async assertActive(signal: AbortSignal) {
    this.assertOpen(signal);
    await bounded(this.options.assertActive?.() ?? Promise.resolve(), signal);
    this.assertOpen(signal);
  }

  static async recover(
    options: VercelRecoveryOptions,
  ): Promise<VercelEvidence> {
    if (
      !['PREPARED', 'UNKNOWN', 'CONFIRMED'].includes(options.creationState) ||
      (options.creationState === 'CONFIRMED' && !options.sandboxId) ||
      (options.sandboxId !== null &&
        !/^[a-zA-Z0-9_-]{1,160}$/.test(options.sandboxId)) ||
      (options.creationState === 'PREPARED' && options.sandboxId !== null)
    )
      throw new Error('Invalid durable Sandbox recovery state');
    const adapter = new VercelAdapter({
      ...options,
      authorized: true,
      expiresAtMs: Date.now() + 30000,
      cleanupDeadlineMs: options.cleanupDeadlineMs ?? Date.now() + 30000,
      allowRequest: options.allowRequest ?? (() => {}),
      recordCorrelation: async () => {
        throw new Error('Recovery cannot create');
      },
      acceptance: undefined,
      trustedProbe: undefined,
    });
    adapter.recoveryOnly = true;
    adapter.creationAttempted = options.creationState !== 'PREPARED';
    adapter.creationDispatched = adapter.creationAttempted;
    adapter.sandboxId = options.sandboxId ?? undefined;
    adapter.evidence.sandboxId = adapter.sandboxId;
    adapter.evidence.creationStatus = options.creationState;
    try {
      await adapter.close();
    } catch {
      /* An unresolved cleanup remains durable and retryable. */
    }
    return { ...adapter.evidence };
  }

  private async initialize(signal?: AbortSignal) {
    if (this.closed || this.options.expiresAtMs <= Date.now())
      throw new Error('Sandbox authorization expired or adapter closed');
    if (this.sandbox && this.initialized) return this.sandbox;
    if (this.creationAttempted)
      throw new Error('Sandbox creation cannot be repeated');
    const { Sandbox } = await import('@vercel/sandbox');
    const { token, teamId, projectId, image, region } = this.options;
    let timeout = Math.max(
      1,
      Math.min(60000, this.options.expiresAtMs - Date.now()),
    );
    this.evidence.requestedVmTimeoutMs = timeout;
    // Persist the exact cleanup scope before any billable creation request.
    await this.assertActive(signal!);
    await bounded(
      this.options.recordCorrelation({
        schemaVersion: 1,
        sandboxName: this.sandboxName,
        recordedAt: new Date().toISOString(),
        teamId,
        projectId,
        image,
        region,
        requestedVmTimeoutMs: timeout,
        maxCreateDispatches: 1,
        owner: this.owner,
        correlationId: this.correlationId,
      }),
      signal!,
    );
    if (
      this.closed ||
      signal?.aborted ||
      this.options.expiresAtMs <= Date.now()
    )
      throw new Error('Sandbox authorization expired or creation cancelled');
    timeout = Math.min(
      timeout,
      Math.max(1, this.options.expiresAtMs - Date.now()),
    );
    this.evidence.requestedVmTimeoutMs = timeout;
    this.creationAttempted = true;
    this.evidence.creationStatus = 'UNCERTAIN';
    this.sandbox = await Sandbox.create({
      token,
      teamId,
      projectId,
      image,
      region,
      name: this.sandboxName,
      resources: { vcpus: 1 },
      timeout,
      persistent: false,
      networkPolicy: 'deny-all',
      ports: [],
      env: {},
      tags: { owner: this.owner, correlation: this.correlationId },
      signal,
      fetch: this.budgetedFetch,
    });
    const sandbox = this.sandbox;
    this.evidence.remote = 'CREATED';
    this.evidence.creationStatus = 'CONFIRMED';
    this.observeResources(sandbox);
    if (!this.owns(sandbox)) throw new Error('Unexpected Sandbox identity');
    await this.rememberResource(sandbox);
    if (
      !this.owns(sandbox) ||
      sandbox.vcpus !== 1 ||
      sandbox.memory !== 2048 ||
      sandbox.persistent ||
      sandbox.region !== region ||
      sandbox.image !== image ||
      sandbox.networkPolicy !== 'deny-all' ||
      this.evidence.effectiveVmTimeoutMs === null ||
      this.evidence.effectiveVmTimeoutMs <= 0 ||
      this.evidence.effectiveVmTimeoutMs > timeout ||
      sandbox.currentSnapshotId ||
      sandbox.sourceSnapshotId
    )
      throw new Error('Unexpected Sandbox resources, identity or policy');
    const session = sandbox.currentSession();
    await this.assertActive(signal!);
    const bootstrap = await session.runCommand({
      cmd: supervisorNode,
      args: [supervisorBootstrap],
      sudo: true,
      env: { ALUNZA_SANDBOX_BOOTSTRAP: '1' },
      timeoutMs: Math.max(1, this.normalDeadlineMs - Date.now()),
      signal,
    });
    if (bootstrap.exitCode !== 0)
      throw new Error('Nested Docker bootstrap capability gap');
    const data = JSON.parse(await bootstrap.stdout());
    if (
      !data.ready ||
      data.node !== 'v24.21.0' ||
      !/^sha256:[a-f0-9]{64}$/.test(data.image)
    )
      throw new Error('Unverified remote runtime');
    this.evidence.cpuCfsQuota =
      typeof data.cpuCfsQuota === 'boolean' ? data.cpuCfsQuota : null;
    this.evidence.cpuCfsPeriod =
      typeof data.cpuCfsPeriod === 'boolean' ? data.cpuCfsPeriod : null;
    this.evidence.remote = 'BOOTSTRAPPED';
    this.initialized = true;
    return sandbox;
  }
  async execute(
    input: CapsuleInput,
    signal?: AbortSignal,
  ): Promise<CapsuleResult> {
    this.evidence.driverCommand = null;
    this.evidence.driverStartFailure = null;
    this.evidence.driverCleanupCommand = null;
    signal = deadlineSignal(this.normalDeadlineMs, signal);
    await this.assertActive(signal);
    const sandbox = await this.initialize(signal);
    const session = sandbox.currentSession();
    const id = randomUUID();
    const path = `/vercel/sandbox/alunza-input-${id}.json`;
    const output = `/vercel/sandbox/alunza-result-${id}.json`;
    let uploaded = false;
    let result: CapsuleResult | undefined;
    let failure: unknown;
    try {
      await this.assertActive(signal);
      uploaded = true;
      await session.writeFiles(
        [{ path, content: JSON.stringify(input), mode: 0o600 }],
        { signal },
      );
      await this.assertActive(signal);
      const command = await session.runCommand({
        cmd: supervisorNode,
        args: [
          supervisorDriver,
          'execute',
          path,
          output,
          ...(this.options.trustedProbe ? [this.options.trustedProbe] : []),
          `--deadline-ms=${Math.floor(this.normalDeadlineMs)}`,
        ],
        sudo: true,
        env: {},
        timeoutMs: Math.max(1, this.normalDeadlineMs - Date.now()),
        signal,
      });
      const observed = await driverCommandEvidence(command, 'execute');
      this.evidence.driverCommand = observed;
      if (observed.phase === 'START') {
        try {
          const readSignal = AbortSignal.any([
            signal,
            this.closeController.signal,
          ]);
          await this.assertActive(readSignal);
          this.singleReadSignals.add(readSignal);
          const diagnostic = await bounded(
            readPrivateJson(session, output, readSignal, 4096),
            readSignal,
          );
          await this.assertActive(readSignal);
          this.assertOpen(readSignal);
          this.evidence.driverStartFailure = startFailureDetail(diagnostic);
        } catch {
          // Missing, late or unreadable diagnostics cannot supersede START.
        }
      }
      if (
        observed.exitCode !== 0 ||
        observed.stdoutPresent ||
        observed.stderrPresent
      )
        throw new Error('Remote capsule failed');
      await this.assertActive(signal);
      const document = await bounded(
        readPrivateJson(session, output, signal, 524288),
        signal,
      );
      try {
        result = remoteCapsuleResultSchema.parse(document) as CapsuleResult;
      } catch {
        throw new Error('Remote supervisor protocol invalid');
      }
    } catch (error) {
      failure = error;
    }
    // Once cancelled or fenced, only whole-VM cleanup is permitted. Otherwise
    // unlink the private files before allowing the next case in this VM.
    if (uploaded && !signal.aborted && !this.closed) {
      try {
        await this.assertActive(signal);
        const cleanup = await session.runCommand({
          cmd: supervisorNode,
          args: [supervisorDriver, 'cleanup', path, output],
          sudo: true,
          env: {},
          timeoutMs: Math.max(1, this.normalDeadlineMs - Date.now()),
          signal,
        });
        this.evidence.driverCleanupCommand = await driverCommandEvidence(
          cleanup,
          'cleanup',
        );
        if (cleanup.exitCode !== 0)
          throw new Error('Private result cleanup failed');
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
    if (!result) throw new Error('Remote supervisor result unavailable');
    return result;
  }
  close(): Promise<void> {
    this.closePromise ??= this.cleanup();
    return this.closePromise;
  }

  private async cleanup() {
    this.closed = true;
    this.closeController.abort();
    const started = performance.now();
    const signal = deadlineSignal(this.cleanupDeadlineMs);
    this.evidence.cleanupCheck = 'UNVERIFIED';
    try {
      if (!this.creationAttempted) {
        this.evidence.cleanupCheck = 'NO_CREATION_ATTEMPT';
        this.evidence.cleanupVerified = true;
        return;
      }
      const { Sandbox, Snapshot } = await import('@vercel/sandbox');
      const lookup = {
        token: this.options.token,
        teamId: this.options.teamId,
        projectId: this.options.projectId,
        name: this.sandboxName,
        resume: false,
        fetch: this.budgetedFetch,
        signal,
      };
      let sandbox = this.sandbox;
      if (!sandbox) {
        try {
          sandbox = await Sandbox.get(lookup);
        } catch (error) {
          if (responseStatus(error) === 404 && this.sandboxId) {
            // A durable received session ID distinguishes deletion from a
            // create response still in flight. Still verify zero snapshots.
            this.evidence.cleanupCheck = 'KNOWN_RESOURCE_ABSENT';
          } else {
            this.evidence.cleanupCheck =
              responseStatus(error) === 404
                ? 'CREATION_UNRESOLVED'
                : [401, 403].includes(responseStatus(error) ?? 0)
                  ? 'READ_ACCESS_REQUIRED'
                  : 'RECONCILIATION_FAILED';
            // A lost creation response followed by 404 can still be in flight.
            throw new Error('Sandbox creation remains unverified', {
              cause: error,
            });
          }
        }
        if (sandbox) {
          this.evidence.creationStatus = 'RECONCILED';
          this.observeResources(sandbox);
        }
      }
      if (sandbox && !this.owns(sandbox)) {
        this.evidence.cleanupCheck = 'CORRELATION_MISMATCH';
        throw new Error('Sandbox cleanup scope could not be confirmed');
      }
      if (sandbox) {
        await this.rememberResource(sandbox);
        try {
          const stopped = await sandbox.stop({
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          });
          this.evidence.activeCpuMs = observedNumber(
            stopped.activeCpuDurationMs,
          );
          const duration = observedNumber(sandbox.totalDurationMs);
          const start = observedNumber(stopped.startedAt);
          const end = observedNumber(stopped.stoppedAt);
          this.evidence.provisionedDurationMs =
            duration ??
            (start !== null && end !== null && end >= start
              ? end - start
              : null);
          this.evidence.durationSource =
            duration !== null
              ? 'PROVIDER_TOTAL_DURATION_MS'
              : this.evidence.provisionedDurationMs !== null
                ? 'PROVIDER_STOPPED_MINUS_STARTED_AT'
                : null;
          this.evidence.networkIngressBytes = observedNumber(
            stopped.networkTransfer?.ingress,
          );
          this.evidence.networkEgressBytes = observedNumber(
            stopped.networkTransfer?.egress,
          );
          this.evidence.sessionSnapshotObserved = Boolean(stopped.snapshot);
          this.evidence.stopOutcome = 'CONFIRMED';
        } catch {
          // Deletion plus readback can still prove cleanup if stop was unavailable.
          this.evidence.stopOutcome = 'FAILED';
        } finally {
          await sandbox.delete({
            deleteOrphanSnapshots: true,
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          });
        }
      }
      try {
        await Sandbox.get(lookup);
        this.evidence.cleanupCheck = 'SANDBOX_REMAINS';
        throw new Error('Sandbox remains after deletion');
      } catch (error) {
        if (responseStatus(error) !== 404) {
          if ([401, 403].includes(responseStatus(error) ?? 0))
            this.evidence.cleanupCheck = 'READ_ACCESS_REQUIRED';
          throw new Error('Sandbox deletion could not be verified', {
            cause: error,
          });
        }
      }
      // This filter queries only snapshots belonging to this exact sandbox.
      const snapshots = await Snapshot.list({
        token: this.options.token,
        teamId: this.options.teamId,
        projectId: this.options.projectId,
        name: this.sandboxName,
        limit: 1,
        fetch: this.budgetedFetch,
        signal,
      }).catch((error: unknown) => {
        this.evidence.cleanupCheck = [401, 403].includes(
          responseStatus(error) ?? 0,
        )
          ? 'READ_ACCESS_REQUIRED'
          : 'SNAPSHOT_QUERY_FAILED';
        throw new Error('Sandbox snapshots could not be verified', {
          cause: error,
        });
      });
      this.evidence.snapshotsRemaining = snapshots.snapshots.length;
      if (
        snapshots.snapshots.length !== 0 ||
        snapshots.pagination.count !== 0 ||
        snapshots.pagination.next !== null
      ) {
        this.evidence.cleanupCheck = 'SNAPSHOTS_UNVERIFIED_OR_REMAINING';
        throw new Error('Sandbox snapshots remain or query is incomplete');
      }
      this.evidence.cleanupCheck = 'ABSENT_AND_ZERO_SNAPSHOTS';
      this.evidence.cleanupVerified = true;
      this.sandbox = undefined;
    } finally {
      this.evidence.cleanupDurationMs = performance.now() - started;
    }
  }
}

/** Reconcile only a previously reserved identity. Never creates or executes. */
export async function recoverVercelSandbox(
  options: VercelRecoveryOptions,
): Promise<VercelEvidence> {
  return VercelAdapter.recover(options);
}
