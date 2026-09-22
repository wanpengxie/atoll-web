import { useCallback, useLayoutEffect, useRef } from 'react';
import {
  diagnostic,
  registerColdEntryDiagnosticProvider,
} from '../../model/diagnostics.js';

const ENTRY_STALL_MS = 2_500;
const STATE_EMIT_MIN_MS = 300;
const MAX_STATE_EMITS = 12;

function now() {
  return Number(globalThis.performance?.now?.() || Date.now());
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function visibleNodes(nodes, root) {
  if (!root) return [];
  const viewport = root.getBoundingClientRect();
  return nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
}

function domSnapshot() {
  const stack = globalThis.document?.querySelector?.('.timeline-reading-stack') || null;
  const viewportMode = String(globalThis.document?.querySelector?.('.timeline')?.dataset.viewportMode || '');
  const layers = stack ? [...stack.querySelectorAll('.timeline-reading-layer')] : [];
  const activeLayer = layers.find((layer) => layer.classList.contains('is-active'))
    || layers.find((layer) => layer.classList.contains('is-outgoing'))
    || null;
  const root = activeLayer?.querySelector('.timeline-message-list')
    || stack?.querySelector('.timeline-message-list')
    || null;
  const mounted = root ? [...root.querySelectorAll('[data-presentation-row-id]')] : [];
  const visible = visibleNodes(mounted, root);
  const style = root ? globalThis.getComputedStyle?.(root) : null;
  const ids = (nodes) => nodes.slice(0, 4).map((node) => String(node.dataset.presentationRowId || ''));
  return {
    stackMounted: Boolean(stack?.isConnected),
    handoffPending: stack?.dataset.handoffPending === 'true',
    handoffReady: stack?.dataset.handoffReady === 'true',
    layers: layers.map((layer) => ({
      role: layer.classList.contains('is-outgoing')
        ? 'outgoing'
        : layer.classList.contains('is-incoming') ? 'incoming' : 'active',
      inert: layer.inert === true,
      hidden: layer.getAttribute('aria-hidden') === 'true',
    })),
    container: root?.dataset.readingContainer
      || (root?.classList.contains('timeline-following-tail')
        ? 'following-tail'
        : root ? `${viewportMode || 'unknown'}-empty` : ''),
    mountedRows: mounted.length,
    visibleRows: visible.length,
    mountedIDs: ids(mounted),
    visibleIDs: ids(visible),
    scrollTop: finite(root?.scrollTop),
    scrollHeight: finite(root?.scrollHeight),
    clientHeight: finite(root?.clientHeight),
    overflowY: String(style?.overflowY || ''),
    canScroll: finite(root?.scrollHeight) > finite(root?.clientHeight) + 1,
  };
}

function presentationSummary(snapshot) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  return {
    revision: finite(snapshot?.revision),
    sourceRevision: finite(snapshot?.sourceRevision),
    rows: rows.length,
    firstID: String(rows[0]?.id || ''),
    lastID: String(rows.at(-1)?.id || ''),
  };
}

function readingSummary(reading) {
  const session = reading.getSession?.() || reading.session || {};
  return {
    activationID: String(reading.activationID || session.activationID || ''),
    inputEpoch: finite(session.inputEpoch),
    mode: String(session.mode || ''),
    availability: String(reading.availability || ''),
    initializing: reading.initializing === true,
    presentationPending: reading.presentationPending === true,
    restorePending: reading.restorePending === true,
    bottomReady: reading.bottomReady === true,
    historyDemand: {
      revision: finite(reading.historyDemand?.revision),
      phase: String(reading.historyDemand?.phase || 'idle'),
      error: Boolean(reading.historyDemand?.error),
    },
  };
}

