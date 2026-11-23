'use client';

import { useState } from 'react';
import { useSession } from '@/components/session-provider';
import { SelectField, roleLabels } from '@/components/identity-forms';
import { Courses } from './courses';
import { Classes } from './classes';
import { Concepts } from './concepts';
import { ExerciseLibrary } from './exercise-panel';

export function AcademicPanel({
  initialOrganization,
}: {
  initialOrganization?: string;
}) {
  const { identity } = useSession();
  const [selected, setSelected] = useState(initialOrganization ?? '');
  if (identity.status !== 'ready') return null;
  const memberships = identity.data.memberships.filter(
    (item) => item.accessMode === 'OPERATE',
  );
  const membership =
    memberships.find((item) => item.organizationId === selected) ??
    memberships[0];
  return (
    <div className="space-y-7">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-primary">
          Programación I · JavaScript
        </p>
        <h1 className="text-3xl font-semibold">Clases y contenido</h1>
        <p className="max-w-2xl text-muted-foreground">
          Organiza tus clases, prepara actividades y conserva tus soluciones.
        </p>
      </header>
      {!membership ? (
        <p>No hay una organización activa disponible para trabajar.</p>
      ) : (
        <>
          <SelectField
            label="Organización de trabajo"
            name="academicOrganization"
            value={membership.organizationId}
            onChange={(event) => setSelected(event.target.value)}
          >
            {memberships.map((item) => (
              <option key={item.organizationId} value={item.organizationId}>
                {item.organizationName} · {roleLabels[item.role]}
              </option>
            ))}
          </SelectField>
          <div
            key={`${membership.organizationId}:${membership.role}`}
            className="space-y-7"
          >
            {membership.role === 'ADMIN' ? (
              <Courses orgId={membership.organizationId} />
            ) : null}
            <Classes orgId={membership.organizationId} role={membership.role} />
            {membership.role === 'ADMIN' ? (
              <Concepts orgId={membership.organizationId} />
            ) : null}
            {membership.role !== 'STUDENT' ? (
              <ExerciseLibrary
                orgId={membership.organizationId}
                canCreate={membership.role === 'TEACHER'}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
