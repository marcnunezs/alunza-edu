import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { ExerciseBankPanel } from '@/components/exercise-bank/bank-panel';

export const metadata: Metadata = { title: 'Banco de ejercicios · Alunza' };

export default async function ExerciseBankPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <ProtectedView>
      <ExerciseBankPanel orgId={orgId} />
    </ProtectedView>
  );
}