function historySummary(history) {
  const status = history?.status || history || {};
  return {
    channelId: String(status.channelId || ''),
    generation: finite(status.generation),
    attached: status.attached === true,
    headSeq: finite(status.headSeq),
    beforeSeq: finite(status.beforeSeq),
    oldestSeq: finite(status.oldestSeq),
    hasOlder: status.hasOlder === true,
    loaded: status.loaded === true,
    loading: status.loading === true,
    foregroundLoading: status.foregroundLoading === true,
    backgroundLoading: status.backgroundLoading === true,
    completedPages: finite(status.completedPages),
    lastSource: String(status.lastSource || ''),
    presentationRevision: finite(status.presentationRevision),
    localReplicaReady: status.localReplicaReady === true,
    localReplicaError: String(status.localReplicaError || ''),
    localReplicaErrorCode: String(status.localReplicaErrorCode || ''),
    error: String(status.error || ''),
    errorCode: String(status.errorCode || ''),
    demand: {
      revision: finite(status.historyDemand?.revision),
      phase: String(status.historyDemand?.phase || 'idle'),
      error: String(status.historyDemand?.error || ''),
    },
  };
}

function classify(snapshot) {
  const rows = snapshot.dom.visibleRows;
  const small = rows <= 3;
  const ready = snapshot.reading.initializing !== true
    && snapshot.reading.presentationPending !== true
    && ['readable', 'empty-known'].includes(snapshot.reading.availability);
  if (small && ready) return snapshot.reading.availability === 'empty-known'
    ? 'authoritative-empty'
    : 'legitimate-small';
  if (!small) return 'entry-visible';
  return 'entry-pending';
}

function blockedBy(snapshot) {
  if (!snapshot.surfaceVisible) return 'surface-hidden';
  if (!snapshot.selfReady) return 'self-identity-pending';
  if (snapshot.history.localReplicaErrorCode || snapshot.history.localReplicaError) return 'local-replica-error';
  if (!snapshot.history.localReplicaReady) return 'local-replica-pending';
  if (snapshot.history.errorCode || snapshot.history.error || snapshot.history.demand.error) return 'history-error';
  if (snapshot.history.loaded && snapshot.presentation.rows === 0) return 'projection-empty';
  if (snapshot.presentation.rows > 0 && snapshot.dom.mountedRows === 0) return 'materialization-empty';
  if (snapshot.dom.handoffPending) return 'handoff-pending';
  if (!snapshot.dom.canScroll && snapshot.history.hasOlder) return 'viewport-underfill';
  if (snapshot.history.loading || snapshot.history.demand.phase === 'pending') return 'history-loading';
  if (!snapshot.history.attached) return 'history-detached';
  return snapshot.classification === 'entry-pending' ? 'entry-authority-pending' : 'none';
}

function activationKey(snapshot) {
  return `${snapshot.channelId}:${snapshot.reading.activationID}:${snapshot.viewKey}`;
}

// The same key, from the hook's own inputs. Diagnostics must never be the
// reason a commit reads layout, so this answers "can anything be emitted at
// all" before a snapshot — which measures every mounted row — is built.
function activationKeyOf(channelId, viewKey, reading) {
  const session = reading?.getSession?.() || reading?.session || {};
  return `${String(channelId || '')}:${String(reading?.activationID || session.activationID || '')}:${String(viewKey || '')}`;
}

function workSummary(snapshot) {
  const status = snapshot.history;
  const running = status.loading || status.demand.phase === 'pending';
  const failed = Boolean(status.errorCode || status.error || status.demand.error);
  const noWorkNeeded = !running && !failed && status.attached
    && (snapshot.classification === 'authoritative-empty' || status.hasOlder === false);
  return {
    state: running ? 'running' : failed ? 'failed' : noWorkNeeded ? 'not-needed' : 'blocked',
    action: running
      ? status.foregroundLoading ? 'foreground-history' : status.backgroundLoading ? 'background-history' : 'history-demand'
      : '',
    reason: running ? '' : snapshot.blockedBy,
    replicaReady: status.localReplicaReady,
    dataLoaded: status.loaded,
    presentationVisible: snapshot.dom.visibleRows > 0,
  };
}

