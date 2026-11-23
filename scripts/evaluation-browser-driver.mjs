// Real Chrome pages only. No provider calls, fake DOM, screenshots or CDP trace files.
// Protocol: https://chromedevtools.github.io/devtools-protocol/tot/
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './local.mjs';
import {
  candidateFingerprint,
  evaluationPlanSchema,
} from './evaluation-manifest.mjs';
import { EvaluationError, sha256 } from './evaluation-client.mjs';
import {
  helpFeedbackResponseSchema,
  helpRequestResponseSchema,
  attemptResponseSchema,
} from '@alunza/contracts';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const demand = (value, code) => {
  if (!value) throw new EvaluationError(code);
};
const rounded = (value) => Math.round(value * 100) / 100;
const selector = (name) => `[data-cy="${name}"]`;
async function until(probe, code, timeout = 45000) {
  const end = Date.now() + timeout;
  do {
    const value = await probe();
    if (value) return value;
    await delay(50);
  } while (Date.now() < end);
  throw new EvaluationError(code);
}

export function browserLanePlan(prepared) {
  const lanes = new Map();
  for (const profile of ['serial', 'concurrent']) {
    const actors = new Map();
    for (const entry of prepared.cases.filter(
      (entry) => entry.profile === profile,
    )) {
      if (!actors.has(entry.binding.actorId))
        actors.set(
          entry.binding.actorId,
          actors.size % (profile === 'serial' ? 1 : 4),
        );
      lanes.set(
        `${profile}:${entry.binding.id}`,
        actors.get(entry.binding.actorId),
      );
    }
  }
  return lanes;
}

export function admissionHeaders(request, context, dispatchedCount) {
  if (
    request.method === 'OPTIONS' &&
    request.url ===
      `${context.apiOrigin}/api/v1/attempts/${context.binding.attemptId}/feedback-requests`
  )
    return null;
  const expected = {
    kind: context.kind,
    ...(context.hintLevel ? { hintLevel: context.hintLevel } : {}),
  };
  let body;
  try {
    body = JSON.parse(request.postData);
  } catch {
    /* Fixed error below. */
  }
  demand(
    dispatchedCount === 1 &&
      request.method === 'POST' &&
      request.url ===
        `${context.apiOrigin}/api/v1/attempts/${context.binding.attemptId}/feedback-requests` &&
      body &&
      Object.keys(body).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => body[key] === value) &&
      UUID.test(context.operationKey),
    'BROWSER_HELP_DISPATCH_REJECTED',
  );
  const headers = Object.entries(request.headers)
    .filter(([name]) => name.toLowerCase() !== 'idempotency-key')
    .map(([name, value]) => ({ name, value: String(value) }));
  headers.push({ name: 'Idempotency-Key', value: context.operationKey });
  return headers;
}

// Runs in the genuine product page. Observes fetch JSON parsing and trusted
// button clicks; never supplies responses, changes content or creates DOM nodes.
export function installBrowserProbe({ attemptId, apiOrigin, buttonSelector }) {
  window.__alunzaEvaluationProbe?.dispose();
  const original = window.fetch;
  const probe = {
    attemptId,
    start: null,
    timeOrigin: window.performance.timeOrigin,
    postCount: 0,
    request: null,
    completed: null,
    feedback: null,
    parsedAt: null,
    httpStatus: null,
    trusted: false,
  };
  const clicked = (event) => {
    if (
      event.isTrusted &&
      event.target instanceof window.Element &&
      event.target.closest(buttonSelector)
    ) {
      if (probe.start === null) {
        probe.start = window.performance.now();
        probe.trusted = true;
      }
    }
  };
  document.addEventListener('click', clicked, true);
  window.fetch = async (...args) => {
    const input = args[0],
      options = args[1];
    const url = new URL(
      typeof input === 'string' || input instanceof window.URL
        ? String(input)
        : input.url,
      window.location.href,
    );
    const method = String(
      options?.method ?? input?.method ?? 'GET',
    ).toUpperCase();
    const isHelp =
      url.href ===
        `${apiOrigin}/api/v1/attempts/${attemptId}/feedback-requests` &&
      method === 'POST';
    if (isHelp) probe.postCount++;
    const response = await original(...args);
    if (url.origin !== apiOrigin) return response;
    const read = response.json.bind(response);
    response.json = async () => {
      const value = await read();
      if (isHelp) {
        probe.httpStatus = response.status;
        if (response.status === 202) probe.request = value.data;
      }
      if (
        probe.request &&
        url.pathname === `/api/v1/feedback-requests/${probe.request.id}` &&
        ['SUCCEEDED', 'FAILED'].includes(value.data?.state)
      )
        probe.completed = value.data;
      if (
        probe.request &&
        method === 'GET' &&
        /^\/api\/v1\/feedback\/[a-f0-9-]+$/i.test(url.pathname) &&
        value.data?.requestId === probe.request.id
      ) {
        probe.feedback = value.data;
        probe.parsedAt ??= window.performance.now();
      }
      return value;
    };
    return response;
  };
  probe.dispose = () => {
    window.fetch = original;
    document.removeEventListener('click', clicked, true);
  };
  window.__alunzaEvaluationProbe = probe;
}

