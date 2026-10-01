import { describe, test, expect, jest } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import {
  loadManifest,
  validateManifest,
  assertRemoteAuthorization,
  requestBudget,
} from '../../scripts/preprod-manifest.mjs';
import { preparationStatus, publicParameters } from '../../scripts/preprod.mjs';
import { runSmoke } from '../../scripts/preprod-smoke.mjs';
import { preparedManifest, smokeEnv } from './fixture.mjs';

describe('remote operation boundary', () => {
  test('checked-in example is valid but denies all remote work', async () => {
    const manifest = await loadManifest(
      new URL(
        '../../infra/preproduction/manifest.example.json',
        import.meta.url,
      ),
    );
    expect(manifest.remote.enabled).toBe(false);
    expect(
      preparationStatus(manifest).every((item) => item.status === 'pending'),
    ).toBe(true);
    const transport = jest.fn();
    await expect(runSmoke(manifest, smokeEnv, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  test.each([
    'expired',
    'not-yet-valid',
    'zero-budget',
    'not-permitted',
    'missing-target',
    'wrong-image-registry',
  ])('%s fails before transport', async (condition) => {
    const manifest = await preparedManifest();
    if (condition === 'expired')
      manifest.remote.expiresAt = new Date(Date.now() - 1).toISOString();
    if (condition === 'not-yet-valid')
      manifest.remote.approvedAt = new Date(Date.now() + 60000).toISOString();
    if (condition === 'zero-budget') manifest.budget.maxCost = 0;
    if (condition === 'not-permitted')
      manifest.remote.allowedOperations = ['probe:ai'];
    if (condition === 'missing-target') manifest.targets.azure.apiOrigin = null;
    if (condition === 'wrong-image-registry')
      manifest.release.apiImage = `other.azurecr.io/api@sha256:${'a'.repeat(64)}`;
    const transport = jest.fn();
    await expect(runSmoke(manifest, smokeEnv, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  test('arbitrary fields cannot smuggle secrets into a manifest', async () => {
    const manifest = await preparedManifest();
    manifest.targets.supabase.serviceRoleKey = 'sensitive';
    expect(() => validateManifest(manifest)).toThrow();
  });
  test('target and Supabase project are pinned together', async () => {
    const manifest = await preparedManifest();
    manifest.targets.supabase.authUrl =
      'https://bbbbbbbbbbbbbbbbbbbb.supabase.co';
    expect(() => validateManifest(manifest)).toThrow();
  });
  test('Azure deployment authorization never authorizes Supabase bootstrap', async () => {
    const manifest = await preparedManifest();
    manifest.remote.allowedOperations = ['azure:deploy'];
    expect(() =>
      assertRemoteAuthorization(manifest, 'azure:deploy'),
    ).not.toThrow();
    expect(() =>
      assertRemoteAuthorization(manifest, 'supabase:bootstrap'),
    ).toThrow();
    manifest.remote.allowedOperations = ['supabase:bootstrap'];
    expect(() =>
      assertRemoteAuthorization(manifest, 'supabase:bootstrap'),
    ).not.toThrow();
    manifest.targets.supabase.projectRef = null;
    expect(() =>
      assertRemoteAuthorization(manifest, 'supabase:bootstrap'),
    ).toThrow();
  });
  test('budget stops dispatch at the count and deadline', async () => {
    const manifest = await preparedManifest();
    manifest.budget.maxHttpRequests = 1;
    let now = Date.now();
    const budget = requestBudget(manifest, 'smoke:web-api', () => now);
    expect(budget.consume()).toBeGreaterThan(0);
    expect(() => budget.consume()).toThrow();
    const expired = requestBudget(manifest, 'smoke:web-api', () => now);
    now += 3600000;
    expect(() => expired.consume()).toThrow();
  });
  test('preparation cannot declare enough budget when assay cleanup is impossible', async () => {
    const manifest = await preparedManifest();
    manifest.budget.maxHttpRequests = 6;
    const statuses = preparationStatus(manifest);
    expect(
      statuses.find((item) => item.operation === 'smoke:web-api').status,
    ).toBe('pending');
    expect(
      statuses.find((item) => item.operation === 'probe:sandbox').status,
    ).toBe('pending');
  });
  test('bootstrap parameters omit credentials and workload creation defaults off', async () => {
    const manifest = await preparedManifest();
    manifest.targets.azure.apiOrigin = null;
    manifest.release.apiImage = null;
    expect(() =>
      assertRemoteAuthorization(manifest, 'azure:deploy'),
    ).not.toThrow();
    const output = publicParameters(manifest);
    expect(() => publicParameters(manifest, true)).toThrow();
    expect(output.parameters.deployWorkloads.value).toBe(false);
    expect(output.parameters.databaseUrl).toBeUndefined();
    expect(output.parameters.databaseSslCa).toBeUndefined();
    manifest.remote.enabled = false;
    manifest.remote.allowedOperations = [];
    expect(() => publicParameters(manifest)).not.toThrow();
    expect(() => publicParameters(manifest, true)).toThrow();
  });
  test('deployable Job has manual activation and no retries; API has real HTTP probes', async () => {
    const template = await readFile(
      new URL('../../infra/preproduction/main.bicep', import.meta.url),
      'utf8',
    );
    expect(template).toContain("triggerType: 'Manual'");
    expect(template).toContain('replicaRetryLimit: 0');
    expect(template).toContain("name: '${identityName}-probes'");
    expect(template).toContain(
      "jobOperation == 'probe:sandbox' ? [{ name: 'vercel-token'",
    );
    expect(template).toContain("path: '/health/ready'");
    expect(template).toContain("path: '/health/live'");
    expect(template).toContain(
      "{ name: 'DATABASE_SSL_CA', secretRef: 'database-ca' }",
    );
  });
});
