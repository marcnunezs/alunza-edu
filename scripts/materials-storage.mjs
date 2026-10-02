import { createClient } from '@supabase/supabase-js';

// Local bootstrap only. The domain API never creates buckets or policies.
export async function ensureMaterialsStorage(ctx, state) {
  if (
    ![
      'alunza-edu-laboratorio',
      'alunza-edu-laboratorio-test',
      'alunza-edu-laboratorio-eval',
    ].includes(ctx.projectId) ||
    state.projectId !== ctx.projectId
  )
    throw new Error(
      'Storage solo puede prepararse en el laboratorio identificado.',
    );
  const expected = `http://127.0.0.1:${ctx.authPort}`;
  if (state.authUrl !== expected)
    throw new Error('Destino Storage local inesperado.');
  const client = createClient(state.authUrl, state.authAdminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }),
    },
  });
  const { data: buckets, error } = await client.storage.listBuckets();
  if (error)
    throw new Error(
      'Storage local no está disponible; inicia el servicio habilitado antes de migrar.',
    );
  const options = {
    public: false,
    fileSizeLimit: 10_000_000,
    allowedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
  };
  const response = buckets.some((bucket) => bucket.id === 'materials')
    ? await client.storage.updateBucket('materials', options)
    : await client.storage.createBucket('materials', options);
  if (response.error)
    throw new Error('No se pudo preparar el bucket privado de materiales.');
  const checked = await client.storage.getBucket('materials');
  if (
    checked.error ||
    checked.data.public ||
    Number(checked.data.file_size_limit) !== 10_000_000
  )
    throw new Error(
      'El bucket de materiales no conserva los límites esperados.',
    );
}
