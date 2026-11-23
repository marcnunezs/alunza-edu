import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';
import { ExecutionPort } from './execution.port';
import type {
  ExecutionAuthority,
  ExecutionContext,
  PracticeExecutionInput,
  ExecutionRequestClosure,
} from './execution.port';
import { DockerExecutionAdapter } from './docker-execution.adapter';
import { VercelExecutionAdapter } from './vercel-execution.adapter';
import { SandboxResourceRepository } from './sandbox-resource.repository';
import { LocalVmExecutionAdapter } from './local-vm-execution.adapter';

@Injectable()
export class ExecutionRouterAdapter extends ExecutionPort {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly docker: DockerExecutionAdapter,
    private readonly vercel: VercelExecutionAdapter,
    private readonly resources: SandboxResourceRepository,
    @Optional() private readonly localVm?: LocalVmExecutionAdapter,
  ) {
    super();
  }
  private get selected() {
    if (this.config.practiceRunnerProvider === 'local-vm') {
      if (!this.localVm) throw new Error('Local VM provider unavailable');
      return this.localVm;
    }
    return this.config.practiceRunnerProvider === 'vercel'
      ? this.vercel
      : this.docker;
  }
  inspect() {
    return this.selected.inspect();
  }
  execute(
    input: PracticeExecutionInput,
    context?: ExecutionContext,
    authority?: ExecutionAuthority,
  ) {
    if (
      context &&
      context.provider !== (this.config.practiceRunnerProvider ?? 'docker')
    )
      throw new Error('Admission provider changed');
    return this.selected.execute(input, context, authority);
  }
  async cleanup(
    executionId: string,
    timeoutMs?: number,
    context?: ExecutionContext,
  ) {
    const admitted = context ?? (await this.resources.loadContext(executionId));
    if (admitted?.provider === 'local-vm')
      return this.localVm?.cleanup(executionId, timeoutMs, admitted) ?? false;
    return admitted?.provider === 'vercel'
      ? this.vercel.cleanup(executionId, timeoutMs)
      : this.docker.cleanup(executionId, timeoutMs, admitted);
  }
  sweepExpired() {
    return this.selected.sweepExpired();
  }
  override requestClosed(
    executionId: string,
    context: ExecutionContext,
    closure: ExecutionRequestClosure,
  ) {
    if (context.provider === 'docker')
      this.docker.requestClosed(executionId, context, closure);
  }
}
