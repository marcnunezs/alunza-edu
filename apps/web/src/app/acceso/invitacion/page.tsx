import type { Metadata } from 'next';
import { InvitationPanel } from '@/components/invitation-panel';
export const metadata: Metadata = {
  title: 'Aceptar invitación · Alunza',
  referrer: 'no-referrer',
};
export default function InvitationPage() {
  return <InvitationPanel />;
}
