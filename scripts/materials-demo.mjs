import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { materials } from '../fixtures/demo/materials.mjs';
import { classes } from '../fixtures/demo/academic.mjs';
import { context, readState, root } from './local.mjs';
import { join } from 'node:path';
import { materialOperationResponseSchema } from '@alunza/contracts';

// Explicit local demo command. It uploads fictitious content through the same
// authorized API as the UI. It never inserts synthetic production embeddings.
const ctx = context();
const state = await readState(ctx);
const identities = JSON.parse(
  await readFile(join(root, 'fixtures/foundation/identity.json'), 'utf8'),
);
const tokens = new Map();
for (const doc of materials) {
  const teacherId = classes.find((entry) => entry.id === doc.classId).teacherId;
  if (!tokens.has(teacherId)) {
    const account = identities.users.find((entry) => entry.id === teacherId);
    const auth = createClient(state.authUrl, state.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await auth.auth.signInWithPassword({
      email: account.email,
      password: state.fixturePassword,
    });
    if (result.error || !result.data.session)
      throw new Error(
        'No se obtuvo la sesión docente ficticia. Ejecuta db:seed.',
      );
    tokens.set(teacherId, result.data.session.access_token);
  }
  const data = new globalThis.FormData();
  data.set('title', doc.title);
  data.set(
    'file',
    new globalThis.Blob([await readFile(doc.filePath)], {
      type:
        doc.format === 'PDF'
          ? 'application/pdf'
          : doc.format === 'MARKDOWN'
            ? 'text/markdown'
            : 'text/plain',
    }),
    doc.fileName,
  );
  const response = await fetch(
    `${ctx.apiUrl}/api/v1/classes/${doc.classId}/sources`,
    {
      method: 'POST',
      body: data,
      headers: {
        Authorization: `Bearer ${tokens.get(teacherId)}`,
        'Idempotency-Key': `canonical-material-${doc.key}`,
      },
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok)
    throw new Error(
      `No se recibió el documento ficticio ${doc.key} (HTTP ${response.status}).`,
    );
  const result = materialOperationResponseSchema.parse(await response.json());
  console.log(`${doc.key}: recibido; trabajo ${result.data.job.state}.`);
}
console.log(
  'Seis documentos recibidos. Consulta Materiales para verificar disponibilidad; sin Azure configurado la indexación informa el motivo y permite reintentar.',
);
