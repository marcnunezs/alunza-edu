import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { EventLoopUtilization, IntervalHistogram } from 'node:perf_hooks';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, ConfigurationError } from '../config';
import type { AppConfig } from '../config';

const paths = new Set([
  '/api/v1/me',
  '/api/v1/me/progress',
  '/api/v1/classes/:id',
  '/api/v1/organizations/:orgId',
  '/api/v1/classes/:id/dashboard',
  '/api/v1/classes/:id/signals',
]);
const names = new Set([
  'auth.jwt',
  'db.pool',
  'db.begin',
  'db.role',
  'db.context',
  'db.session',
  'db.action',
  'db.commit',
  'db.rollback',
  'dashboard.query',
  'dashboard.parse',
  'dashboard.responseParse',
  'progress.query',
  'progress.parse',
  'progress.responseParse',
]);
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const finite = (value: number) => Number.isFinite(value) && value >= 0;
const duration = (value: number) => (finite(value) ? value : null);
type PoolCounts = { total: number; idle: number; waiting: number };
type Span = {
  name: string;
  startMs: number;
  durationMs: number;
  outcome: 'ok' | 'error';
};
type RequestContext = {
  owner: PhaseDiagnostics;
  requestId: string;
  path: string;
  started: number;
  startedAtUnixMs: number;
  spans: Span[];
  pool: { before: PoolCounts | null; after: PoolCounts | null };
  observerSelfTimeMs: number;
  dropped: number;
  closed: boolean;
};
const context = new AsyncLocalStorage<RequestContext>();
type PendingSpan = { active: RequestContext; name: string; started: number };

export const PHASE_DIAGNOSTIC_RUNTIME = Symbol('PHASE_DIAGNOSTIC_RUNTIME');
export interface PhaseDiagnosticRuntime {
  now(): number;
  wall(): number;
  write(line: string): boolean;
  onDrain(listener: () => void): () => void;
  cpu(): NodeJS.CpuUsage;
  memory(): { rss: number; heapUsed: number };
  eventLoop(previous?: EventLoopUtilization): EventLoopUtilization;
  histogram(): Pick<
    IntervalHistogram,
    'enable' | 'disable' | 'reset' | 'mean' | 'max' | 'percentile'
  >;
}
const defaultRuntime: PhaseDiagnosticRuntime = {
  now: () => performance.now(),
  wall: () => Date.now(),
  write: (line) => process.stdout.write(line),
  onDrain: (listener) => {
    process.stdout.on('drain', listener);
    return () => {
      process.stdout.removeListener('drain', listener);
    };
  },
  cpu: () => process.cpuUsage(),
  memory: () => process.memoryUsage(),
  eventLoop: (previous) => performance.eventLoopUtilization(previous),
  histogram: () => monitorEventLoopDelay({ resolution: 20 }),
};
interface DiagnosticResponse {
  statusCode: number;
  once(event: 'finish' | 'close', listener: () => void): unknown;
  removeListener(event: 'finish' | 'close', listener: () => void): unknown;
}

// No diagnostic callback may replace a domain value/error or repeat its action.
function begin(name: string): PendingSpan | null {
  const active = context.getStore();
  if (!active || active.closed) return null;
  let span: PendingSpan | null = null;
  active.owner.observe(active, () => {
    if (!names.has(name)) {
      active.dropped++;
      return;
    }
    span = { active, name, started: active.owner.now() };
  });
  return span;
}
function end(span: ReturnType<typeof begin>, outcome: Span['outcome']) {
  if (!span || span.active.closed) return;
  const { active, started, name } = span;
  active.owner.observe(active, () => {
    const finished = active.owner.now();
    if (
      active.spans.length >= 64 ||
      !finite(started - active.started) ||
      !finite(finished - started)
    ) {
      active.dropped++;
      return;
    }
    active.spans.push({
      name,
      startMs: started - active.started,
      durationMs: finished - started,
      outcome,
    });
  });
}
export function phaseAsync<T>(
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const span = begin(name);
  if (!span) return action();
  let result: Promise<T>;
  try {
    result = action();
  } catch (error) {
    end(span, 'error');
    throw error;
  }
  return result.then(
    (value) => {
      end(span, 'ok');
      return value;
    },
    (error: unknown) => {
      end(span, 'error');
      throw error;
    },
  );
}
export function phaseSync<T>(name: string, action: () => T): T {
  const span = begin(name);
  try {
    const value = action();
    end(span, 'ok');
    return value;
  } catch (error) {
    end(span, 'error');
    throw error;
  }
}
export function phasePool(
  boundary: 'before' | 'after',
  pool: { totalCount: number; idleCount: number; waitingCount: number },
) {
  const active = context.getStore();
  if (!active || active.closed) return;
  active.owner.observe(active, () => {
    const counts = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
    if (!Object.values(counts).every((n) => Number.isInteger(n) && n >= 0)) {
      active.dropped++;
      return;
    }
    if (boundary === 'after' || !active.pool.before)
      active.pool[boundary] = counts;
  });
}

