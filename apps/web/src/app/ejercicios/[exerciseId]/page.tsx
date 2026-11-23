import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { ExercisePanel } from '@/components/academic/exercise-panel';
export const metadata: Metadata = { title: 'Ejercicio · Alunza' };
export default async function ExercisePage({
  params,
}: {
  params: Promise<{ exerciseId: string }>;
}) {
  const { exerciseId } = await params;
  return (
    <ProtectedView>
      <ExercisePanel exerciseId={exerciseId} />
    </ProtectedView>
  );
}
