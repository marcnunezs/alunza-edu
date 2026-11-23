import type { Metadata } from 'next';
import { ProtectedView } from '@/components/protected-view';
import { ClassDashboardPanel } from '@/components/academic/class-dashboard';

export const metadata: Metadata = { title: 'Tablero de clase · Alunza' };

export default async function ClassDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ classId }, values] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      query.append(name, item);
  }
  return (
    <ProtectedView>
      <ClassDashboardPanel classId={classId} initialQuery={query.toString()} />
    </ProtectedView>
  );
}
