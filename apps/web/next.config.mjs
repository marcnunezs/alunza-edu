import { fileURLToPath } from 'node:url';
import { validatePublicEnvironment } from './config/public-environment.mjs';

validatePublicEnvironment(process.env);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Repository guidance lives in the root AGENTS.md; avoid generated duplicates.
  agentRules: false,
  // E2E builds are isolated from the developer's normal .next output.
  distDir: process.env.ALUNZA_E2E_BUILD === '1' ? '.next-e2e' : '.next',
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  transpilePackages: ['@alunza/contracts'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
