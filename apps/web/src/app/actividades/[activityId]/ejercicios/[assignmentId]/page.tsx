import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { EditorPanel } from '@/components/academic/editor-panel';
export const metadata: Metadata = { title: 'Preparar solución · Alunza' };
export default async function EditorPage({
  params,
}: {
  params: Promise<{ activityId: string; assignmentId: string }>;
}) {
  const ids = await params;
  return (
    <ProtectedView preserveOnRefresh>
      <EditorPanel {...ids} />
    </ProtectedView>
  );
}