/** TEST-only, bounded stdout observations; never a product response or authority. */
@Injectable()
export class PhaseDiagnostics implements OnModuleInit, OnModuleDestroy {
  private readonly processInstanceId = randomUUID();
  private readonly enabled: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private histogram?: ReturnType<PhaseDiagnosticRuntime['histogram']>;
  private removeDrain?: () => void;
  private started = 0;
  private previous = 0;
  private previousCpu?: NodeJS.CpuUsage;
  private previousLoop?: EventLoopUtilization;
  private stopped = false;
  private requests = 0;
  private selfTime = 0;
  private dropped = 0;
  private pendingDrain: number | null = null;
  private readonly emission = {
    count: 0,
    selfTimeMs: 0,
    maxSelfTimeMs: 0,
    backpressureEvents: 0,
    backpressureMs: 0,
    writeErrors: 0,
  };

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional()
    @Inject(PHASE_DIAGNOSTIC_RUNTIME)
    private readonly runtime: PhaseDiagnosticRuntime = defaultRuntime,
  ) {
    this.enabled = config.dashboardTimingsEnabled === true;
    if (this.enabled && config.environment !== 'test')
      throw new ConfigurationError(['ALUNZA_TEST_DASHBOARD_TIMINGS']);
  }
  now() {
    return this.runtime.now();
  }
  observe(active: RequestContext | null, action: () => void) {
    let started: number | undefined;
    try {
      started = this.now();
      action();
    } catch {
      if (active) active.dropped++;
      else this.dropped++;
    } finally {
      try {
        const elapsed =
          started === undefined ? null : duration(this.now() - started);
        if (elapsed !== null) {
          this.selfTime += elapsed;
          if (active) active.observerSelfTimeMs += elapsed;
        }
      } catch {
        this.dropped++;
      }
    }
  }
  run(
    requestId: string,
    path: string,
    method: string,
    response: DiagnosticResponse,
    next: () => void,
  ) {
    if (
      !this.enabled ||
      this.stopped ||
      method !== 'GET' ||
      !paths.has(path) ||
      !uuid.test(requestId)
    )
      return next();
    let active: RequestContext | undefined;
    this.observe(null, () => {
      if (this.requests >= 20_000) {
        this.dropped++;
        return;
      }
      const started = this.now(),
        startedAtUnixMs = this.runtime.wall();
      if (
        !finite(started) ||
        !Number.isSafeInteger(startedAtUnixMs) ||
        startedAtUnixMs < 0
      ) {
        this.dropped++;
        return;
      }
      this.requests++;
      active = {
        owner: this,
        requestId,
        path,
        started,
        startedAtUnixMs,
        spans: [],
        pool: { before: null, after: null },
        observerSelfTimeMs: 0,
        dropped: 0,
        closed: false,
      };
      const finish = () => this.finish(active!, response.statusCode, 'finish');
      const close = () => this.finish(active!, response.statusCode, 'close');
      response.once('finish', () => {
        response.removeListener('close', close);
        finish();
      });
      response.once('close', close);
    });
    if (!active) return next();
    const observed = active;
    const clock = () => {
      try {
        const value = this.now();
        if (finite(value)) return value;
      } catch {
        /* Observation cannot replace next's value/error. */
      }
      this.dropped++;
      return null;
    };
    const outerBefore = clock();
    let callbackEnter: number | null = null;
    let callbackExit: number | null = null;
    try {
      return context.run(observed, () => {
        callbackEnter = clock();
        try {
          return next();
        } finally {
          callbackExit = clock();
        }
      });
    } finally {
      const outerAfter = clock();
      // Measure only entry/exit of ALS. next() includes product work and must
      // never be charged to the observer, even when it throws synchronously.
      if (
        outerBefore !== null &&
        callbackEnter !== null &&
        callbackExit !== null &&
        outerAfter !== null
      ) {
        const enter = callbackEnter - outerBefore,
          leave = outerAfter - callbackExit;
        if (finite(enter) && finite(leave)) {
          this.selfTime += enter + leave;
          observed.observerSelfTimeMs += enter + leave;
        } else this.dropped++;
      }
    }
  }
  private finish(
    active: RequestContext,
    status: number,
    terminal: 'finish' | 'close',
  ) {
    if (active.closed) return;
    active.closed = true;
    this.observe(active, () => {
      const durationMs = this.now() - active.started;
      if (
        !finite(durationMs) ||
        !Number.isInteger(status) ||
        status < 100 ||
        status > 599
      ) {
        this.dropped++;
        return;
      }
      this.dropped += active.dropped;
      this.emit({
        event: 'PHASE_DIAGNOSTIC_REQUEST',
        schemaVersion: 1,
        processInstanceId: this.processInstanceId,
        requestId: active.requestId,
        path: active.path,
        method: 'GET',
        status,
        terminal,
        startedAtUnixMs: active.startedAtUnixMs,
        durationMs,
        spans: [...active.spans].sort((a, b) => a.startMs - b.startMs),
        pool: active.pool,
        observerSelfTimeMs: active.observerSelfTimeMs,
        dropped: active.dropped,
      });
    });
  }
  private emit(record: unknown) {
    const started = this.now();
    try {
      const line = JSON.stringify(record) + '\n';
      if (line.length > 32_768) {
        this.dropped++;
        return;
      }
      this.emission.count++;
      if (!this.runtime.write(line)) {
        this.emission.backpressureEvents++;
        this.pendingDrain ??= this.now();
      }
    } catch {
      this.emission.writeErrors++;
      this.dropped++;
    } finally {
      const elapsed = duration(this.now() - started);
      if (elapsed !== null) {
        this.emission.selfTimeMs += elapsed;
        this.emission.maxSelfTimeMs = Math.max(
          this.emission.maxSelfTimeMs,
          elapsed,
        );
      }
    }
  }
  onModuleInit() {
    if (!this.enabled || this.timer || this.stopped) return;
    this.observe(null, () => {
      this.started = this.previous = this.now();
      this.previousCpu = this.runtime.cpu();
      this.previousLoop = this.runtime.eventLoop();
      this.histogram = this.runtime.histogram();
      this.histogram.enable();
      this.removeDrain = this.runtime.onDrain(() => {
        this.observe(null, () => {
          if (this.pendingDrain !== null) {
            this.emission.backpressureMs += Math.max(
              0,
              this.now() - this.pendingDrain,
            );
            this.pendingDrain = null;
          }
        });
      });
      this.timer = setInterval(() => this.sample(false), 1000);
      this.timer.unref();
    });
  }
  private sample(final: boolean) {
    this.observe(null, () => {
      const now = this.now(),
        cpu = this.runtime.cpu(),
        memory = this.runtime.memory();
      const loop = this.runtime.eventLoop(this.previousLoop);
      const previousCpu = this.previousCpu;
      this.previousCpu = cpu;
      this.previousLoop = this.runtime.eventLoop();
      const intervalMs = now - this.previous;
      this.previous = now;
      const hasDelaySamples = Number.isFinite(this.histogram?.mean);
      const record = {
        event: 'PHASE_DIAGNOSTIC_PROCESS',
        schemaVersion: 1,
        processInstanceId: this.processInstanceId,
        timestampUnixMs: this.runtime.wall(),
        elapsedMs: now - this.started,
        intervalMs,
        cpu: {
          userMs: previousCpu
            ? duration((cpu.user - previousCpu.user) / 1000)
            : null,
          systemMs: previousCpu
            ? duration((cpu.system - previousCpu.system) / 1000)
            : null,
        },
        rssBytes: duration(memory.rss),
        heapUsedBytes: duration(memory.heapUsed),
        eventLoop: {
          utilization: duration(loop.utilization),
          delayMeanMs: hasDelaySamples
            ? duration((this.histogram?.mean ?? NaN) / 1e6)
            : null,
          delayP95Ms: hasDelaySamples
            ? duration((this.histogram?.percentile(95) ?? NaN) / 1e6)
            : null,
          delayMaxMs: hasDelaySamples
            ? duration((this.histogram?.max ?? NaN) / 1e6)
            : null,
        },
        // Cumulative cost through the previous observation. Emission costs are
        // included in selfTime, and also broken out here; do not add both.
        observerSelfTimeMs: this.selfTime,
        dropped: this.dropped,
        emission: {
          ...this.emission,
          backpressureMs:
            this.emission.backpressureMs +
            (this.pendingDrain === null
              ? 0
              : Math.max(0, now - this.pendingDrain)),
        },
        final,
      };
      this.histogram?.reset();
      this.emit(record);
    });
  }
  onModuleDestroy() {
    if (!this.enabled || this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.observe(null, () => {
      this.histogram?.disable();
    });
    this.sample(true);
    this.observe(null, () => {
      this.removeDrain?.();
    });
  }
}
