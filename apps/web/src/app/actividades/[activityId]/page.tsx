import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { ActivityPanel } from '@/components/academic/activity-panel';
export const metadata: Metadata = { title: 'Actividad · Alunza' };
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  const { activityId } = await params;
  return (
    <ProtectedView>
      <ActivityPanel activityId={activityId} />
    </ProtectedView>
  );
}
