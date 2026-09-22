import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { MembersPanel } from '@/components/members-panel';
export const metadata: Metadata = { title: 'Usuarios y roles · Alunza' };
export default async function MembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView>
      <MembersPanel orgId={orgId} />
    </ProtectedView>
  );
}