// A visibility observation of real content, after two animation frames. Geometry
// is checked again after paint so a hidden/removed/stale result cannot qualify.
export async function readPaintedFeedback({
  attemptId,
  requestId,
  feedbackId,
  kind,
  hintLevel,
}) {
  const probe = window.__alunzaEvaluationProbe;
  const detail = document.querySelector(
    `[data-cy="help-detail"][data-feedback-id="${feedbackId}"]`,
  );
  if (!probe || !detail) return null;
  detail.scrollIntoView({ block: 'start', behavior: 'instant' });
  await new Promise((done) =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(done)),
  );
  const isVisible = (element) => {
    if (
      !element ||
      !element.isConnected ||
      document.visibilityState !== 'visible'
    )
      return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = window.getComputedStyle(parent);
      if (
        style.display === 'none' ||
        style.visibility !== 'visible' ||
        Number(style.opacity) === 0 ||
        parent.hidden
      )
        return false;
    }
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= window.innerHeight ||
      rect.left >= window.innerWidth
    )
      return false;
    const x =
      (Math.max(0, rect.left) + Math.min(window.innerWidth, rect.right)) / 2;
    const y =
      (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2;
    const top = document.elementFromPoint(x, y);
    return top === element || element.contains(top);
  };
  const status = detail.querySelector('[data-cy="help-status"]');
  const explanation = detail.querySelector('[data-cy="help-explanation"]');
  const hint = detail.querySelector('[data-cy="help-hint"]');
  return {
    start: probe.start,
    timeOrigin: probe.timeOrigin,
    visible: window.performance.now(),
    parsed: probe.parsedAt,
    trusted: probe.trusted,
    postCount: probe.postCount,
    domIdentityMatched:
      detail.dataset.attemptId === attemptId &&
      detail.dataset.requestId === requestId &&
      detail.dataset.feedbackId === feedbackId &&
      detail.dataset.kind === kind &&
      detail.dataset.hintLevel === String(hintLevel ?? ''),
    documentVisible: document.visibilityState === 'visible',
    geometryVisible:
      isVisible(status) && isVisible(explanation) && (!hint || isVisible(hint)),
    status: status?.dataset.status ?? null,
    explanation: explanation?.textContent ?? '',
    hint: hint?.textContent ?? '',
    paintFrames: 2,
  };
}

