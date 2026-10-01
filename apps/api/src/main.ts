import { createApp, loadConfig } from './app';
import { ConfigurationError } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  try {
    await app.listen(config.port, config.host);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof ConfigurationError ? 'CONFIG_INVALID' : 'STARTUP_FAILED';
  const fields = error instanceof ConfigurationError ? error.fields : [];
  process.stderr.write(`${JSON.stringify({ code, fields })}\n`);
  process.exitCode = 1;
});
