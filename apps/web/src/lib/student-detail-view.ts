import {
  dashboardQuerySchema,
  studentDetailQuerySchema,
  type DashboardQuery,
  type StudentDetailQuery,
} from '@alunza/contracts';
import { dashboardQuery } from './dashboard-view';
import { localDateTime, toInstant } from './academic-time';

export function queryObject(search: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [name, value] of new URLSearchParams(search)) {
    if (Object.hasOwn(result, name))
      throw new Error('Un filtro no puede repetirse.');
    result[name] = value;
  }
  return result;
}

export function readDashboardQuery(search: string): DashboardQuery {
  return dashboardQuerySchema.parse(queryObject(search));
}

export function readStudentDetailQuery(search: string): {
  filters: StudentDetailQuery;
  returnQuery: string;
} {
  const { returnQuery = '', ...values } = queryObject(search);
  return {
    filters: studentDetailQuerySchema.parse(values),
    returnQuery: dashboardQuery(readDashboardQuery(returnQuery)),
  };
}

export function studentDetailHref(
  classId: string,
  studentId: string,
  filters: DashboardQuery,
  asOf: string,
) {
  const { cursor: _cursor, ...detailFilters } = filters;
  const query = new URLSearchParams(dashboardQuery({ ...detailFilters, asOf }));
  query.set('returnQuery', dashboardQuery({ ...filters, asOf }));
  return `/clases/${encodeURIComponent(classId)}/estudiantes/${encodeURIComponent(studentId)}?${query}`;
}

export function studentDetailSearch(
  filters: StudentDetailQuery,
  returnQuery: string,
) {
  const search = new URLSearchParams(dashboardQuery(filters));
  if (returnQuery)
    search.set('returnQuery', dashboardQuery(readDashboardQuery(returnQuery)));
  return search.toString();
}

// An unchanged datetime-local field must retain the server's exact microsecond cut.
export function selectedInstant(
  value: string,
  previous: string | undefined,
  timezone: string,
) {
  return previous && value === localDateTime(previous, timezone)
    ? previous
    : toInstant(value, timezone);
}