export function browserObservation(
  identity,
  context,
  painted,
  failureCode = null,
) {
  if (
    !failureCode &&
    (!painted?.trusted ||
      painted.postCount !== 1 ||
      !painted.domIdentityMatched ||
      !painted.documentVisible ||
      !painted.geometryVisible ||
      !Number.isFinite(painted.start) ||
      !Number.isFinite(painted.timeOrigin) ||
      !Number.isFinite(painted.parsed) ||
      !Number.isFinite(painted.visible) ||
      painted.parsed < painted.start ||
      painted.visible < painted.parsed ||
      painted.paintFrames !== 2 ||
      painted.status !== context.feedback?.help.status ||
      painted.explanation !== context.feedback?.help.explanation ||
      painted.hint !== context.feedback?.help.hint)
  )
    failureCode = 'BROWSER_FEEDBACK_RENDER_MISMATCH';
  const known =
    painted &&
    Number.isFinite(painted.start) &&
    Number.isFinite(painted.timeOrigin);
  const visible = known && Number.isFinite(painted.visible);
  return {
    version: identity.version,
    producer: identity.producer,
    browserVersion: identity.browserVersion,
    webSourceDigest: identity.webSourceDigest,
    runId: identity.runId,
    provider: identity.provider,
    corpusHash: identity.corpusHash,
    candidateFingerprint: identity.candidateFingerprint,
    bindingId: context.binding.id,
    actorId: context.binding.actorId,
    attemptId: context.binding.attemptId,
    requestId: context.request?.id ?? null,
    feedbackId: context.feedback?.id ?? null,
    profile: context.profile,
    kind: context.kind,
    hintLevel: context.hintLevel ?? null,
    operationKeyHash: sha256(context.operationKey),
    startedAt: known
      ? new Date(painted.timeOrigin + painted.start).toISOString()
      : null,
    visibleAt: visible
      ? new Date(painted.timeOrigin + painted.visible).toISOString()
      : null,
    actionToVisibleMs: visible
      ? rounded(painted.visible - painted.start)
      : null,
    requestToParsedFeedbackMs:
      known && Number.isFinite(painted.parsed)
        ? rounded(painted.parsed - painted.start)
        : null,
    statusFromDom: painted?.status ?? null,
    explanationHash: painted ? sha256(painted.explanation) : null,
    hintHash: painted ? sha256(painted.hint) : null,
    domIdentityMatched: painted?.domIdentityMatched === true,
    documentVisible: painted?.documentVisible === true,
    geometryVisible: painted?.geometryVisible === true,
    paintFrames: painted?.paintFrames ?? 0,
    observation: failureCode ? 'INCOMPLETE' : 'COMPLETE',
    failureCode,
  };
}
export async function saveBrowserObservation(directory, observation) {
  demand(
    /^[a-f0-9]{64}$/.test(observation.operationKeyHash),
    'BROWSER_OBSERVATION_KEY_INVALID',
  );
  const folder = join(directory, 'browser-observations');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  demand(
    !(await lstat(folder)).isSymbolicLink() &&
      resolve(await realpath(folder)) === resolve(folder),
    'BROWSER_OBSERVATION_PATH_INVALID',
  );
  const file = `browser-observations/${observation.operationKeyHash}.json`;
  const text = JSON.stringify(observation, null, 2) + '\n';
  await writeFile(join(directory, file), text, { flag: 'wx', mode: 0o600 });
  return { file, sha256: sha256(text) };
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id) {
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        clearTimeout(task.timer);
        if (message.error)
          task.reject(new EvaluationError('BROWSER_CDP_COMMAND_FAILED'));
        else task.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    socket.addEventListener('close', () => {
      for (const task of this.pending.values()) {
        clearTimeout(task.timer);
        task.reject(new EvaluationError('BROWSER_CDP_CLOSED'));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new globalThis.WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new EvaluationError('BROWSER_CDP_CONNECT_TIMEOUT'));
      }, 10000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new EvaluationError('BROWSER_CDP_CONNECT_FAILED'));
        },
        { once: true },
      );
    });
    return new Cdp(socket);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EvaluationError('BROWSER_CDP_TIMEOUT'));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }
  listen(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}
async function evaluate(cdp, sessionId, expression) {
  const value = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  demand(!value.exceptionDetails, 'BROWSER_PAGE_SCRIPT_FAILED');
  return value.result?.value;
}
async function click(cdp, sessionId, query) {
  const point = await until(
    () =>
      evaluate(
        cdp,
        sessionId,
        `(() => {const e=document.querySelector(${JSON.stringify(query)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`,
      ),
    'BROWSER_CONTROL_NOT_READY',
    15000,
  );
  await cdp.send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', button: 'left', clickCount: 1, ...point },
    sessionId,
  );
  await cdp.send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', button: 'left', clickCount: 1, ...point },
    sessionId,
  );
}
async function chromeExecutable() {
  const options = [
    process.env.ALUNZA_CHROME_PATH,
    ...(process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          join(
            process.env.LOCALAPPDATA ?? '',
            'Google/Chrome/Application/chrome.exe',
          ),
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ]),
  ].filter(Boolean);
  for (const file of options) {
    if (/^(?:\\\\|\/\/)/u.test(file) || !isAbsolute(file)) continue;
    try {
      if ((await lstat(file)).isFile()) return file;
    } catch {
      /* Try another installed browser; never install one. */
    }
  }
  throw new EvaluationError('LOCAL_CHROME_NOT_FOUND');
}
async function webDigest() {
  const inventory = [];
  async function walk(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      demand(!entry.isSymbolicLink(), 'BROWSER_WEB_SOURCE_LINK');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        inventory.push({
          path: relative(root, path).split(sep).join('/'),
          sha256: sha256(await readFile(path)),
        });
    }
  }
  await walk(join(root, 'apps/web/src'));
  return sha256(JSON.stringify(inventory));
}

