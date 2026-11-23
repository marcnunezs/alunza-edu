import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { AuditPanel } from '@/components/audit/audit-panel';

export const metadata: Metadata = { title: 'Auditoría · Alunza' };

export default async function AuditPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView>
      <AuditPanel orgId={orgId} />
    </ProtectedView>
  );
}
