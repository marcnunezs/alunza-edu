import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { json } from 'express';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import type { AppConfig } from './config';
import { SafeExceptionFilter } from './http/errors';
import type { ApiRequest } from './http/errors';

export { loadConfig } from './config';
export type { AppConfig } from './config';

function normalizedPath(path: string): string {
  if (
    [
      '/health/live',
      '/health/ready',
      '/api/v1/me',
      '/api/v1/organizations',
    ].includes(path)
  )
    return path;
  if (/^\/api\/v1\/organizations\/[^/]+\/?$/.test(path))
    return '/api/v1/organizations/:orgId';
  const routes: Array<[RegExp, string]> = [
    [
      /^\/api\/v1\/organizations\/[^/]+\/archive\/?$/,
      '/api/v1/organizations/:orgId/archive',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/members\/?$/,
      '/api/v1/organizations/:orgId/members',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/members\/[^/]+\/?$/,
      '/api/v1/organizations/:orgId/members/:userId',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/invitations\/?$/,
      '/api/v1/organizations/:orgId/invitations',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/invitations\/[^/]+\/?$/,
      '/api/v1/organizations/:orgId/invitations/:id',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/invitations\/[^/]+\/resend\/?$/,
      '/api/v1/organizations/:orgId/invitations/:id/resend',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/invitations\/[^/]+\/revoke\/?$/,
      '/api/v1/organizations/:orgId/invitations/:id/revoke',
    ],
    [
      /^\/api\/v1\/invitations\/[^/]+\/accept\/?$/,
      '/api/v1/invitations/:id/accept',
    ],
    [
      /^\/api\/v1\/invitations\/[^/]+\/renew-auth\/?$/,
      '/api/v1/invitations/:id/renew-auth',
    ],
  ];
  for (const [pattern, template] of routes)
    if (pattern.test(path)) return template;
  return '<unmatched>';
}

export async function createApp(
  config: AppConfig = loadConfig(),
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config), {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  const expressApp = app.getHttpAdapter().getInstance() as {
    disable(name: string): void;
  };
  expressApp.disable('x-powered-by');
  app.use((request: ApiRequest, response: Response, next: NextFunction) => {
    const startedAt = performance.now();
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    response.setHeader('X-Release-Id', config.releaseId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    response.once('finish', () => {
      const methods = [
        'GET',
        'HEAD',
        'OPTIONS',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
      ];
      process.stdout.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          environment: config.environment,
          release: config.releaseId,
          method: methods.includes(request.method) ? request.method : 'OTHER',
          path: normalizedPath(request.path),
          requestId: request.requestId,
          status: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        })}\n`,
      );
    });
    next();
  });
  app.enableCors({
    origin: [...config.allowedOrigins],
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'If-Match',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'X-Release-Id', 'ETag', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  });
  app.use(json({ limit: '32kb', strict: true, type: 'application/json' }));
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  await app.init();
  return app;
}
