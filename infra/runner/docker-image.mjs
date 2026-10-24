const pendingImages = new Map();
const lookupTimeoutMs = 10000;

// Share only an unresolved read of the same image on the pinned daemon. Each
// operation still receives an immutable ID and creates its own fresh capsules.
export async function readImageIdentity(engine, image, signal) {
  signal?.throwIfAborted();
  const key = JSON.stringify([engine.endpoint, engine.apiVersion, image]);
  let pending = pendingImages.get(key);
  if (!pending) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Docker image lookup timed out'));
      }, lookupTimeoutMs);
      timer.unref?.();
    });
    const request = Promise.resolve().then(() =>
      engine.request('GET', `/images/${encodeURIComponent(image)}/json`, {
        signal: controller.signal,
        timeoutMs: lookupTimeoutMs,
      }),
    );
    pending = Promise.race([request, deadline])
      .then((result) => {
        const id = result.data?.Id;
        if (result.status !== 200 || !/^sha256:[a-f0-9]{64}$/.test(id ?? ''))
          throw new Error('Prepared runner image unavailable');
        return id;
      })
      .finally(() => {
        clearTimeout(timer);
        if (pendingImages.get(key) === pending) pendingImages.delete(key);
      });
    pendingImages.set(key, pending);
  }
  if (!signal) return pending;

  // Cancelling one caller must not cancel the shared read or its other callers.
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () =>
      reject(signal.reason ?? new Error('Docker image lookup cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    const id = await Promise.race([pending, cancelled]);
    signal.throwIfAborted();
    return id;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
