import { ProtectedView } from '@/components/protected-view';
import { ExerciseEditorPanel } from '@/components/content-panel';
export default async function ExercisePage({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}) {
  const { orgId, id } = await params;
  return (
    <ProtectedView>
      <ExerciseEditorPanel orgId={orgId} id={id} />
    </ProtectedView>
  );
}
