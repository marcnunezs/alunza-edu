function isPublicUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isPublicKey(value) {
  if (typeof value !== 'string' || value.length < 20) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  // Legacy anon keys remain public; privileged keys must fail before compilation.
  try {
    const parts = value.split('.');
    return (
      parts.length === 3 &&
      JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role ===
        'anon'
    );
  } catch {
    return false;
  }
}

const validators = {
  NEXT_PUBLIC_API_BASE_URL: isPublicUrl,
  NEXT_PUBLIC_SUPABASE_URL: isPublicUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: isPublicKey,
};

// Native JS also runs in Next's minimal standalone image without extra packages.
export function validatePublicEnvironment(environment) {
  const fields = Object.entries(validators)
    .filter(([field, validate]) => !validate(environment[field]))
    .map(([field]) => field);
  if (fields.length > 0) {
    throw new Error(
      `Configuración web ausente o inválida: ${fields.join(', ')}. Consulta apps/web/.env.example.`,
    );
  }
  return Object.fromEntries(
    Object.keys(validators).map((field) => [field, environment[field]]),
  );
}
