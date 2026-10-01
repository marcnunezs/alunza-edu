import { validatePublicEnvironment } from '../config/public-environment.mjs';

try {
  validatePublicEnvironment(process.env);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Configuración web inválida.',
  );
  process.exit(1);
}

// Docker places the Next standalone server beside config/ and scripts/.
await import('../server.js');
