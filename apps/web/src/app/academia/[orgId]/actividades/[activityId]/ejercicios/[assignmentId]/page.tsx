import { ProtectedView } from '@/components/protected-view';
import { SolutionPanel } from '@/components/solution-panel';
export default async function SolutionPage({
  params,
}: {
  params: Promise<{ orgId: string; activityId: string; assignmentId: string }>;
}) {
  const { orgId, activityId, assignmentId } = await params;
  return (
    <ProtectedView>
      <SolutionPanel
        orgId={orgId}
        activityId={activityId}
        assignmentId={assignmentId}
      />
    </ProtectedView>
  );
}
