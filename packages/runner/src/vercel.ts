import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Sandbox } from '@vercel/sandbox';
import type { CapsuleAdapter, CapsuleInput, CapsuleResult } from './index.js';

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

export type VercelOptions = {
  authorized: true;
  expiresAtMs: number;
  token: string;
  teamId: string;
  projectId: string;
  image: string;
  region: string;
  allowRequest: (cleanup: boolean) => void;
};
export class VercelAdapter implements CapsuleAdapter {
  readonly provider = 'vercel' as const;
  private sandbox?: Sandbox;
  private closed = false;
  private readonly options: VercelOptions;
  readonly evidence: {
    remote: string;
    sandboxName?: string;
    region?: string;
    vcpus?: number;
    memoryMb?: number;
    image?: string;
    cleanupVerified?: boolean;
  } = { remote: 'NOT_RUN' };
  constructor(options: VercelOptions) {
    if (
      options.authorized !== true ||
      options.expiresAtMs <= Date.now() ||
      !options.token ||
      !/^team_[A-Za-z0-9]+$/.test(options.teamId) ||
      !/^prj_[A-Za-z0-9]+$/.test(options.projectId) ||
      !/^.+@sha256:[a-f0-9]{64}$/.test(options.image) ||
      !/^[a-z][a-z0-9-]{1,40}$/.test(options.region)
    )
      throw new Error('Authorized Sandbox configuration required');
    this.options = { ...options };
  }
  private async initialize(signal?: AbortSignal) {
    if (this.closed || this.options.expiresAtMs <= Date.now())
      throw new Error('Sandbox authorization expired or adapter closed');
    if (this.sandbox) return this.sandbox;
    const { Sandbox } = await import('@vercel/sandbox');
    const { token, teamId, projectId, image, region } = this.options;
    this.sandbox = await Sandbox.create({
      token,
      teamId,
      projectId,
      image,
      region,
      name: `alunza-runner-${randomUUID()}`,
      resources: { vcpus: 1 },
      timeout: Math.max(
        1,
        Math.min(60000, this.options.expiresAtMs - Date.now()),
      ),
      persistent: false,
      networkPolicy: 'deny-all',
      ports: [],
      env: {},
      tags: { owner: 'alunza-imp-00-06' },
      signal,
      fetch: (url, init) => {
        this.options.allowRequest(this.closed);
        return fetch(url, init);
      },
    });
    const sandbox = this.sandbox;
    this.evidence.remote = 'CREATED';
    this.evidence.sandboxName = sandbox.name;
    this.evidence.region = sandbox.region;
    this.evidence.vcpus = sandbox.vcpus;
    this.evidence.memoryMb = sandbox.memory;
    this.evidence.image = image;
    if (sandbox.vcpus !== 1 || sandbox.memory !== 2048 || sandbox.persistent)
      throw new Error('Unexpected Sandbox resources');
    const paths = ['capsule.mjs', 'remote-driver.mjs', 'remote-init.mjs'];
    await sandbox.writeFiles(
      await Promise.all(
        paths.map(async (path) => ({
          path: `/vercel/sandbox/${path}`,
          mode: 0o444,
          content: await readFile(
            new URL(`../../../infra/runner/${path}`, import.meta.url),
          ),
        })),
      ),
      { signal },
    );
    const bootstrap = await sandbox.runCommand({
      cmd: 'node',
      args: ['/vercel/sandbox/remote-init.mjs'],
      sudo: true,
      env: { ALUNZA_SANDBOX_BOOTSTRAP: '1' },
      timeoutMs: 45000,
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
    this.evidence.remote = 'BOOTSTRAPPED';
    return sandbox;
  }
  async execute(
    input: CapsuleInput,
    signal?: AbortSignal,
  ): Promise<CapsuleResult> {
    const sandbox = await this.initialize(signal);
    const path = `/vercel/sandbox/alunza-input-${randomUUID()}.json`;
    await sandbox.writeFiles(
      [{ path, content: JSON.stringify(input), mode: 0o600 }],
      { signal },
    );
    const command = await sandbox.runCommand({
      cmd: 'node',
      args: ['/vercel/sandbox/remote-driver.mjs', path],
      sudo: true,
      env: {},
      timeoutMs: 20000,
      signal,
    });
    if (command.exitCode !== 0) throw new Error('Remote capsule failed');
    const encoded = await command.stdout();
    if (Buffer.byteLength(encoded) > 524288)
      throw new Error('Remote supervisor protocol limit');
    return JSON.parse(encoded) as CapsuleResult;
  }
  async close() {
    this.closed = true;
    if (!this.sandbox) return;
    const sandbox = this.sandbox;
    this.sandbox = undefined;
    try {
      await sandbox.stop({ signal: AbortSignal.timeout(15000) });
    } finally {
      await sandbox.delete({
        deleteOrphanSnapshots: true,
        signal: AbortSignal.timeout(15000),
      });
    }
    this.evidence.cleanupVerified = true;
  }
}
