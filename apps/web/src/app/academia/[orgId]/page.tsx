import { ProtectedView } from '@/components/protected-view';
import { AcademicPanel } from '@/components/academic-panel';
export default async function AcademicPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView>
      <AcademicPanel orgId={orgId} />
    </ProtectedView>
  );
}
