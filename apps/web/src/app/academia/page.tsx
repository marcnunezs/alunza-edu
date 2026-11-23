import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { AcademicPanel } from '@/components/academic/academic-panel';
export const metadata: Metadata = { title: 'Clases y contenido · Alunza' };
export default async function AcademicPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  return (
    <ProtectedView>
      <AcademicPanel initialOrganization={org} />
    </ProtectedView>
  );
}
