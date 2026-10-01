import { ProtectedView } from '@/components/protected-view';
import { ExercisesPanel } from '@/components/content-panel';
export default async function ExercisesPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView>
      <ExercisesPanel orgId={orgId} />
    </ProtectedView>
  );
}
