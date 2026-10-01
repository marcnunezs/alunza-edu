import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { OrganizationsPanel } from '@/components/organizations-panel';
export const metadata: Metadata = { title: 'Organizaciones · Alunza' };
export default function OrganizationsPage() {
  return (
    <ProtectedView>
      <OrganizationsPanel />
    </ProtectedView>
  );
}
