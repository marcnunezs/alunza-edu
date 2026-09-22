import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { HomePanel } from '@/components/home-panel';
export const metadata: Metadata = { title: 'Inicio · Alunza' };
export default function HomePage() {
  return (
    <ProtectedView>
      <HomePanel />
    </ProtectedView>
  );
}
