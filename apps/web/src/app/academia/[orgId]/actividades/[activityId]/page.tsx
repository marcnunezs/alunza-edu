import { ProtectedView } from '@/components/protected-view';
import { ActivityPanel } from '@/components/activities-panel';
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ orgId: string; activityId: string }>;
}) {
  const { orgId, activityId } = await params;
  return (
    <ProtectedView>
      <ActivityPanel orgId={orgId} activityId={activityId} />
    </ProtectedView>
  );
}
