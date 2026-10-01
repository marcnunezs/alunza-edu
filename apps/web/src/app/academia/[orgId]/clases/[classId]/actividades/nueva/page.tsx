import { ProtectedView } from '@/components/protected-view';
import { NewActivityPanel } from '@/components/activities-panel';
export default async function NewActivityPage({
  params,
}: {
  params: Promise<{ orgId: string; classId: string }>;
}) {
  const { orgId, classId } = await params;
  return (
    <ProtectedView>
      <NewActivityPanel orgId={orgId} classId={classId} />
    </ProtectedView>
  );
}
