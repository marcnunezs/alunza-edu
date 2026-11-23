import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ENDPOINTS } from '../../scripts/linux-vm-browser-contract.mjs';
import {
  validateHelpManifest,
  loadHelpManifest,
  control,
} from '../../scripts/linux-vm-help-contract.mjs';

const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64);
const base = '/home/alunza/laboratorio/help-campaign';
function manifest() {
  return {
    schemaVersion: 1,
    profile: 'PHYSICAL_HELP_TEST',
    campaignId: id(1),
    candidate: {
      runnerVersion: 'imp-03-quickjs.13',
      capsuleImageId:
        'sha256:1f12d0fb7fb18f6e2668669b3b5da37be47fcc71120f7579dbe32155ad5846b0',
      runnerSourceDigest:
        '4782224f79163235b3f554b140b2ca40750b51b42dc61695964f7fca3f788fa3',
      kitManifestSha256: hash,
      guestSha256: hash,
      apiSourceDigest: hash,
      brokerSha256: hash,
    },
    webSourceDigest: hash,
    endpoints: { ...ENDPOINTS },
    controlKey: hash,
    outputDir: resolve('.local/offline-help-contract'),
    statePath: '/home/alunza/laboratorio/frozen/runtime.json',
    brokerSocket: '/run/user/1000/help/broker.sock',
    artifactRoot: '/home/alunza/laboratorio/frozen/workspace',
    controlDir: base + '/control',
    faultPath: base + '/fault.json',
    scopesPath: base + '/scopes.json',
    providerObservationsPath: base + '/providers.jsonl',
  };
}
afterEach(() => jest.restoreAllMocks());
describe('physical help manifest selects frozen TEST artifacts and separate private controls', () => {
  it('accepts the explicit .13 profile with fixed loopback destinations and independent paths', () => {
    const value = manifest();
    expect(validateHelpManifest(value)).toBe(value);
  });
  it.each(['PHYSICAL_BROWSER_TEST', 'production', '', null])(
    'rejects unrelated profile %j',
    (profile) => {
      expect(() => validateHelpManifest({ ...manifest(), profile })).toThrow(
        'HELP_PROFILE_REQUIRED',
      );
    },
  );
  it.each(['web', 'api', 'apiReplica', 'auth', 'control'])(
    'rejects an alternate %s destination before any network request',
    async (key) => {
      const value = manifest();
      value.endpoints[key] = 'http://192.168.1.20:4302';
      const fetch = jest.spyOn(globalThis, 'fetch');
      await expect(control(value, 'inspect')).rejects.toThrow(
        'LOOPBACK_ENDPOINTS_REQUIRED',
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('does not accept localhost aliases, additional endpoints or URL credentials', () => {
    for (const patch of [
      { control: 'http://localhost:4302' },
      { control: 'http://fixture@127.0.0.1:4302' },
      { extra: 'http://127.0.0.1:4303' },
    ])
      expect(() =>
        validateHelpManifest({
          ...manifest(),
          endpoints: { ...ENDPOINTS, ...patch },
        }),
      ).toThrow('LOOPBACK_ENDPOINTS_REQUIRED');
  });
  it.each([
    'runnerVersion',
    'capsuleImageId',
    'runnerSourceDigest',
    'kitManifestSha256',
    'guestSha256',
    'apiSourceDigest',
    'brokerSha256',
  ])('rejects missing or malformed candidate pin %s', (key) => {
    const value = manifest();
    value.candidate[key] = 'unverified';
    expect(() => validateHelpManifest(value)).toThrow(
      'CANDIDATE_PINS_REQUIRED',
    );
  });
  it.each([
    'artifactRoot',
    'controlDir',
    'faultPath',
    'scopesPath',
    'providerObservationsPath',
  ])('rejects unsafe/noncanonical path in %s', (key) => {
    for (const path of [
      undefined,
      'relative.json',
      '/tmp/other.json',
      '/home/alunza/laboratorio/help/../old',
      '/home/alunza/laboratorio//help/file',
      '/home/alunza/laboratorio/help/file/',
    ])
      expect(() =>
        validateHelpManifest({ ...manifest(), [key]: path }),
      ).toThrow('HELP_PRIVATE_PATH');
  });
  it('rejects writable controls that alias each other or leave the campaign directory', () => {
    for (const patch of [
      { faultPath: manifest().scopesPath },
      { scopesPath: manifest().controlDir },
      {
        providerObservationsPath:
          '/home/alunza/laboratorio/elsewhere/providers.jsonl',
      },
    ])
      expect(() => validateHelpManifest({ ...manifest(), ...patch })).toThrow(
        'HELP_PATH_ISOLATION',
      );
  });
  it('rejects both nesting directions and equality with the frozen artifact directory', () => {
    for (const artifactRoot of [base, base + '/workspace'])
      expect(() =>
        validateHelpManifest({ ...manifest(), artifactRoot }),
      ).toThrow('HELP_PATH_ISOLATION');
    const nested = manifest();
    nested.artifactRoot = base;
    for (const key of [
      'controlDir',
      'faultPath',
      'scopesPath',
      'providerObservationsPath',
    ])
      nested[key] = nested[key].replace(base, base + '/new-campaign');
    expect(() => validateHelpManifest(nested)).toThrow('HELP_PATH_ISOLATION');
  });
  it('rejects a trailing-separator alias that could otherwise place new evidence inside frozen artifacts', () => {
    expect(() =>
      validateHelpManifest({ ...manifest(), artifactRoot: base + '/' }),
    ).toThrow();
  });
  it('rejects missing identity, invalid control secret and relative evidence paths', () => {
    for (const patch of [
      { campaignId: 'not-a-uuid' },
      { webSourceDigest: 'missing' },
      { controlKey: 'short' },
      { outputDir: 'relative' },
    ])
      expect(() => validateHelpManifest({ ...manifest(), ...patch })).toThrow();
  });
  it('loads only a regular private manifest and validates its contents', async () => {
    const dir = resolve(await mkdtemp(join(tmpdir(), 'alunza-help-contract-')));
    const relativePath = relative(resolve(tmpdir()), dir);
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    )
      throw new Error('TEMP_PATH_UNSAFE');
    const file = join(dir, 'manifest.json');
    try {
      await writeFile(file, JSON.stringify(manifest()), {
        mode: 0o600,
        flag: 'wx',
      });
      expect(await loadHelpManifest(file)).toEqual(manifest());
      await expect(loadHelpManifest(dir)).rejects.toThrow(
        'PRIVATE_FILE_REQUIRED',
      );
      await writeFile(
        file,
        JSON.stringify({ ...manifest(), profile: 'production' }),
      );
      await expect(loadHelpManifest(file)).rejects.toThrow(
        'HELP_PROFILE_REQUIRED',
      );
    } finally {
      await unlink(file);
      await rmdir(dir);
    }
  });
});
describe('operator client rejects unsafe requests and unbound responses', () => {
  const response = (patch = {}) => ({
    campaignId: id(1),
    ok: true,
    data: { pass: true },
    ...patch,
  });
  const mockResponse = (body, status = 200) =>
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ status, text: async () => JSON.stringify(body) });
  it.each([
    ['deploy', {}],
    ['barrier-arm', {}],
    ['fault', null],
    ['fault', []],
    ['inspect', 'input'],
  ])(
    'rejects action %s and malformed input before dispatch',
    async (action, input) => {
      const fetch = jest.spyOn(globalThis, 'fetch');
      await expect(control(manifest(), action, input)).rejects.toThrow(
        'HELP_ACTION_REJECTED',
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('uses only the fixed operator origin with authenticated JSON, disabled redirects and bounded timeout', async () => {
    const fetch = mockResponse(response());
    const input = { scope: 'H01' };
    expect(await control(manifest(), 'prepare', input)).toEqual({ pass: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:4302/task');
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers).toEqual({
      'content-type': 'application/json',
      'x-alunza-control-key': hash,
    });
    expect(JSON.parse(options.body)).toEqual({
      campaignId: id(1),
      action: 'prepare',
      input,
    });
  });
  it.each([301, 401, 403, 500])(
    'rejects HTTP status %s without exposing the response body',
    async (status) => {
      const text = jest.fn(async () => 'private failure detail');
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({ status, text });
      await expect(control(manifest(), 'inspect')).rejects.toThrow(
        'HELP_CONTROL_FAILED',
      );
      expect(text).not.toHaveBeenCalled();
    },
  );
  it.each([{ campaignId: id(99) }, { ok: false }, { ok: 'true' }])(
    'rejects a response from another campaign or failed envelope %j',
    async (patch) => {
      mockResponse(response(patch));
      await expect(control(manifest(), 'inspect')).rejects.toThrow(
        'HELP_CONTROL_ENVELOPE',
      );
    },
  );
  it('requires a data field and enforces the bounded response size', async () => {
    const fetch = mockResponse({ campaignId: id(1), ok: true });
    await expect(control(manifest(), 'inspect')).rejects.toThrow(
      'HELP_CONTROL_ENVELOPE',
    );
    fetch.mockResolvedValue({
      status: 200,
      text: async () => 'x'.repeat(2 * 1024 * 1024 + 1),
    });
    await expect(control(manifest(), 'inspect')).rejects.toThrow(
      'HELP_CONTROL_SIZE',
    );
  });
});
