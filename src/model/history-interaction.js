export const HISTORY_OPERATION = Object.freeze({
  satisfied: 'satisfied',
  exhausted: 'exhausted',
  failed: 'failed',
  cancelled: 'cancelled',
});

function aborted(signal) {
  return Boolean(signal?.aborted);
}

// next() owns data acquisition and atomically applies one contiguous segment.
// project() owns semantic visibility. Empty or fully hidden segments simply
// continue this same operation; no React render or callback edge is required.
export async function loadUntilVisible({ anchorSeq = 0, next, project, signal, onCheck = () => {} }) {
  for (;;) {
    if (aborted(signal)) return { kind: HISTORY_OPERATION.cancelled };
    let step;
    try {
      step = await next({ signal });
    } catch (error) {
      if (aborted(signal) || error?.name === 'AbortError') return { kind: HISTORY_OPERATION.cancelled };
      return { kind: HISTORY_OPERATION.failed, error };
    }
    if (aborted(signal)) return { kind: HISTORY_OPERATION.cancelled };
    if (step?.kind === HISTORY_OPERATION.failed) return step;
    if (step?.kind === HISTORY_OPERATION.exhausted) return step;
    if (step?.kind === HISTORY_OPERATION.cancelled) return step;

    const projection = project();
    const firstVisibleSeq = Number(projection?.firstVisibleSeq || 0);
    onCheck({ anchorSeq, firstVisibleSeq, step });
    if (firstVisibleSeq > 0 && (anchorSeq === 0 || firstVisibleSeq < anchorSeq)) {
      return { kind: HISTORY_OPERATION.satisfied, firstVisibleSeq, projection, step };
    }
  }
}

// One physical visit to the top owns one operation. Duplicate Virtuoso signals
// join it. The controller stores continuation outside React effects; an effect
// may report geometry, but cleanup cannot erase an in-flight goal accidentally.
export function createTopIntentController({ load, onState = () => {} } = {}) {
  let viewKey = '';
  let atTop = false;
  let disposed = false;
  let epoch = 0;
  let active = null;
  let consumed = false;
  let lastResult = null;

  function cancel(reason = 'cancelled') {
    if (!active) return;
    active.controller.abort(reason);
    active = null;
    onState({ state: HISTORY_OPERATION.cancelled, reason, epoch, viewKey });
  }

  function setView(nextViewKey) {
    if (viewKey === nextViewKey) return;
    cancel('view-changed');
    viewKey = nextViewKey || '';
    epoch += 1;
    consumed = false;
    lastResult = null;
  }

  function leaveTop() {
    atTop = false;
    consumed = false;
    lastResult = null;
    cancel('left-top');
  }

  function enterTop(goal, { continuation = false } = {}) {
    if (disposed) return Promise.resolve({ kind: HISTORY_OPERATION.cancelled });
    if (!atTop) {
      atTop = true;
      epoch += 1;
      consumed = false;
      lastResult = null;
    }
    if (active) return active.promise;
    if (consumed && !continuation) return Promise.resolve(lastResult || { kind: HISTORY_OPERATION.cancelled });
    const controller = new AbortController();
    const ownedEpoch = epoch;
    const ownedView = viewKey;
    onState({ state: 'started', epoch: ownedEpoch, viewKey: ownedView, anchorSeq: goal.anchorSeq });
    const owned = { promise: null, controller, epoch: ownedEpoch, viewKey: ownedView };
    let loaded;
    try {
      loaded = load({ ...goal, signal: controller.signal });
    } catch (error) {
      loaded = Promise.reject(error);
    }
    const promise = Promise.resolve(loaded)
      .catch((error) => ({
        kind: controller.signal.aborted ? HISTORY_OPERATION.cancelled : HISTORY_OPERATION.failed,
        error,
      }))
      .then((result) => {
	  // A cancelled operation may settle after a new view/top epoch already owns
	  // the controller. Its late completion is observationally stale and must not
	  // overwrite the new epoch's consumed/result state.
	  if (active !== owned) return result;
	  active = null;
      consumed = true;
      lastResult = result;
      onState({ state: result.kind, epoch: ownedEpoch, viewKey: ownedView, result });
      return result;
      });
    owned.promise = promise;
    active = owned;
    return promise;
  }

  function dispose() {
    disposed = true;
    cancel('disposed');
  }

  return {
    setView,
    enterTop,
    leaveTop,
    dispose,
    active: () => active?.promise || null,
    snapshot: () => ({ viewKey, atTop, disposed, epoch, active: Boolean(active), consumed }),
  };
}
