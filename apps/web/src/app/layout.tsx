import type { Metadata } from 'next';
import { Shell } from '@/components/shell';
import { SessionProvider } from '@/components/session-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alunza · Tu organización',
  description: 'Acceso y administración de organizaciones de Alunza.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <SessionProvider>
          <Shell>{children}</Shell>
        </SessionProvider>
      </body>
    </html>
  );
}