function transitionEvents(previous, current) {
  if (!previous) return [];
  const events = [];
  const beforeLoading = previous.history.loading || previous.history.demand.phase === 'pending';
  const afterLoading = current.history.loading || current.history.demand.phase === 'pending';
  const beforeError = previous.history.errorCode || previous.history.localReplicaErrorCode || '';
  const afterError = current.history.errorCode || current.history.localReplicaErrorCode || '';
  if (afterError && afterError !== beforeError) events.push(['fail', 'warn']);
  if (afterLoading && !beforeLoading) events.push(['dispatch', 'info']);
  const dataChanged = current.history.completedPages !== previous.history.completedPages
    || current.history.oldestSeq !== previous.history.oldestSeq
    || current.history.loaded !== previous.history.loaded
    || current.presentation.sourceRevision !== previous.presentation.sourceRevision;
  if (dataChanged) events.push(['data-complete', 'info']);
  else if (beforeLoading && !afterLoading && !afterError) events.push(['dispatch-settled-no-data', 'info']);
  const bodyChanged = current.presentation.revision !== previous.presentation.revision
    || current.dom.visibleRows !== previous.dom.visibleRows
    || JSON.stringify(current.dom.visibleIDs) !== JSON.stringify(previous.dom.visibleIDs);
  if (bodyChanged && current.dom.visibleRows > 0) events.push(['presented', 'info']);
  return events;
}

function stateKey(snapshot) {
  return JSON.stringify({
    classification: snapshot.classification,
    blockedBy: snapshot.blockedBy,
    history: snapshot.history,
    presentation: snapshot.presentation,
    reading: snapshot.reading,
    dom: snapshot.dom,
  });
}

