import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EmbeddingsPort } from '@alunza/ai';
import type { HelpProviderFactory } from './help/help.ports';
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
import { PhaseDiagnostics } from './http/phase-diagnostics';
import { auditQueryObservation, auditRoute } from './audit/audit-observability';

export { loadConfig } from './config';
export type { AppConfig } from './config';

function normalizedPath(path: string): string {
  if (
    [
      '/health/live',
      '/health/ready',
      '/api/v1/me',
      '/api/v1/me/progress',
      '/api/v1/organizations',
      '/api/v1/class-enrollments',
      '/api/v1/class-enrollments/preview',
    ].includes(path)
  )
    return path;
  if (/^\/api\/v1\/organizations\/[^/]+\/?$/.test(path))
    return '/api/v1/organizations/:orgId';
  const routes: Array<[RegExp, string]> = [
    [
      /^\/api\/v1\/organizations\/[^/]+\/audit-exports\/?$/i,
      '/api/v1/organizations/:orgId/audit-exports',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/audit-exports\/[^/]+\/?$/i,
      '/api/v1/organizations/:orgId/audit-exports/:exportId',
    ],
    [
      /^\/api\/v1\/organizations\/[^/]+\/audit-exports\/[^/]+\/content\/?$/i,
      '/api/v1/organizations/:orgId/audit-exports/:exportId/content',
    ],
    [/^\/api\/v1\/organizations\/[^/]+\/audit-events\/?$/i, auditRoute],
    [/^\/api\/v1\/signals\/[^/]+\/review\/?$/, '/api/v1/signals/:id/review'],
    [
      /^\/api\/v1\/organizations\/[^/]+\/exercise-bank\/?$/,
      '/api/v1/organizations/:orgId/exercise-bank',
    ],
    [
      /^\/api\/v1\/exercises\/[^/]+\/governance\/?$/,
      '/api/v1/exercises/:id/governance',
    ],
    [
      /^\/api\/v1\/exercises\/[^/]+\/governance\/versions\/?$/,
      '/api/v1/exercises/:id/governance/versions',
    ],
    [
      /^\/api\/v1\/exercises\/[^/]+\/governance\/uses\/?$/,
      '/api/v1/exercises/:id/governance/uses',
    ],
    [
      /^\/api\/v1\/exercises\/[^/]+\/governance\/content\/?$/,
      '/api/v1/exercises/:id/governance/content',
    ],
    [
      /^\/api\/v1\/classes\/[^/]+\/dashboard\/?$/,
      '/api/v1/classes/:id/dashboard',
    ],
    [
      /^\/api\/v1\/classes\/[^/]+\/dashboard\/evidence\/?$/,
      '/api/v1/classes/:id/dashboard/evidence',
    ],
    [/^\/api\/v1\/classes\/[^/]+\/signals\/?$/, '/api/v1/classes/:id/signals'],
    [
      /^\/api\/v1\/classes\/[^/]+\/signals\/[^/]+\/?$/,
      '/api/v1/classes/:id/signals/:signalId',
    ],
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
  for (const suffix of [
    'progress',
    'evidence',
    'attempts/:attemptId',
    'attempts/:attemptId/feedback',
    'feedback/:feedbackId',
    'feedback/:feedbackId/sources/:chunkId',
    'feedback/:feedbackId/sources/:chunkId/content',
    'signals',
    'signals/:signalId',
  ]) {
    const template = `/api/v1/classes/:classId/students/:studentId/${suffix}`;
    if (
      new RegExp(`^${template.replace(/:[A-Za-z]+/g, '[^/]+')}/?$`).test(path)
    )
      return template;
  }
  for (const collection of ['courses', 'classes', 'concepts', 'exercises']) {
    if (new RegExp(`^/api/v1/organizations/[^/]+/${collection}/?$`).test(path))
      return `/api/v1/organizations/:orgId/${collection}`;
  }
  for (const collection of [
    'courses',
    'classes',
    'concepts',
    'exercises',
    'activities',
  ]) {
    if (new RegExp(`^/api/v1/${collection}/[^/]+/?$`).test(path))
      return `/api/v1/${collection}/:id`;
    for (const suffix of [
      'archive',
      'teachers',
      'teacher',
      'join-codes',
      'students',
      'versions',
      'activities',
      'publish',
      'close',
      'progress',
    ]) {
      if (new RegExp(`^/api/v1/${collection}/[^/]+/${suffix}/?$`).test(path))
        return `/api/v1/${collection}/:id/${suffix}`;
    }
  }
  if (/^\/api\/v1\/courses\/[^/]+\/teachers\/[^/]+\/?$/.test(path))
    return '/api/v1/courses/:id/teachers/:teacherId';
  if (/^\/api\/v1\/classes\/[^/]+\/join-codes\/[^/]+\/revoke\/?$/.test(path))
    return '/api/v1/classes/:id/join-codes/:codeId/revoke';
  if (/^\/api\/v1\/activities\/[^/]+\/exercises\/[^/]+\/?$/.test(path))
    return '/api/v1/activities/:id/exercises/:assignmentId';
  if (
    /^\/api\/v1\/activities\/[^/]+\/exercises\/[^/]+\/executions\/?$/.test(path)
  )
    return '/api/v1/activities/:id/exercises/:assignmentId/executions';
  if (
    /^\/api\/v1\/activities\/[^/]+\/exercises\/[^/]+\/attempts\/?$/.test(path)
  )
    return '/api/v1/activities/:id/exercises/:assignmentId/attempts';
  if (/^\/api\/v1\/attempts\/[^/]+\/?$/.test(path))
    return '/api/v1/attempts/:id';
  for (const [pattern, template] of [
    [
      /^\/api\/v1\/attempts\/[^/]+\/feedback-requests\/?$/,
      '/api/v1/attempts/:id/feedback-requests',
    ],
    [
      /^\/api\/v1\/attempts\/[^/]+\/feedback\/?$/,
      '/api/v1/attempts/:id/feedback',
    ],
    [
      /^\/api\/v1\/feedback-requests\/[^/]+\/?$/,
      '/api/v1/feedback-requests/:id',
    ],
    [/^\/api\/v1\/feedback\/[^/]+\/?$/, '/api/v1/feedback/:id'],
    [/^\/api\/v1\/feedback\/[^/]+\/viewed\/?$/, '/api/v1/feedback/:id/viewed'],
    [
      /^\/api\/v1\/feedback\/[^/]+\/sources\/[^/]+\/?$/,
      '/api/v1/feedback/:id/sources/:chunkId',
    ],
    [
      /^\/api\/v1\/feedback\/[^/]+\/sources\/[^/]+\/content\/?$/,
      '/api/v1/feedback/:id/sources/:chunkId/content',
    ],
    [/^\/api\/v1\/classes\/[^/]+\/sources\/?$/, '/api/v1/classes/:id/sources'],
    [
      /^\/api\/v1\/classes\/[^/]+\/source-scopes\/?$/,
      '/api/v1/classes/:id/source-scopes',
    ],
    [/^\/api\/v1\/sources\/[^/]+\/?$/, '/api/v1/sources/:id'],
    [
      /^\/api\/v1\/sources\/[^/]+\/versions\/?$/,
      '/api/v1/sources/:id/versions',
    ],
    [
      /^\/api\/v1\/sources\/[^/]+\/versions\/[^/]+\/content\/?$/,
      '/api/v1/sources/:id/versions/:versionId/content',
    ],
    [
      /^\/api\/v1\/sources\/[^/]+\/jobs\/[^/]+\/?$/,
      '/api/v1/sources/:id/jobs/:jobId',
    ],
    [/^\/api\/v1\/sources\/[^/]+\/reindex\/?$/, '/api/v1/sources/:id/reindex'],
    [
      /^\/api\/v1\/sources\/[^/]+\/visibility\/?$/,
      '/api/v1/sources/:id/visibility',
    ],
    [/^\/api\/v1\/sources\/[^/]+\/archive\/?$/, '/api/v1/sources/:id/archive'],
  ] as Array<[RegExp, string]>)
    if (pattern.test(path)) return template;
  return '<unmatched>';
}

export async function createApp(
  config: AppConfig = loadConfig(),
  testEmbeddings?: EmbeddingsPort,
  testHelpFactory?: HelpProviderFactory,
): Promise<INestApplication> {
  const app = await NestFactory.create(
    AppModule.register(config, testEmbeddings, testHelpFactory),
    {
      logger: false,
      abortOnError: false,
      bodyParser: false,
    },
  );
  const expressApp = app.getHttpAdapter().getInstance() as {
    disable(name: string): void;
  };
  expressApp.disable('x-powered-by');
  const diagnostics = app.get(PhaseDiagnostics);
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
          ...auditQueryObservation(
            request,
            normalizedPath(request.path),
            response.statusCode,
          ),
        })}\n`,
      );
    });
    diagnostics.run(
      request.requestId,
      normalizedPath(request.path),
      request.method,
      response,
      next,
    );
  });
  app.enableCors({
    origin: [...config.allowedOrigins],
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'If-Match',
      'Idempotency-Key',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-Release-Id',
      'ETag',
      'Retry-After',
      'Content-Disposition',
    ],
    credentials: false,
    maxAge: 600,
  });
  const standardJson = json({
    limit: '32kb',
    strict: true,
    type: 'application/json',
  });
  const exerciseJson = json({
    limit: '2mb',
    strict: true,
    type: 'application/json',
  });
  // 64 KiB source can expand sixfold through JSON escapes; the decoded source
  // still has an independent 65536-byte limit at the controller boundary.
  const executionJson = json({
    limit: '512kb',
    strict: true,
    type: 'application/json',
  });
  app.use((request: ApiRequest, response: Response, next: NextFunction) => {
    // The eight test definitions may each contain 64 KiB arguments and expected
    // JSON; only authoring routes need this envelope. All other routes keep 32 KiB.
    const authoring =
      request.method === 'POST' &&
      (/^\/api\/v1\/organizations\/[0-9a-f-]{36}\/exercises\/?$/i.test(
        request.path,
      ) ||
        /^\/api\/v1\/exercises\/[0-9a-f-]{36}\/versions\/?$/i.test(
          request.path,
        ));
    const execution =
      request.method === 'POST' &&
      /^\/api\/v1\/activities\/[0-9a-f-]{36}\/exercises\/[0-9a-f-]{36}\/(?:executions|attempts)\/?$/i.test(
        request.path,
      );
    (execution ? executionJson : authoring ? exerciseJson : standardJson)(
      request,
      response,
      next,
    );
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  await app.init();
  return app;
}
