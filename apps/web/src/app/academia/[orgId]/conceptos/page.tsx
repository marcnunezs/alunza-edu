import { ProtectedView } from '@/components/protected-view';
import { ConceptsPanel } from '@/components/content-panel';
export default async function ConceptsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView>
      <ConceptsPanel orgId={orgId} />
    </ProtectedView>
  );
}
