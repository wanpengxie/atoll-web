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

const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 15_000;

function withAbort(operation, signal) {
  if (!signal) return Promise.resolve(operation);
  if (signal.aborted) return Promise.reject(new Error('频道同步已取消'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('频道同步已取消'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

// One foreground interest is a durable obligation, not a one-shot RPC. A
// successful head probe only fixes a finite target; fulfillment advances only
// after the scheduler proves that target is installed. New interests are
// coalesced while preserving the newest revision.
export function createSyncObligationCoordinator({
  probe,
  catchup,
  isDefinitiveError = () => false,
  onDefinitiveError = () => {},
  onChange = () => {},
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  if (typeof probe !== 'function' || typeof catchup !== 'function') {
    throw new TypeError('sync coordinator requires probe and catchup');
  }
  const channels = new Map();
  let available = false;
  let connectionEpoch = 0;
  let admissionGeneration = 0;
  let admittedChannels = null;
  let destroyed = false;

  const stateFor = (channelID) => {
    let state = channels.get(channelID);
    if (!state) {
      state = {
        channelID,
        interestRevision: 0,
        probedRevision: 0,
        fulfilledRevision: 0,
        targetHead: 0,
        requiredRanges: [],
        attempt: 0,
        retryAt: 0,
        error: '',
        running: null,
        timer: null,
        admitted: admittedChannels === null ? null : admittedChannels.has(channelID),
        admissionEpoch: 0,
        activeAbort: null,
      };
      channels.set(channelID, state);
    }
    return state;
  };

  const publish = (state) => onChange(state.channelID, Object.freeze({
    interestRevision: state.interestRevision,
    probedRevision: state.probedRevision,
    fulfilledRevision: state.fulfilledRevision,
    targetHead: state.targetHead,
    requiredRanges: Object.freeze(state.requiredRanges.map((range) => Object.freeze({ ...range }))),
    attempt: state.attempt,
    retryAt: state.retryAt,
    error: state.error,
    running: Boolean(state.running),
    admitted: state.admitted,
  }));

  function clearRetry(state) {
    if (state.timer != null) clearTimeoutImpl(state.timer);
    state.timer = null;
    state.retryAt = 0;
  }

  function scheduleRetry(state) {
    clearRetry(state);
    if (!available || destroyed || state.admitted === false || state.fulfilledRevision >= state.interestRevision) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(6, Math.max(0, state.attempt - 1)));
    state.retryAt = Date.now() + delay;
    state.timer = setTimeoutImpl(() => {
      state.timer = null;
      state.retryAt = 0;
      void advance(state);
    }, delay);
  }

  async function advance(state) {
    if (destroyed || !available || state.admitted === false || state.running || state.fulfilledRevision >= state.interestRevision) return false;
    let restartAfterConnectionChange = false;
    const operation = (async () => {
      while (!destroyed && available && state.admitted !== false && state.fulfilledRevision < state.interestRevision) {
        const revision = state.interestRevision;
        const attemptEpoch = connectionEpoch;
        const attemptAdmissionEpoch = state.admissionEpoch;
        const controller = new AbortController();
        state.activeAbort = controller;
        try {
          const meta = await withAbort(probe(state.channelID, { revision }), controller.signal);
          if (destroyed || !available) return false;
          if (attemptEpoch !== connectionEpoch
            || attemptAdmissionEpoch !== state.admissionEpoch
            || state.admitted === false) {
            restartAfterConnectionChange = true;
            return false;
          }
          if (!meta || meta.channel_id !== state.channelID) throw new Error('频道新鲜度响应不匹配');
          state.probedRevision = Math.max(state.probedRevision, revision);
          state.targetHead = Math.max(0, Number(meta.head_seq) || 0);
          const localHead = Math.max(0, Number(meta.local_head_seq) || 0);
          state.requiredRanges = state.targetHead > localHead
            ? [{ lowSeq: localHead + 1, highSeq: state.targetHead, purpose: 'focused-tail' }]
            : [];
          state.error = '';
          publish(state);
          await catchup(state.channelID, meta, {
            revision,
            targetHead: state.targetHead,
            requiredRanges: state.requiredRanges,
            signal: controller.signal,
          });
          if (destroyed || !available) return false;
          if (attemptEpoch !== connectionEpoch
            || attemptAdmissionEpoch !== state.admissionEpoch
            || state.admitted === false) {
            restartAfterConnectionChange = true;
            return false;
          }
          state.fulfilledRevision = Math.max(state.fulfilledRevision, revision);
          state.requiredRanges = [];
          state.attempt = 0;
          state.error = '';
          clearRetry(state);
          publish(state);
        } catch (error) {
          // A response or scheduler completion owned by an earlier transport
          // epoch is neither success nor failure for the replacement
          // connection. Keep the obligation pending and restart it there.
          if (attemptEpoch !== connectionEpoch
            || attemptAdmissionEpoch !== state.admissionEpoch
            || state.admitted === false) {
            restartAfterConnectionChange = true;
            return false;
          }
          if (isDefinitiveError(error)) {
            // A definitive denial is an access fact, not a transient sync
            // failure. Retire this channel from the current admission set
            // before notifying the owner so no callback-triggered render can
            // race another probe. The epoch checks above are the authority
            // fence: an old connection/admission attempt can never revoke a
            // grant installed after it started.
            admittedChannels?.delete(state.channelID);
            state.admitted = false;
            state.admissionEpoch += 1;
            state.targetHead = 0;
            state.requiredRanges = [];
            state.attempt = 0;
            state.error = error?.message || String(error || '同步被拒绝');
            clearRetry(state);
            publish(state);
            onDefinitiveError(state.channelID, error, Object.freeze({
              revision,
              connectionEpoch: attemptEpoch,
              admissionGeneration,
              admissionEpoch: attemptAdmissionEpoch,
            }));
            return false;
          }
          state.attempt += 1;
          state.error = error?.message || String(error || '同步失败');
          publish(state);
          scheduleRetry(state);
          return false;
        } finally {
          if (state.activeAbort === controller) state.activeAbort = null;
        }
      }
      return true;
    })();
    state.running = operation;
    publish(state);
    try { return await operation; }
    finally {
      if (state.running === operation) state.running = null;
      publish(state);
      if (!destroyed && available && state.admitted !== false
        && state.fulfilledRevision < state.interestRevision && !state.timer) {
        if (restartAfterConnectionChange) void advance(state);
        else scheduleRetry(state);
      }
    }
  }

  return Object.freeze({
    interest(channelID) {
      if (!channelID || destroyed) return Promise.resolve(false);
      const state = stateFor(channelID);
      state.interestRevision += 1;
      state.error = '';
      clearRetry(state);
      publish(state);
      return advance(state);
    },
    connection(nextAvailable) {
      const next = Boolean(nextAvailable);
      if (next !== available) connectionEpoch += 1;
      available = next;
      for (const state of channels.values()) {
        if (!available) clearRetry(state);
        else if (state.admitted !== false && state.fulfilledRevision < state.interestRevision) void advance(state);
        publish(state);
      }
    },
    admission(channelIDs = [], { generation = 0 } = {}) {
      const nextChannels = new Set([...channelIDs].filter(Boolean));
      const nextGeneration = Math.max(0, Number(generation) || 0);
      const generationChanged = nextGeneration !== admissionGeneration;
      const membershipChanged = admittedChannels === null
        || nextChannels.size !== admittedChannels.size
        || [...nextChannels].some((channelID) => !admittedChannels.has(channelID));
      if (!generationChanged && !membershipChanged) return false;
      admissionGeneration = nextGeneration;
      admittedChannels = nextChannels;
      for (const state of channels.values()) {
        const nextAdmitted = nextChannels.has(state.channelID);
        if (!generationChanged && state.admitted === nextAdmitted) continue;
        state.admitted = nextAdmitted;
        state.admissionEpoch += 1;
        state.error = '';
        state.targetHead = 0;
        state.requiredRanges = [];
        state.attempt = 0;
        clearRetry(state);
        state.activeAbort?.abort();
        if (nextAdmitted && available && state.fulfilledRevision < state.interestRevision) void advance(state);
        publish(state);
      }
      return true;
    },
    snapshot(channelID) {
      const state = channels.get(channelID);
      if (!state) return Object.freeze({ interestRevision: 0, probedRevision: 0, fulfilledRevision: 0, targetHead: 0, requiredRanges: Object.freeze([]), attempt: 0, retryAt: 0, error: '', running: false, admitted: admittedChannels === null ? null : admittedChannels.has(channelID) });
      return Object.freeze({
        interestRevision: state.interestRevision,
        probedRevision: state.probedRevision,
        fulfilledRevision: state.fulfilledRevision,
        targetHead: state.targetHead,
        requiredRanges: Object.freeze(state.requiredRanges.map((range) => Object.freeze({ ...range }))),
        attempt: state.attempt,
        retryAt: state.retryAt,
        error: state.error,
        running: Boolean(state.running),
        admitted: state.admitted,
      });
    },
    destroy() {
      destroyed = true;
      for (const state of channels.values()) {
        clearRetry(state);
        state.activeAbort?.abort();
      }
      channels.clear();
    },
  });
}
