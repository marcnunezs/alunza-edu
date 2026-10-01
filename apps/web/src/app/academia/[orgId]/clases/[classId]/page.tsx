import { ProtectedView } from '@/components/protected-view';
import { ClassPanel } from '@/components/activities-panel';
export default async function ClassPage({
  params,
}: {
  params: Promise<{ orgId: string; classId: string }>;
}) {
  const { orgId, classId } = await params;
  return (
    <ProtectedView>
      <ClassPanel orgId={orgId} classId={classId} />
    </ProtectedView>
  );
}