export function useColdEntryDiagnostics({
  channelId,
  viewKey,
  selfReady,
  surfaceVisible,
  presentation,
  reading,
  history,
}) {
  const latestRef = useRef({ version: 1, active: false });
  const buildRef = useRef(null);
  const emitRef = useRef(null);
  const lifecycleRef = useRef({
    key: '', fingerprint: '', lastEmitAt: 0, stateEmits: 0,
    resolved: false, entryTimer: null, stateTimer: null, lastSnapshot: null,
  });

  const build = useCallback((trigger = 'snapshot') => {
    const snapshot = {
      version: 1,
      trigger,
      capturedAt: new Date().toISOString(),
      channelId: String(channelId || ''),
      viewKey: String(viewKey || ''),
      selfReady: selfReady === true,
      surfaceVisible: surfaceVisible === true,
      history: historySummary(history),
      presentation: presentationSummary(presentation),
      reading: readingSummary(reading),
      dom: domSnapshot(),
    };
    snapshot.classification = classify(snapshot);
    snapshot.blockedBy = blockedBy(snapshot);
    snapshot.nextCondition = snapshot.blockedBy === 'projection-empty'
        ? 'Replica revision is consumed by Presentation'
        : snapshot.blockedBy === 'materialization-empty'
          ? 'current Presentation rows mount in the active list'
          : snapshot.blockedBy === 'viewport-underfill'
            ? 'edge demand settles one history segment'
            : snapshot.blockedBy === 'history-loading'
              ? 'the current history demand settles'
              : snapshot.blockedBy === 'history-error'
                ? 'the current history demand is retried successfully'
                : snapshot.blockedBy === 'history-detached'
                  ? 'history attaches for this channel generation'
            : ['authoritative-empty', 'legitimate-small'].includes(snapshot.classification)
              && !snapshot.dom.canScroll
              && snapshot.history.hasOlder !== true
              ? 'no motion expected: the current channel has no scrollable range'
            : snapshot.blockedBy === 'none'
              ? 'none'
              : 'the named authority publishes a newer state';
    snapshot.work = workSummary(snapshot);
    snapshot.result = {
      dataComplete: snapshot.history.loaded || (snapshot.history.attached && snapshot.history.headSeq === 0),
      presentationVisible: snapshot.dom.visibleRows > 0,
      errorCode: snapshot.history.errorCode || snapshot.history.localReplicaErrorCode,
    };
    return snapshot;
  }, [channelId, history, presentation, reading, selfReady, surfaceVisible, viewKey]);

  const emit = useCallback((trigger, level = 'info', expectedKey = '') => {
    const snapshot = buildRef.current?.(trigger);
    if (!snapshot || (expectedKey && activationKey(snapshot) !== expectedKey)) return null;
    latestRef.current = snapshot;
    diagnostic(level, 'cold_entry.snapshot', snapshot);
    return snapshot;
  }, []);

  // Only a committed render may replace the state reader used by deadlines and
  // the browser provider. Assigning during render would let an abandoned render
  // publish a channel/activation that never became visible.
  useLayoutEffect(() => {
    buildRef.current = build;
    emitRef.current = emit;
    // Installing the readers is the whole job. Building a snapshot here as well
    // measured every mounted row on every commit — `build` changes identity
    // whenever history/presentation/reading do — and the result was only a
    // cache: the provider below and `emit` both build fresh when actually asked.
  }, [build, emit]);

  useLayoutEffect(() => registerColdEntryDiagnosticProvider(() => {
    const snapshot = buildRef.current?.('snapshot');
    if (snapshot) latestRef.current = snapshot;
    return latestRef.current;
  }), []);

  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
    // Nothing new can be said: same activation, and its state-change budget is
    // spent. Returning before the snapshot keeps a settled channel free of
    // per-commit layout reads instead of measuring rows to discard the result.
    if (activationKeyOf(channelId, viewKey, reading) === lifecycle.key
      && lifecycle.stateEmits >= MAX_STATE_EMITS) return undefined;
    const snapshot = buildRef.current?.('state-change');
    if (!snapshot) return undefined;
    latestRef.current = snapshot;
    const key = activationKey(snapshot);
    const fingerprint = stateKey(snapshot);
    if (lifecycle.key !== key) {
      if (lifecycle.entryTimer != null) globalThis.clearTimeout(lifecycle.entryTimer);
      if (lifecycle.stateTimer != null) globalThis.clearTimeout(lifecycle.stateTimer);
      lifecycle.entryTimer = null;
      lifecycle.stateTimer = null;
      lifecycle.key = key;
      lifecycle.fingerprint = fingerprint;
      lifecycle.lastEmitAt = now();
      lifecycle.stateEmits = 0;
      lifecycle.resolved = snapshot.classification !== 'entry-pending';
      lifecycle.lastSnapshot = snapshot;
      // Every committed activation gets exactly one entry record regardless of
      // row count. It states whether work is running, planned, blocked, or not
      // needed, so a healthy cached/full channel is observable too.
      emitRef.current?.('entry', 'info', key);
      if (!lifecycle.resolved) {
        lifecycle.entryTimer = globalThis.setTimeout(() => {
          lifecycle.entryTimer = null;
          if (lifecycle.key !== key) return;
          const stalled = buildRef.current?.('stalled-deadline');
          if (stalled?.classification === 'entry-pending') {
            emitRef.current?.('stalled-deadline', 'warn', key);
          }
        }, ENTRY_STALL_MS);
      }
      return undefined;
    }
    if (fingerprint === lifecycle.fingerprint) return undefined;
    lifecycle.fingerprint = fingerprint;
    if (lifecycle.stateEmits >= MAX_STATE_EMITS) return undefined;
    const delay = Math.max(0, STATE_EMIT_MIN_MS - (now() - lifecycle.lastEmitAt));
    if (lifecycle.stateTimer != null) globalThis.clearTimeout(lifecycle.stateTimer);
    lifecycle.stateTimer = globalThis.setTimeout(() => {
      lifecycle.stateTimer = null;
      if (lifecycle.key !== key) return;
      lifecycle.lastEmitAt = now();
      const current = buildRef.current?.('state-change');
      if (!current || activationKey(current) !== key) return;
      const events = transitionEvents(lifecycle.lastSnapshot, current);
      const selected = events.length > 0 ? events : [['state-change', 'debug']];
      for (const [trigger, level] of selected) {
        if (lifecycle.stateEmits >= MAX_STATE_EMITS) break;
        emitRef.current?.(trigger, level, key);
        lifecycle.stateEmits += 1;
      }
      lifecycle.lastSnapshot = current;
      if (current.classification !== 'entry-pending') lifecycle.resolved = true;
    }, delay);
    return undefined;
  });

  useLayoutEffect(() => () => {
    const lifecycle = lifecycleRef.current;
    for (const timer of [lifecycle.entryTimer, lifecycle.stateTimer]) {
      if (timer != null) globalThis.clearTimeout(timer);
    }
  }, []);
}
