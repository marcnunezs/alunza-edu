import rootConfig from '../../eslint.config.mjs';
import { fileURLToPath } from 'node:url';

// Imported flat-config globs are relative to this config when run as a workspace.
export default rootConfig.map((config) => ({
  ...config,
  ...(config.files
    ? {
        files: config.files.map((pattern) =>
          pattern.replace(/^apps\/web\//, ''),
        ),
      }
    : {}),
  ...(config.settings?.next
    ? {
        settings: {
          ...config.settings,
          next: { rootDir: fileURLToPath(new URL('.', import.meta.url)) },
        },
      }
    : {}),
}));