export async function createEvaluationBrowserDriver({
  plan,
  prepared,
  directory,
  state,
  webOrigin,
}) {
  evaluationPlanSchema.parse(plan);
  const expectedWeb =
    plan.environment === 'TEST'
      ? 'http://127.0.0.1:3300'
      : 'http://127.0.0.1:3400';
  demand(
    webOrigin === expectedWeb &&
      state.authUrl === plan.destination.authOrigin &&
      UUID.test(prepared.runId),
    'BROWSER_DESTINATION_MISMATCH',
  );
  const localDirectory = resolve(directory),
    prefix = join(root, '.local', 'eval-runs') + sep;
  demand(
    localDirectory.startsWith(prefix) &&
      resolve(await realpath(localDirectory)) === localDirectory,
    'BROWSER_DIRECTORY_OUT_OF_SCOPE',
  );
  demand(
    (await candidateFingerprint()) === plan.candidateFingerprint,
    'BROWSER_CANDIDATE_CHANGED',
  );
  const sourceDigest = await webDigest();
  const browserDirectory = join(
    localDirectory,
    `browser-runtime-${randomUUID()}`,
  );
  await mkdir(browserDirectory, { mode: 0o700 });
  const child = spawn(
    await chromeExecutable(),
    [
      '--headless=new',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${browserDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let childError = false;
  child.once('error', () => {
    childError = true;
  });
  let cdp;
  const pages = new Map(),
    busy = new Set(),
    lanes = browserLanePlan(prepared);
  let profileInUse = null,
    switching = Promise.resolve(),
    closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await cdp?.send('Browser.close');
    } catch {
      /* Child exit still checked below. */
    }
    cdp?.socket.close();
    if (child.exitCode === null && !childError) {
      await Promise.race([
        new Promise((done) => child.once('exit', done)),
        delay(10000),
      ]);
      if (child.exitCode === null) child.kill();
    }
  }
  try {
    const port = await until(async () => {
      demand(!childError && child.exitCode === null, 'BROWSER_LAUNCH_FAILED');
      try {
        const [number, path] = (
          await readFile(join(browserDirectory, 'DevToolsActivePort'), 'utf8')
        )
          .trim()
          .split(/\r?\n/);
        return /^\d+$/.test(number) &&
          /^\/devtools\/browser\/[a-z0-9-]+$/i.test(path)
          ? { number, path }
          : null;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return null;
      }
    }, 'BROWSER_LAUNCH_TIMEOUT');
    cdp = await Cdp.connect(`ws://127.0.0.1:${port.number}${port.path}`);
    const version = await cdp.send('Browser.getVersion');
    const identity = {
      version: 1,
      producer: 'CHROME_CDP',
      browserVersion: version.product,
      webSourceDigest: sourceDigest,
      runId: prepared.runId,
      provider: plan.provider,
      corpusHash: prepared.corpusHash,
      candidateFingerprint: plan.candidateFingerprint,
    };
    async function product(actorSession, path, schema) {
      const response = await fetch(
        `${plan.destination.apiOrigin}/api/v1${path}`,
        {
          headers: { Authorization: `Bearer ${actorSession.access_token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
        },
      );
      demand(
        response.status === 200 &&
          response.headers.get('cache-control')?.includes('no-store'),
        'BROWSER_CONTEXT_READ_FAILED',
      );
      return schema.parse(await response.json()).data;
    }
    async function pageFor(context) {
      if (profileInUse !== context.profile) {
        demand(busy.size === 0, 'BROWSER_PROFILE_OVERLAP');
        profileInUse = context.profile;
        switching = switching.then(async () => {
          for (const page of pages.values())
            await cdp.send('Target.disposeBrowserContext', {
              browserContextId: page.browserContextId,
            });
          pages.clear();
        });
      }
      await switching;
      const lane = lanes.get(`${context.profile}:${context.binding.id}`);
      demand(
        Number.isInteger(lane) && !busy.has(lane),
        'BROWSER_LANE_CONFLICT',
      );
      busy.add(lane);
      context.lane = lane;
      let page = pages.get(lane);
      if (page && page.actorId !== context.binding.actorId) {
        await cdp.send('Target.disposeBrowserContext', {
          browserContextId: page.browserContextId,
        });
        pages.delete(lane);
        page = null;
      }
      if (!page) {
        const { browserContextId } = await cdp.send(
          'Target.createBrowserContext',
          { disposeOnDetach: true },
        );
        const { targetId } = await cdp.send('Target.createTarget', {
          url: 'about:blank',
          browserContextId,
          newWindow: true,
          background: false,
          width: 1440,
          height: 900,
        });
        const { sessionId } = await cdp.send('Target.attachToTarget', {
          targetId,
          flatten: true,
        });
        page = {
          browserContextId,
          targetId,
          sessionId,
          actorId: context.binding.actorId,
        };
        pages.set(lane, page);
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);
      }
      const { sessionId } = page;
      const attempt = await product(
        context.session,
        `/attempts/${context.binding.attemptId}`,
        attemptResponseSchema,
      );
      demand(
        attempt.attemptId === context.binding.attemptId &&
          attempt.activityId === context.binding.activityId,
        'BROWSER_ATTEMPT_SCOPE_MISMATCH',
      );
      const navigation = randomUUID();
      const { identifier } = await cdp.send(
        'Page.addScriptToEvaluateOnNewDocument',
        {
          source: `if(location.origin===${JSON.stringify(webOrigin)}){localStorage.setItem(${JSON.stringify('alunza.auth.' + new URL(state.authUrl).host)},${JSON.stringify(JSON.stringify(context.session))});window.__alunzaEvaluationNavigation=${JSON.stringify(navigation)};}`,
        },
        sessionId,
      );
      try {
        await cdp.send(
          'Page.navigate',
          {
            url: `${webOrigin}/actividades/${attempt.activityId}/ejercicios/${attempt.assignmentId}`,
          },
          sessionId,
        );
        await until(
          () =>
            evaluate(
              cdp,
              sessionId,
              `window.__alunzaEvaluationNavigation===${JSON.stringify(navigation)}&&document.querySelector(${JSON.stringify(`${selector('attempt-history-row')}[data-attempt-id="${attempt.attemptId}"]`)})!==null`,
            ),
          'BROWSER_ATTEMPT_NOT_VISIBLE',
          45000,
        );
      } finally {
        await cdp.send(
          'Page.removeScriptToEvaluateOnNewDocument',
          { identifier },
          sessionId,
        );
      }
      await click(
        cdp,
        sessionId,
        `${selector('attempt-history-row')}[data-attempt-id="${attempt.attemptId}"] ${selector('show-attempt')}`,
      );
      const buttonSelector = `${selector('attempt-help')}[data-attempt-id="${attempt.attemptId}"] ${selector(context.kind === 'HINT' ? 'request-hint' : 'request-feedback')}`;
      await until(
        () =>
          evaluate(
            cdp,
            sessionId,
            `(() => {const e=document.querySelector(${JSON.stringify(buttonSelector)});return !!e&&!e.disabled;})()`,
          ),
        'BROWSER_HELP_NOT_READY',
        15000,
      );
      await evaluate(
        cdp,
        sessionId,
        `(${installBrowserProbe.toString()})(${JSON.stringify({ attemptId: attempt.attemptId, apiOrigin: plan.destination.apiOrigin, buttonSelector })})`,
      );
      return { ...page, buttonSelector };
    }
    return {
      identity,
      close,
      async help(input) {
        demand(
          !closed &&
            ['serial', 'concurrent'].includes(input.profile) &&
            UUID.test(input.operationKey) &&
            input.session?.user?.id === input.binding.actorId,
          'BROWSER_HELP_CONTEXT_INVALID',
        );
        const context = { ...input, apiOrigin: plan.destination.apiOrigin };
        let page,
          removeListener,
          painted,
          gateError,
          dispatchCount = 0;
        try {
          page = await pageFor(context);
          const { sessionId } = page;
          removeListener = cdp.listen((event) => {
            if (
              event.sessionId !== sessionId ||
              event.method !== 'Fetch.requestPaused'
            )
              return;
            void (async () => {
              try {
                const headers = admissionHeaders(
                  event.params.request,
                  context,
                  dispatchCount + 1,
                );
                if (headers) dispatchCount++;
                await cdp.send(
                  'Fetch.continueRequest',
                  {
                    requestId: event.params.requestId,
                    ...(headers ? { headers } : {}),
                  },
                  sessionId,
                );
              } catch {
                gateError = new EvaluationError(
                  'BROWSER_HELP_DISPATCH_REJECTED',
                );
                await cdp
                  .send(
                    'Fetch.failRequest',
                    {
                      requestId: event.params.requestId,
                      errorReason: 'Aborted',
                    },
                    sessionId,
                  )
                  .catch(() => {});
              }
            })();
          });
          await cdp.send(
            'Fetch.enable',
            {
              patterns: [
                {
                  urlPattern: `${plan.destination.apiOrigin}/api/v1/attempts/*/feedback-requests`,
                  requestStage: 'Request',
                },
              ],
            },
            sessionId,
          );
          await click(cdp, sessionId, page.buttonSelector);
          const request = await until(async () => {
            if (gateError) throw gateError;
            const probe = await evaluate(
              cdp,
              sessionId,
              '({request:window.__alunzaEvaluationProbe.request,httpStatus:window.__alunzaEvaluationProbe.httpStatus})',
            );
            if (probe.httpStatus && probe.httpStatus !== 202)
              throw new EvaluationError(
                'BROWSER_HELP_ADMISSION_FAILED',
                probe.httpStatus,
              );
            return probe.request;
          }, 'BROWSER_HELP_ADMISSION_TIMEOUT');
          context.request = helpRequestResponseSchema.parse({
            data: request,
            requestId: request.id,
          }).data;
          demand(
            request.attemptId === context.binding.attemptId &&
              request.kind === context.kind &&
              request.hintLevel === (context.hintLevel ?? null),
            'BROWSER_ACCEPTED_IDENTITY_MISMATCH',
          );
          await input.onAccepted?.(context.request);
          const row = `${selector('help-history-row')}[data-request-id="${request.id}"] ${selector('show-help')}`;
          await until(
            () =>
              evaluate(
                cdp,
                sessionId,
                `!!document.querySelector(${JSON.stringify(row)})`,
              ),
            'BROWSER_HELP_HISTORY_TIMEOUT',
          );
          await click(cdp, sessionId, row);
          const feedback = await until(
            () =>
              evaluate(
                cdp,
                sessionId,
                'window.__alunzaEvaluationProbe.feedback',
              ),
            'BROWSER_FEEDBACK_RESPONSE_TIMEOUT',
          );
          context.feedback = helpFeedbackResponseSchema.parse({
            data: feedback,
            requestId: request.id,
          }).data;
          demand(
            feedback.requestId === request.id &&
              feedback.attemptId === context.binding.attemptId &&
              feedback.kind === context.kind &&
              feedback.hintLevel === (context.hintLevel ?? null) &&
              feedback.available,
            'BROWSER_FEEDBACK_IDENTITY_MISMATCH',
          );
          painted = await until(
            () =>
              evaluate(
                cdp,
                sessionId,
                `(${readPaintedFeedback.toString()})(${JSON.stringify({ attemptId: context.binding.attemptId, requestId: request.id, feedbackId: feedback.id, kind: context.kind, hintLevel: context.hintLevel ?? null })})`,
              ),
            'BROWSER_FEEDBACK_RENDER_TIMEOUT',
          );
          demand(
            painted.trusted &&
              painted.postCount === 1 &&
              dispatchCount === 1 &&
              painted.domIdentityMatched &&
              painted.documentVisible &&
              painted.geometryVisible &&
              painted.status === feedback.help.status &&
              painted.explanation === feedback.help.explanation &&
              painted.hint === feedback.help.hint &&
              Number.isFinite(painted.start) &&
              painted.parsed >= painted.start &&
              painted.visible >= painted.parsed,
            'BROWSER_FEEDBACK_RENDER_MISMATCH',
          );
          const completed = await product(
            input.session,
            `/feedback-requests/${request.id}`,
            helpRequestResponseSchema,
          );
          demand(
            completed.feedbackId === feedback.id &&
              ['SUCCEEDED', 'FAILED'].includes(completed.state),
            'BROWSER_COMPLETED_IDENTITY_MISMATCH',
          );
          const observation = browserObservation(identity, context, painted);
          const artifact = await saveBrowserObservation(
            localDirectory,
            observation,
          );
          return {
            request: context.request,
            completed,
            feedback: context.feedback,
            observation,
            artifact,
          };
        } catch (cause) {
          const error =
            cause instanceof EvaluationError
              ? cause
              : new EvaluationError('BROWSER_HELP_FAILED');
          error.browserObservation = browserObservation(
            identity,
            context,
            painted,
            error.code,
          );
          error.browserArtifact = await saveBrowserObservation(
            localDirectory,
            error.browserObservation,
          );
          throw error;
        } finally {
          removeListener?.();
          if (page) {
            await cdp.send('Fetch.disable', {}, page.sessionId).catch(() => {});
            await evaluate(
              cdp,
              page.sessionId,
              'window.__alunzaEvaluationProbe?.dispose()',
            ).catch(() => {});
          }
          if (context.lane !== undefined) busy.delete(context.lane);
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
