import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { TeacherStudentDetailPanel } from '@/components/academic/student-detail';

export const metadata: Metadata = { title: 'Detalle del estudiante · Alunza' };

export default async function TeacherStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; studentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [scope, values] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      query.append(name, item);
  }
  return (
    <ProtectedView>
      <TeacherStudentDetailPanel {...scope} initialQuery={query.toString()} />
    </ProtectedView>
  );
}
