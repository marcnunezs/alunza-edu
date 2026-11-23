import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { z } from 'zod';
import { evaluationStageSchema } from '@alunza/contracts';
import { ApiError } from '../http/errors';
import { EvaluationRepository } from './evaluation.repository';
import { EVALUATION_CONFIG } from './evaluation.types';
import type { EvaluationConfig } from './evaluation.types';

/** Independent loopback listener. It does not inherit domain JWT or ADMIN guards. */
@Injectable()
export class EvaluationOperations implements OnModuleInit, OnModuleDestroy {
  private server?: Server;
  constructor(
    private readonly repository: EvaluationRepository,
    @Inject(EVALUATION_CONFIG) private readonly config: EvaluationConfig,
  ) {}
  async onModuleInit() {
    if (!this.config.enabled) return;
    if (
      !Number.isInteger(this.config.operationsPort) ||
      this.config.operationsPort < 1024 ||
      this.config.operationsPort > 65535
    )
      throw new Error('INVALID_EVALUATION_PORT');
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.requestTimeout = 5000;
    this.server.headersTimeout = 5000;
    this.server.maxHeadersCount = 24;
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.operationsPort, '127.0.0.1', resolve);
    });
  }
  async onModuleDestroy() {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (
        !this.config.enabled ||
        req.socket.remoteAddress !== '127.0.0.1' ||
        req.headers.origin ||
        req.headers['transfer-encoding'] ||
        (req.headers['content-length'] && req.headers['content-length'] !== '0')
      )
        return reply(403, { error: 'FORBIDDEN' });
      const credential = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(
        req.headers.authorization ?? '',
      )?.[1];
      if (!credential) return reply(403, { error: 'FORBIDDEN' });
      const digest = createHash('sha256').update(credential).digest('hex');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const match =
        /^\/operations\/ai-runs\/([^/]+)(?:\/(receipts|stop|stages\/([^/]+)\/start))?$/.exec(
          url.pathname,
        );
      const run = z.uuid().safeParse(match?.[1]);
      if (!match || !run.success)
        return reply(404, { error: 'RESOURCE_NOT_FOUND' });
      const action = match[2];
      if (req.method === 'GET' && !action && !url.search)
        return reply(200, await this.repository.status(run.data, digest));
      if (req.method === 'GET' && action === 'receipts') {
        const params = z
          .strictObject({
            cursor: z.uuid().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(100),
          })
          .safeParse(Object.fromEntries(url.searchParams));
        if (!params.success) return reply(400, { error: 'INVALID_REQUEST' });
        return reply(
          200,
          await this.repository.receipts(
            run.data,
            digest,
            params.data.cursor,
            params.data.limit,
          ),
        );
      }
      if (req.method === 'POST' && action === 'stop' && !url.search)
        return reply(200, await this.repository.stop(run.data, digest));
      const stage = evaluationStageSchema.safeParse(match[3]);
      if (req.method === 'POST' && stage.success && !url.search)
        return reply(
          200,
          await this.repository.startStage(run.data, digest, stage.data),
        );
      return reply(404, { error: 'RESOURCE_NOT_FOUND' });
    } catch (error) {
      return reply(error instanceof ApiError ? error.getStatus() : 503, {
        error:
          error instanceof ApiError ? error.code : 'DEPENDENCY_UNAVAILABLE',
      });
    }
  }
}
