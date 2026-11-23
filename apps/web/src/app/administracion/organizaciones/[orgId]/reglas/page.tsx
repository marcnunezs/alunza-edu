import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { RulesPanel } from '@/components/signal-rules/rules-panel';

export const metadata: Metadata = { title: 'Reglas de señales · Alunza' };
export default async function RulesPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView preserveOnRefresh>
      <RulesPanel orgId={orgId} />
    </ProtectedView>
  );
}
