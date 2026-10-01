import { ProtectedView } from '@/components/protected-view';
import { ExerciseEditorPanel } from '@/components/content-panel';
export default async function NewExercisePage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView>
      <ExerciseEditorPanel orgId={orgId} />
    </ProtectedView>
  );
}
