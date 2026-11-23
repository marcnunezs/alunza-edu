import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { ClassPanel } from '@/components/academic/class-panel';
export const metadata: Metadata = { title: 'Clase · Alunza' };
export default async function ClassPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  return (
    <ProtectedView>
      <ClassPanel classId={classId} />
    </ProtectedView>
  );
}
