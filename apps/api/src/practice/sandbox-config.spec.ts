import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSandboxConfiguration } from './sandbox-config';
import { loadConfig } from '../config';
import { rootCertificates } from 'node:tls';

describe('Sandbox campaign configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'alunza-sandbox-config-'));
  const path = join(directory, 'campaign.json');
  const campaign = {
    schemaVersion: 1,
    environment: 'preproduction',
    authorized: true,
    campaignId: '10000000-0000-4000-8000-000000000001',
    expiresAt: '2070-01-01T00:00:00Z',
    teamId: 'team_unit',
    projectId: 'prj_unit',
    region: 'iad1',
    image: `vcr.vercel.com/unit/runner@sha256:${'a'.repeat(64)}`,
    runnerVersion: 'unit',
    maxCreations: 2,
    maxRequests: 100,
    maxCost: 1,
    currency: 'USD',
    candidate: { commit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) },
    approval: {
      reference: 'unit-only',
      approvedBy: 'unit',
      approvedAt: '2026-01-01T00:00:00Z',
    },
  };
  const env = {
    SANDBOX_CAMPAIGN_FILE: path,
    VERCEL_TOKEN: 'private-unit-token',
    SANDBOX_TEAM_ID: campaign.teamId,
    SANDBOX_PROJECT_ID: campaign.projectId,
    SANDBOX_REGION: campaign.region,
    SANDBOX_IMAGE: campaign.image,
  };
  beforeEach(() => writeFileSync(path, JSON.stringify(campaign)));
  afterAll(() => {
    unlinkSync(path);
    rmdirSync(directory);
  });
  it('keeps credentials out of immutable admission context', () => {
    const config = loadSandboxConfiguration(
      env,
      true,
      campaign.candidate.commit,
    )!;
    expect(config.context.provider).toBe('vercel');
    expect(JSON.stringify(config.context)).not.toContain(env.VERCEL_TOKEN);
    expect(Object.isFrozen(config.context)).toBe(true);
  });
  it.each([
    { authorized: false },
    { maxCost: 0 },
    { maxRequests: 16 },
    { environment: 'production' },
    { approval: { ...campaign.approval, approvedBy: '' } },
  ])('rejects an unusable admission policy %j', (patch) => {
    writeFileSync(path, JSON.stringify({ ...campaign, ...patch }));
    expect(() =>
      loadSandboxConfiguration(env, true, campaign.candidate.commit),
    ).toThrow();
  });
  it('allows restart after expiry so inspection and DB can deny admission while recovery continues', () => {
    writeFileSync(
      path,
      JSON.stringify({ ...campaign, expiresAt: '2026-01-02T00:00:00Z' }),
    );
    expect(
      loadSandboxConfiguration(env, false, campaign.candidate.commit)?.context
        .provider,
    ).toBe('vercel');
    expect(
      loadSandboxConfiguration(env, true, campaign.candidate.commit)?.context
        .expiresAt,
    ).toBe('2026-01-02T00:00:00Z');
  });
  it('rejects destination and release substitution', () => {
    expect(() =>
      loadSandboxConfiguration(
        { ...env, SANDBOX_TEAM_ID: 'team_other' },
        true,
        campaign.candidate.commit,
      ),
    ).toThrow();
    expect(() => loadSandboxConfiguration(env, true, 'c'.repeat(40))).toThrow();
  });
  it('allows preproduction only with the approved destination and fixed quotas', () => {
    const remote = {
      ...env,
      ENVIRONMENT: 'preproduction',
      RELEASE_ID: campaign.candidate.commit,
      APP_ORIGIN: 'https://web.alunza.invalid',
      DATABASE_URL:
        'postgresql://alunza_app.projectref:unit-only@db.alunza.invalid:5432/postgres',
      DATABASE_SSL_CA: rootCertificates[0],
      SUPABASE_JWKS_URL:
        'https://projectref.supabase.co/auth/v1/.well-known/jwks.json',
      SUPABASE_JWT_ISSUER: 'https://projectref.supabase.co/auth/v1',
      PRACTICE_RUNNER_PROVIDER: 'vercel',
      PRACTICE_RUNNER_ENABLED: 'true',
    };
    expect(loadConfig(remote).sandboxConfiguration?.context.campaignId).toBe(
      campaign.campaignId,
    );
    expect(() => loadConfig({ ...remote, ENVIRONMENT: 'production' })).toThrow(
      'PRACTICE_RUNNER_PROVIDER',
    );
    expect(() =>
      loadConfig({ ...remote, PRACTICE_ACTOR_REQUESTS_PER_MINUTE: '100' }),
    ).toThrow('PRACTICE_QUOTAS');
    expect(() => loadConfig({ ...remote, VERCEL_TOKEN: undefined })).toThrow(
      'SANDBOX_CONFIGURATION',
    );
  });
});
