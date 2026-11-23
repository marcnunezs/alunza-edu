import { describe, expect, test } from '@jest/globals';
import {
  testTarget,
  physicalTestTarget,
  assertLocalTarget,
  assertRuntimeTarget,
  targetFor,
} from '../../scripts/local-target.mjs';
import laboratory from '../laboratory-test-state.cjs';

const state = (projectId = physicalTestTarget.projectId) => ({
  projectId,
  authUrl: 'http://127.0.0.1:18421',
  migrationUrl: 'postgresql://postgres:fixture@127.0.0.1:18422/postgres',
});

describe('isolated physical TEST destination', () => {
  test('explicit target preserves old Docker identities and fixed TEST ports', () => {
    expect(targetFor({ test: true })).toBe(testTarget);
    expect(targetFor({ test: true, physicalTest: true })).toBe(
      physicalTestTarget,
    );
    expect(physicalTestTarget.projectId).not.toBe(testTarget.projectId);
    expect(physicalTestTarget.networkName).not.toBe(testTarget.networkName);
    expect(physicalTestTarget.apiUrl).toBe(testTarget.apiUrl);
    expect(() => assertLocalTarget(physicalTestTarget)).not.toThrow();
    expect(() =>
      assertRuntimeTarget(state(), physicalTestTarget),
    ).not.toThrow();
    expect(() => laboratory.assertLaboratoryTestState(state())).not.toThrow();
  });
  test('copied old credentials, arbitrary labels and remote destinations fail closed', () => {
    expect(() =>
      assertRuntimeTarget(state(testTarget.projectId), physicalTestTarget),
    ).toThrow();
    expect(() =>
      assertLocalTarget({
        ...physicalTestTarget,
        networkName: testTarget.networkName,
      }),
    ).toThrow();
    expect(() =>
      assertLocalTarget({ ...physicalTestTarget, evaluation: true }),
    ).toThrow();
    expect(() =>
      laboratory.assertLaboratoryTestState(state('other-test')),
    ).toThrow();
    for (const mutation of [
      { authUrl: 'https://example.invalid' },
      {
        migrationUrl:
          'postgresql://postgres:fixture@192.168.1.20:18422/postgres',
      },
      {
        migrationUrl: 'postgresql://postgres:fixture@127.0.0.1:17422/postgres',
      },
    ]) {
      expect(() =>
        laboratory.assertLaboratoryTestState({ ...state(), ...mutation }),
      ).toThrow();
      expect(() =>
        assertRuntimeTarget({ ...state(), ...mutation }, physicalTestTarget),
      ).toThrow();
    }
  });
});
