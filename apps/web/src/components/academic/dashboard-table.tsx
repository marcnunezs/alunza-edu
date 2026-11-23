import type { ReactNode } from 'react';

export function DashboardTable({
  label,
  headers,
  children,
}: {
  label: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="max-w-full overflow-x-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-secondary">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_th]:px-4 [&_th]:py-3 [&_th]:align-top">
          {children}
        </tbody>
      </table>
    </div>
  );
}
