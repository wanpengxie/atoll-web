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
  if (snapshot.feed?.feed?.localReplicaErrorCode) return 'local-replica-error';
  if (snapshot.feed?.feed?.localReplicaReady !== true) return 'local-replica-pending';
  const schedulerReason = snapshot.feed?.scheduler?.channel?.blockedBy;
  if (schedulerReason && schedulerReason !== 'ready') return `scheduler:${schedulerReason}`;
  if (snapshot.feed?.replica?.rows > 0 && snapshot.presentation.rows === 0) return 'projection-empty';
  if (snapshot.presentation.rows > 0 && snapshot.dom.mountedRows === 0) return 'materialization-empty';
  if (snapshot.dom.handoffPending) return 'handoff-pending';
  if (!snapshot.dom.canScroll && snapshot.feed?.scheduler?.channel?.hasOlder) return 'viewport-underfill';
  return snapshot.classification === 'entry-pending' ? 'entry-authority-pending' : 'none';
}

function activationKey(snapshot) {
  return `${snapshot.channelId}:${snapshot.reading.activationID}:${snapshot.viewKey}`;
}

function workSummary(snapshot) {
  const scheduler = snapshot.feed?.scheduler;
  const inflight = scheduler?.inflight;
  const candidate = scheduler?.candidate;
  const reason = scheduler?.channel?.blockedBy || snapshot.blockedBy;
  const noWorkNeeded = ['authoritative-eof', 'buffer-awaiting-release'].includes(reason)
    || (snapshot.classification === 'authoritative-empty' && reason !== 'ready');
  return {
    state: inflight ? 'running' : candidate ? 'planned' : noWorkNeeded ? 'not-needed' : 'blocked',
    action: inflight || candidate || null,
    reason: inflight || candidate ? '' : reason,
    replicaReady: snapshot.feed?.feed?.localReplicaReady === true,
    dataRows: finite(snapshot.feed?.replica?.rows),
    presentationVisible: snapshot.dom.visibleRows > 0,
  };
}

function transitionEvents(previous, current) {
  if (!previous) return [];
  const events = [];
  const beforeInflight = previous.feed?.scheduler?.inflight;
  const afterInflight = current.feed?.scheduler?.inflight;
  const inflightKey = (value) => value
    ? `${value.channelId}:${value.source}:${value.purpose}:${value.rangeKind}:${value.beforeSeq}`
    : '';
  const beforeError = previous.feed?.scheduler?.channel?.errorCode || '';
  const afterError = current.feed?.scheduler?.channel?.errorCode || '';
  if (afterError && afterError !== beforeError) events.push(['fail', 'warn']);
  if (afterInflight && inflightKey(afterInflight) !== inflightKey(beforeInflight)) {
    events.push(['dispatch', 'info']);
  }
  const dataChanged = current.feed?.replica?.revision !== previous.feed?.replica?.revision
    || current.feed?.replica?.rows !== previous.feed?.replica?.rows;
  if (dataChanged) events.push(['data-complete', 'info']);
  else if (beforeInflight && !afterInflight && !afterError) events.push(['dispatch-settled-no-data', 'info']);
  const bodyChanged = current.presentation.revision !== previous.presentation.revision
    || current.dom.visibleRows !== previous.dom.visibleRows
    || JSON.stringify(current.dom.visibleIDs) !== JSON.stringify(previous.dom.visibleIDs);
  if (bodyChanged && current.dom.visibleRows > 0) events.push(['presented', 'info']);
  return events;
}

function stateKey(snapshot) {
  const scheduler = snapshot.feed?.scheduler;
  return JSON.stringify({
    classification: snapshot.classification,
    blockedBy: snapshot.blockedBy,
    feed: snapshot.feed?.feed,
    replica: snapshot.feed?.replica,
    scheduler: scheduler ? {
      channel: scheduler.channel && {
        ...scheduler.channel,
        retryInMs: Number(scheduler.channel.retryInMs || 0) > 0,
      },
      candidate: scheduler.candidate,
      inflight: scheduler.inflight && {
        channelId: scheduler.inflight.channelId,
        source: scheduler.inflight.source,
        purpose: scheduler.inflight.purpose,
        rangeKind: scheduler.inflight.rangeKind,
        phase: scheduler.inflight.phase,
        beforeSeq: scheduler.inflight.beforeSeq,
      },
      global: {
        focus: scheduler.global?.focus,
        generation: scheduler.global?.generation,
        localMetaReady: scheduler.global?.localMetaReady,
        inflightCount: scheduler.global?.inflightCount,
        reservedBytes: scheduler.global?.reservedBytes,
        reservoirBytes: scheduler.global?.reservoirBytes,
        occupants: scheduler.global?.occupants?.map((entry) => ({
          channelId: entry.channelId,
          source: entry.source,
          purpose: entry.purpose,
          rangeKind: entry.rangeKind,
          phase: entry.phase,
          priority: entry.priority,
        })),
      },
    } : null,
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
      feed: history.debugSnapshot?.() || null,
      presentation: presentationSummary(presentation),
      reading: readingSummary(reading),
      dom: domSnapshot(),
    };
    snapshot.classification = classify(snapshot);
    snapshot.blockedBy = blockedBy(snapshot);
    snapshot.nextCondition = snapshot.blockedBy.startsWith('scheduler:')
      ? 'scheduler candidate becomes runnable or current source settles'
      : snapshot.blockedBy === 'projection-empty'
        ? 'Replica revision is consumed by Presentation'
        : snapshot.blockedBy === 'materialization-empty'
          ? 'current Presentation rows mount in the active list'
          : snapshot.blockedBy === 'viewport-underfill'
            ? 'edge demand opens or settles one Scheduler segment'
            : ['authoritative-empty', 'legitimate-small'].includes(snapshot.classification)
              && !snapshot.dom.canScroll
              && snapshot.feed?.scheduler?.channel?.hasOlder !== true
              ? 'no motion expected: the current channel has no scrollable range'
            : snapshot.blockedBy === 'none'
              ? 'none'
              : 'the named authority publishes a newer state';
    snapshot.work = workSummary(snapshot);
    snapshot.result = {
      dataComplete: snapshot.feed?.replica?.revision > 0,
      presentationVisible: snapshot.dom.visibleRows > 0,
      errorCode: String(snapshot.feed?.scheduler?.channel?.errorCode || ''),
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
    latestRef.current = build('commit');
  }, [build, emit]);

  useLayoutEffect(() => registerColdEntryDiagnosticProvider(() => {
    const snapshot = buildRef.current?.('snapshot');
    if (snapshot) latestRef.current = snapshot;
    return latestRef.current;
  }), []);

  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
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
