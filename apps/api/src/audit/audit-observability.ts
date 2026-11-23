import type { ApiRequest } from '../http/errors';

export const auditRoute = '/api/v1/organizations/:orgId/audit-events';
export function auditQueryObservation(
  request: ApiRequest,
  path: string,
  status: number,
) {
  const exporting =
    [
      '/api/v1/organizations/:orgId/audit-exports',
      '/api/v1/organizations/:orgId/audit-exports/:exportId',
      '/api/v1/organizations/:orgId/audit-exports/:exportId/content',
    ].includes(path) && ['POST', 'GET', 'HEAD'].includes(request.method);
  if (
    !exporting &&
    (path !== auditRoute || !['GET', 'HEAD'].includes(request.method))
  )
    return {};
  return {
    event: exporting ? 'audit.export' : 'audit.query',
    outcome:
      status >= 200 && status < 300
        ? 'SUCCEEDED'
        : [401, 403, 404].includes(status)
          ? 'DENIED'
          : [400, 422].includes(status)
            ? 'INVALID'
            : 'FAILED',
    ...(request.actorId ? { actorId: request.actorId } : {}),
    ...(request.auditOrganizationId
      ? { organizationId: request.auditOrganizationId }
      : {}),
  };
}
