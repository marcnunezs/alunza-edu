import { beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  admissionHeaders,
  browserLanePlan,
  browserObservation,
  installBrowserProbe,
  readPaintedFeedback,
  saveBrowserObservation,
} from '../../scripts/evaluation-browser-driver.mjs';
import { sha256 } from '../../scripts/evaluation-client.mjs';

const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = 'a'.repeat(64);
const directory = resolve('.local/tmp', `browser-driver-test-${randomUUID()}`);
beforeAll(async () => {
  await mkdir(directory, { recursive: true });
});
function fixture() {
  return {
    identity: {
      version: 1,
      producer: 'CHROME_CDP',
      browserVersion: 'Chrome/unit',
      webSourceDigest: hash,
      runId: id(1),
      provider: 'TEST',
      corpusHash: hash,
      candidateFingerprint: hash,
    },
    context: {
      apiOrigin: 'http://127.0.0.1:4300',
      binding: { id: id(2), actorId: id(3), attemptId: id(4) },
      kind: 'HINT',
      hintLevel: 1,
      profile: 'serial',
      operationKey: id(5),
      request: { id: id(6) },
      feedback: {
        id: id(7),
        help: {
          status: 'SUPPORTED',
          explanation: 'Authored source explanation.',
          hint: 'Review the return statement.',
        },
      },
    },
    painted: {
      start: 100,
      timeOrigin: Date.parse('2026-11-18T10:00:00Z'),
      parsed: 1098,
      visible: 1100,
      trusted: true,
      postCount: 1,
      domIdentityMatched: true,
      documentVisible: true,
      geometryVisible: true,
      status: 'SUPPORTED',
      explanation: 'Authored source explanation.',
      hint: 'Review the return statement.',
      paintFrames: 2,
    },
  };
}
describe('real browser producer boundaries without starting Chrome or services', () => {
  it('keeps every actor in one lane, serial at one and concurrent at four', () => {
    const prepared = {
      cases: ['serial', 'concurrent'].flatMap((profile, p) =>
        Array.from({ length: 25 }, (_, i) => ({
          profile,
          binding: { id: id(100 + p * 25 + i), actorId: id(200 + (i % 8)) },
        })),
      ),
    };
    const lanes = browserLanePlan(prepared);
    for (const profile of ['serial', 'concurrent']) {
      const actors = new Map();
      for (const entry of prepared.cases.filter(
        (entry) => entry.profile === profile,
      )) {
        const lane = lanes.get(`${profile}:${entry.binding.id}`);
        expect(lane).toBeGreaterThanOrEqual(0);
        expect(lane).toBeLessThan(profile === 'serial' ? 1 : 4);
        if (actors.has(entry.binding.actorId))
          expect(lane).toBe(actors.get(entry.binding.actorId));
        actors.set(entry.binding.actorId, lane);
      }
      expect(new Set(actors.values()).size).toBe(profile === 'serial' ? 1 : 4);
    }
  });
  it('reuses the durable key for exactly the genuine intended POST without changing its body or authorization', () => {
    const { context } = fixture();
    const request = {
      method: 'POST',
      url: `${context.apiOrigin}/api/v1/attempts/${context.binding.attemptId}/feedback-requests`,
      postData: '{"kind":"HINT","hintLevel":1}',
      headers: {
        Authorization: 'Bearer PRIVATE_SESSION',
        'idempotency-key': 'browser-generated',
        'Content-Type': 'application/json',
      },
    };
    const before = JSON.stringify(request),
      headers = admissionHeaders(request, context, 1);
    expect(
      headers.filter(
        (header) => header.name.toLowerCase() === 'idempotency-key',
      ),
    ).toEqual([{ name: 'Idempotency-Key', value: context.operationKey }]);
    expect(
      headers.find((header) => header.name === 'Authorization').value,
    ).toBe('Bearer PRIVATE_SESSION');
    expect(JSON.stringify(request)).toBe(before);
    expect(
      admissionHeaders(
        { ...request, method: 'OPTIONS', postData: undefined },
        context,
        1,
      ),
    ).toBeNull();
    for (const change of [
      { method: 'GET' },
      { url: 'https://foreign.invalid/request' },
      { postData: '{"kind":"HINT","hintLevel":2}' },
      { postData: '{"kind":"HINT","hintLevel":1,"extra":true}' },
      { postData: 'invalid' },
    ])
      expect(() =>
        admissionHeaders({ ...request, ...change }, context, 1),
      ).toThrow('DISPATCH_REJECTED');
    expect(() => admissionHeaders(request, context, 2)).toThrow(
      'DISPATCH_REJECTED',
    );
  });
  it('observes actual JSON parsing and a trusted click without producing additional requests or substitute responses', async () => {
    const { context } = fixture(),
      listeners = new Map(),
      calls = [];
    let tick = 100;
    class Element {
      closest() {
        return this;
      }
    }
    const response = {
      status: 202,
      json: async () => ({ data: context.request }),
    };
    const original = async (...args) => {
      calls.push(args);
      return response;
    };
    const win = {
      fetch: original,
      performance: { timeOrigin: 1000, now: () => tick },
      location: { href: 'http://127.0.0.1:3300/' },
      URL,
      Element,
    };
    const document = {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
    };
    runInNewContext(`(${installBrowserProbe.toString()})(input)`, {
      window: win,
      document,
      URL,
      input: {
        attemptId: context.binding.attemptId,
        apiOrigin: context.apiOrigin,
        buttonSelector: 'button',
      },
    });
    listeners.get('click')({ isTrusted: false, target: new Element() });
    expect(win.__alunzaEvaluationProbe.start).toBeNull();
    listeners.get('click')({ isTrusted: true, target: new Element() });
    expect(win.__alunzaEvaluationProbe.start).toBe(100);
    const received = await win.fetch(
      `${context.apiOrigin}/api/v1/attempts/${context.binding.attemptId}/feedback-requests`,
      { method: 'POST' },
    );
    expect(received).toBe(response);
    expect(win.__alunzaEvaluationProbe.request).toBeNull();
    expect((await received.json()).data).toBe(context.request);
    expect(win.__alunzaEvaluationProbe.request).toBe(context.request);
    expect(calls).toHaveLength(1);
    expect(win.__alunzaEvaluationProbe.postCount).toBe(1);
    tick = 500;
    listeners.get('click')({ isTrusted: true, target: new Element() });
    expect(win.__alunzaEvaluationProbe.start).toBe(100);
    win.__alunzaEvaluationProbe.dispose();
    expect(win.fetch).toBe(original);
    expect(listeners.size).toBe(0);
  });
  it('correlates complete evidence from one monotonic clock and persists only hashes of content', () => {
    const { identity, context, painted } = fixture();
    const result = browserObservation(
      { ...identity, secret: 'PRIVATE_KEY' },
      { ...context, session: 'PRIVATE_SESSION' },
      painted,
    );
    expect(result).toMatchObject({
      version: 1,
      producer: 'CHROME_CDP',
      operationKeyHash: sha256(context.operationKey),
      observation: 'COMPLETE',
      failureCode: null,
      actionToVisibleMs: 1000,
      requestToParsedFeedbackMs: 998,
      paintFrames: 2,
      requestId: context.request.id,
      feedbackId: context.feedback.id,
      explanationHash: sha256(painted.explanation),
      hintHash: sha256(painted.hint),
    });
    expect(Date.parse(result.visibleAt) - Date.parse(result.startedAt)).toBe(
      result.actionToVisibleMs,
    );
    const text = JSON.stringify(result);
    for (const value of [
      'PRIVATE_',
      context.operationKey,
      painted.explanation,
      painted.hint,
      'presentationToken',
      'access_token',
    ])
      expect(text).not.toContain(value);
  });
  it.each([
    ['synthetic click', { trusted: false }],
    ['second POST', { postCount: 2 }],
    ['hidden document', { documentVisible: false }],
    ['occluded content', { geometryVisible: false }],
    ['wrong identity', { domIdentityMatched: false }],
    ['no paint', { paintFrames: 0 }],
    ['wrong status', { status: 'NO_EVIDENCE' }],
    ['wrong content', { explanation: 'substituted' }],
    ['clock reversal', { parsed: 50 }],
    ['unparsed response', { parsed: null }],
  ])('does not credit %s as a complete rendering', (_name, change) => {
    const { identity, context, painted } = fixture();
    expect(
      browserObservation(identity, context, { ...painted, ...change }),
    ).toMatchObject({
      observation: 'INCOMPLETE',
      failureCode: 'BROWSER_FEEDBACK_RENDER_MISMATCH',
    });
  });
  it('keeps an interrupted observation unknown rather than zero and retains only known identities', () => {
    const { identity, context } = fixture();
    delete context.feedback;
    expect(
      browserObservation(identity, context, null, 'BROWSER_PAGE_SCRIPT_FAILED'),
    ).toMatchObject({
      observation: 'INCOMPLETE',
      requestId: context.request.id,
      feedbackId: null,
      actionToVisibleMs: null,
      requestToParsedFeedbackMs: null,
      visibleAt: null,
      startedAt: null,
      paintFrames: 0,
    });
  });
  it('writes an exclusive verifiable receipt and preserves it against replay overwrite', async () => {
    const { identity, context, painted } = fixture();
    const observation = browserObservation(identity, context, painted);
    const artifact = await saveBrowserObservation(directory, observation);
    const text = await readFile(join(directory, artifact.file), 'utf8');
    expect(artifact).toEqual({
      file: `browser-observations/${sha256(context.operationKey)}.json`,
      sha256: sha256(text),
    });
    expect(JSON.parse(text)).toEqual(observation);
    await expect(
      saveBrowserObservation(directory, {
        ...observation,
        actionToVisibleMs: 1,
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(directory, artifact.file), 'utf8')).toBe(text);
    await expect(
      saveBrowserObservation(directory, {
        ...observation,
        operationKeyHash: '../foreign',
      }),
    ).rejects.toThrow('KEY_INVALID');
  });
  it('waits for two paint frames, reads real detail identity/text and detects an occluding node', async () => {
    const { context, painted } = fixture();
    let frames = 0,
      occluded = false;
    const node = (y, text = '') => ({
      isConnected: true,
      hidden: false,
      parentElement: null,
      textContent: text,
      getBoundingClientRect: () => ({
        left: 0,
        top: y,
        right: 200,
        bottom: y + 20,
        width: 200,
        height: 20,
      }),
      contains(other) {
        return other === this;
      },
    });
    const status = node(10),
      explanation = node(40, painted.explanation),
      hint = node(70, painted.hint);
    status.dataset = { status: 'SUPPORTED' };
    const detail = {
      dataset: {
        attemptId: context.binding.attemptId,
        requestId: context.request.id,
        feedbackId: context.feedback.id,
        kind: context.kind,
        hintLevel: '1',
      },
      scrollIntoView() {},
      querySelector(query) {
        return query.includes('status')
          ? status
          : query.includes('explanation')
            ? explanation
            : hint;
      },
    };
    const document = {
      visibilityState: 'visible',
      querySelector: () => detail,
      elementFromPoint: (_x, y) =>
        occluded ? {} : y < 35 ? status : y < 65 ? explanation : hint,
    };
    const window = {
      __alunzaEvaluationProbe: {
        start: 100,
        timeOrigin: 1000,
        parsedAt: 1098,
        trusted: true,
        postCount: 1,
      },
      requestAnimationFrame(callback) {
        frames++;
        callback();
      },
      performance: { now: () => 1100 },
      innerHeight: 900,
      innerWidth: 1440,
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      }),
    };
    const input = {
      attemptId: context.binding.attemptId,
      requestId: context.request.id,
      feedbackId: context.feedback.id,
      kind: context.kind,
      hintLevel: 1,
    };
    const observe = () =>
      runInNewContext(`(${readPaintedFeedback.toString()})(input)`, {
        window,
        document,
        input,
      });
    expect(await observe()).toMatchObject({
      geometryVisible: true,
      domIdentityMatched: true,
      documentVisible: true,
      paintFrames: 2,
      explanation: painted.explanation,
      hint: painted.hint,
    });
    expect(frames).toBe(2);
    occluded = true;
    expect((await observe()).geometryVisible).toBe(false);
    document.visibilityState = 'hidden';
    expect((await observe()).documentVisible).toBe(false);
    detail.dataset.requestId = id(999);
    expect((await observe()).domIdentityMatched).toBe(false);
  });
});
