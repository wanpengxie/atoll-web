export function cacheWorldMismatch(remoteBoot, cacheBoot, meta) {
  const size = meta instanceof Map ? meta.size : Number(meta?.size || 0);
  return Boolean(remoteBoot && size > 0 && String(cacheBoot || '') !== String(remoteBoot));
}

// A persistence fence is deliberately narrower than a transport barrier. A
// caller may commit a live fact to memory immediately and enqueue only its
// durable write here. `run` captures the epoch selected at call time, so a
// later reconnect cannot move an older write across its original world seam.
export function createPersistenceEpochFence() {
  let version = 0;
  let ready = Promise.resolve({ version });
  let tail = ready;

  return Object.freeze({
    select(activate) {
      version += 1;
      const selected = version;
      // A new world is selected after all writes belonging to the preceding
      // world. This matters on a rapid reconnect: epoch N+1 cleanup must not
      // overtake a row that already captured epoch N.
      const activation = tail.catch(() => {}).then(() => activate());
      ready = activation.then(() => ({ version: selected }));
      tail = ready;
      return activation;
    },
    run(operation) {
      const captured = ready;
      const execution = tail.catch(() => {}).then(() => captured).then((epoch) => operation(epoch));
      tail = execution;
      return execution;
    },
    version: () => version,
  });
}
