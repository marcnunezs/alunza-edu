import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { StudentProgressPanel } from '@/components/academic/student-progress';

export const metadata: Metadata = { title: 'Mi progreso · Alunza' };
export default async function ProgressPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  return (
    <ProtectedView>
      <StudentProgressPanel classId={classId} />
    </ProtectedView>
  );
}
