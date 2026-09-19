import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { HISTORY_URGENCY } from '../../model/history-demand.js';
import {
  bindLatestIntentTargets,
  cancelReadingControl,
  consumeLatestIntent,
  createReadingSession,
  observeReading,
  persistentReadingSession,
  READING_MODE,
  requestLatest,
  takeReadingControl,
  updateReadingControl,
} from '../../model/reading-session.js';
import { readerCaughtUp, viewportUnseenNotice } from '../../model/notification-policy.js';
import { newId } from '../../util/id.js';
import { diagnostic, readingTrace } from '../../model/diagnostics.js';
import {
  admissionOperationID,
  HISTORY_CONSUMER,
} from './history-consumer-obligation.js';
import {
  currentEntryAuthority,
  evidenceBelongsTo,
  installedTailReadRows,
  pendingArrivalEvents,
} from './dom-evidence-adapter.js';
import { useDOMEvidencePort } from './useDOMEvidencePort.js';
import { useHistoryConsumer, useReadingInitialization } from './useHistoryConsumer.js';
import { useNotificationConfirmation } from './useNotificationConfirmation.js';

// Anticipatory reveal is deliberately smaller than the Scheduler's warm raw
// reservoir. These are raw ledger records/bytes, not rendered message rows;
// filtered facts may require several cooperative segments before one visible
// presentation row advances the frontier.
const HISTORY_RUNWAY_REVEAL_RECORDS = 8;
const HISTORY_RUNWAY_REVEAL_BYTES = 256 * 1024;
const PENDING_ARRIVAL_LIMIT = 1_024;
const EMPTY_REQUEST = () => Promise.resolve({ kind: 'exhausted' });
const IDLE_HISTORY_DEMAND = Object.freeze({ revision: 0, phase: 'idle', error: '' });

function createController({ channelID, viewKey, viewSessions }) {
  const activationID = newId();
  const saved = viewSessions?.readView(channelID, viewKey) || { mode: READING_MODE.following };
  let session = createReadingSession({ key: `${channelID}:${viewKey}`, activationID, saved });
  const unseenRecords = new Map(
    (saved.unseenRecords || [])
      .filter((record) => (
        Array.isArray(record)
        && record[0]
        && Number.isSafeInteger(Number(record[1]))
        && Number(record[1]) > 0
      ))
      .map(([key, seq]) => [String(key), {
        seq: Number(seq),
        // Persisted records predate the transient arrival-to-presentation
        // join. Their stable key is the only conservative row identity we can
        // reconstruct after reload; live arrivals add every explicit rowID.
        rowIDs: new Set([String(key)]),
      }]),
  );
  // Arrival is transport commitment, not proof that the user has missed a
  // row. Keep it private until the matching Presentation revision receives a
  // committed viewport observation, then atomically discard visible records
  // or publish only records that were actually outside the viewport.
  const pendingRecords = new Map();
  // 读侧在场读数。它不是第二份真相：atTail/surfaceVisible 的事实仍然只由 DOM
  // 观测通过 DOM evidence port 写入，这里保存的是该证据在本 activation 上的最
  // 后一次发布，好让 render 看得见（ref 恒不触发重渲染）。它不改任何一条未读
  // 记录、不推进任何游标、不参与持久化。
  let tailReached = false;
  let tailPresence = Object.freeze({ surfaceVisible: false, documentVisible: false });
  const caughtUp = () => readerCaughtUp({
    following: session.mode === READING_MODE.following,
    atTail: tailReached,
    ...tailPresence,
  });
  let published = Object.freeze({ session, unseen: unseenRecords.size, tailCaughtUp: caughtUp() });
  const listeners = new Set();
  let started = false;

  function emit() {
    published = Object.freeze({ session, unseen: unseenRecords.size, tailCaughtUp: caughtUp() });
    for (const listener of listeners) listener();
  }

  function persist(previousRevision) {
    viewSessions?.save(channelID, viewKey, activationID, previousRevision, {
      ...persistentReadingSession(session),
      unseenTail: unseenRecords.size,
      unseenKeys: [...unseenRecords.keys()],
      unseenRecords: [...unseenRecords].map(([key, record]) => [key, record.seq]),
    });
  }

  function start() {
    if (started) return;
    started = true;
    viewSessions?.activate(channelID, viewKey, activationID);
  }

  function normalizeRecords(records) {
    return records.map((record) => {
      if (typeof record === 'string') return null;
      const key = String(record?.key || '');
      const rowIDs = [...new Set(
        [...(record?.rowIDs || [record?.rowID]), key]
          .map((rowID) => String(rowID || '')).filter(Boolean),
      )];
      return {
        key,
        seq: Number(record?.seq),
        rowIDs,
        presentationRevision: Math.max(0, Number(record?.presentationRevision || 0)),
      };
    }).filter((record) => (
      record?.key && Number.isSafeInteger(record.seq) && record.seq > 0 && record.rowIDs.length
    ));
  }

  function mergeRecord(target, record) {
    const previous = target.get(record.key);
    const nextSeq = Math.max(Number(previous?.seq || 0), record.seq);
    const nextRowIDs = new Set(previous?.rowIDs || []);
    const previousRowCount = nextRowIDs.size;
    for (const rowID of record.rowIDs) nextRowIDs.add(rowID);
    const nextPresentationRevision = Math.max(
      Number(previous?.presentationRevision || 0),
      Number(record.presentationRevision || 0),
    );
    const changed = nextSeq !== Number(previous?.seq || 0)
      || nextRowIDs.size !== previousRowCount
      || nextPresentationRevision !== Number(previous?.presentationRevision || 0);
    target.set(record.key, {
      seq: nextSeq,
      rowIDs: nextRowIDs,
      presentationRevision: nextPresentationRevision,
    });
    return changed;
  }

  return {
    activationID,
    start,
    isStarted: () => started,
    getSnapshot: () => published,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(reduce) {
      // React event/promise closures can outlive their activation. Only the
      // committed hook lifecycle may start a controller; a stale callback is
      // never allowed to resurrect it through update().
      if (!started) return session;
      const previous = session;
      const next = reduce(previous);
      if (next === previous) return session;
      session = next;
      // 离开跟随态就是用户自己宣布"我不在最新端了"。到达尾部这一事实随之作废，
      // 下一次在场必须由一次新的尾部观测重新证明——所以 jumpToLatest 只是把意图
      // 改回跟随，在真正落地之前一字不清。
      if (session.mode !== READING_MODE.following) tailReached = false;
      persist(previous.revision);
      emit();
      return session;
    },
    addUnseen(records = []) {
      if (!started) return unseenRecords.size;
      const normalized = normalizeRecords(records);
      let advanced = false;
      for (const record of normalized) {
        if (mergeRecord(unseenRecords, record)) advanced = true;
      }
      if (!advanced) return unseenRecords.size;
      const previousRevision = session.revision;
      session = Object.freeze({ ...session, revision: session.revision + 1 });
      persist(previousRevision);
      emit();
      return unseenRecords.size;
    },
    stageArrivals(records = [], presentationRevision = 0) {
      if (!started) return pendingRecords.size;
      for (const record of normalizeRecords(records)) {
        mergeRecord(pendingRecords, { ...record, presentationRevision });
      }
      // The transport journal is itself bounded to the same capacity. Under
      // sustained projection starvation, conservatively publish the oldest
      // current-scope candidate instead of retaining an unbounded hidden map.
      let promoted = false;
      while (pendingRecords.size > PENDING_ARRIVAL_LIMIT) {
        const oldestKey = pendingRecords.keys().next().value;
        const oldest = pendingRecords.get(oldestKey);
        pendingRecords.delete(oldestKey);
        promoted = mergeRecord(unseenRecords, { key: oldestKey, ...oldest }) || promoted;
      }
      if (promoted) {
        const previousRevision = session.revision;
        session = Object.freeze({ ...session, revision: session.revision + 1 });
        persist(previousRevision);
        emit();
      }
      return pendingRecords.size;
    },
    pendingArrivalCount: () => pendingRecords.size,
    // 发布"用户此刻是否就在最新端看着"。调用方只把已有证据读一遍传进来；这里
    // 既不改记录也不 persist，只在读数真的变了时让 render 重新取一次快照。
    observeTailPresence(presence = {}) {
      if (!started) return published.tailCaughtUp;
      const next = Object.freeze({
        surfaceVisible: presence.surfaceVisible === true,
        documentVisible: presence.documentVisible === true,
      });
      // “在底部”是一次到达，不是每一帧都要重新证明的几何。跟随态下列表自己负责
      // 把用户留在尾部，追赶途中的一两帧 atTail=false 是列表在跟，不是用户走开
      // 了；用户真的离开尾部走 takeReadingControl，那条路会改成浏览态并作废证据。
      // 持久回执仍只认 markVisibleTailRead 的真实 atTail，因此显示兜底不能伪造已读。
      const reached = next.surfaceVisible && next.documentVisible
        && session.mode === READING_MODE.following
        && (presence.atTail === true || tailReached);
      if (reached === tailReached
        && next.surfaceVisible === tailPresence.surfaceVisible
        && next.documentVisible === tailPresence.documentVisible) return published.tailCaughtUp;
      tailReached = reached;
      tailPresence = next;
      emit();
      return published.tailCaughtUp;
    },
    resolveArrivals({ entities, visibleRows = [], presentationRevision = 0, observationRevision = 0 } = {}) {
      if (!started || !pendingRecords.size) return Object.freeze({ pending: pendingRecords.size, unseen: unseenRecords.size, decisions: Object.freeze([]) });
      const visible = new Map();
      for (const row of visibleRows) {
        const messageID = String(row?.messageID || '');
        const seqHigh = Number(row?.seqHigh || 0);
        if (!messageID || !Number.isSafeInteger(seqHigh) || seqHigh <= 0) continue;
        visible.set(messageID, Math.max(visible.get(messageID) || 0, seqHigh));
      }
      const decisions = [];
      let promoted = false;
      for (const [key, record] of pendingRecords) {
        const committedRowIDs = [...record.rowIDs].filter((rowID) => (
          Number(entities?.get?.(rowID)?.seqHigh || 0) >= record.seq
        ));
        if (!committedRowIDs.length) {
          const stillInScope = [...record.rowIDs].some((rowID) => entities?.has?.(rowID));
          // The candidate was staged only while one of its row identities
          // belonged to this view. If a later committed projection removes
          // every identity, it is now out of this filter's scope, not unseen.
          if (!stillInScope && Number(presentationRevision || 0) > Number(record.presentationRevision || 0)) {
            pendingRecords.delete(key);
            decisions.push(Object.freeze({ key, seq: record.seq, outcome: 'out-of-scope' }));
          }
          continue;
        }
        // An observation for the revision that staged the transport event can
        // still describe the pre-terminal/pre-response row. Do not classify
        // a committed in-scope row against it once Presentation has advanced:
        // visibility and entity membership must come from the same commit.
        // Out-of-scope removal above needs no viewport geometry.
        if (Number(observationRevision || 0) < Number(presentationRevision || 0)) continue;
        const seen = committedRowIDs.some((rowID) => (visible.get(rowID) || 0) >= record.seq);
        pendingRecords.delete(key);
        if (seen) {
          decisions.push(Object.freeze({ key, seq: record.seq, outcome: 'visible', rowIDs: Object.freeze(committedRowIDs) }));
          continue;
        }
        promoted = mergeRecord(unseenRecords, { key, ...record }) || promoted;
        decisions.push(Object.freeze({ key, seq: record.seq, outcome: 'unseen', rowIDs: Object.freeze(committedRowIDs) }));
      }
      if (promoted) {
        const previousRevision = session.revision;
        session = Object.freeze({ ...session, revision: session.revision + 1 });
        persist(previousRevision);
        emit();
      }
      return Object.freeze({
        pending: pendingRecords.size,
        unseen: unseenRecords.size,
        decisions: Object.freeze(decisions),
      });
    },
    acknowledgeVisibleRows(rows = []) {
      if (!started || !rows.length) return unseenRecords.size;
      const visible = new Map();
      for (const row of rows) {
        const messageID = String(row?.messageID || '');
        const seqHigh = Number(row?.seqHigh || 0);
        if (!messageID || !Number.isSafeInteger(seqHigh) || seqHigh <= 0) continue;
        visible.set(messageID, Math.max(visible.get(messageID) || 0, seqHigh));
      }
      if (!visible.size) return unseenRecords.size;
      let removed = 0;
      for (const [key, record] of unseenRecords) {
        const acknowledged = [...record.rowIDs]
          .some((rowID) => (visible.get(rowID) || 0) >= record.seq);
        if (!acknowledged) continue;
        unseenRecords.delete(key);
        removed += 1;
      }
      if (!removed) return unseenRecords.size;
      const previousRevision = session.revision;
      session = Object.freeze({ ...session, revision: session.revision + 1 });
      persist(previousRevision);
      emit();
      return unseenRecords.size;
    },
    // The reader reached the installed tail of this view. Every candidate this
    // view already knows about at or below that tail is acknowledged in one
    // step, whether or not its row ever passed through the viewport. Records
    // above the installed tail are later arrivals and stay untouched.
    acknowledgeInstalledTail({ installedHighSeq = 0 } = {}) {
      const high = Number(installedHighSeq);
      const idle = () => Object.freeze({
        pending: pendingRecords.size,
        unseen: unseenRecords.size,
        acknowledged: Object.freeze([]),
      });
      if (!started || !Number.isSafeInteger(high) || high <= 0) return idle();
      const acknowledged = [];
      for (const [key, record] of pendingRecords) {
        if (record.seq > high) continue;
        pendingRecords.delete(key);
        acknowledged.push(Object.freeze({
          key,
          seq: record.seq,
          stage: 'pending',
          rowIDs: Object.freeze([...record.rowIDs]),
          presentationRevision: Number(record.presentationRevision || 0),
        }));
      }
      let removed = 0;
      for (const [key, record] of unseenRecords) {
        if (record.seq > high) continue;
        unseenRecords.delete(key);
        removed += 1;
        acknowledged.push(Object.freeze({
          key,
          seq: record.seq,
          stage: 'unseen',
          rowIDs: Object.freeze([...record.rowIDs]),
          presentationRevision: Number(record.presentationRevision || 0),
        }));
      }
      if (removed) {
        const previousRevision = session.revision;
        session = Object.freeze({ ...session, revision: session.revision + 1 });
        persist(previousRevision);
        emit();
      }
      return Object.freeze({
        pending: pendingRecords.size,
        unseen: unseenRecords.size,
        acknowledged: Object.freeze(acknowledged),
      });
    },
    unseenEvidence() {
      return Object.freeze({
        count: unseenRecords.size,
        records: Object.freeze([...unseenRecords].map(([key, record]) => Object.freeze({
          key,
          seq: record.seq,
          rowIDs: Object.freeze([...record.rowIDs]),
        }))),
      });
    },
    close() {
      listeners.clear();
      if (started) viewSessions?.deactivate(channelID, viewKey, activationID);
      started = false;
    },
    suspend() {
      if (started) viewSessions?.deactivate(channelID, viewKey, activationID);
      started = false;
    },
  };
}

export function useReadingSession({
  channelID,
  viewKey,
  snapshot,
  history,
  viewSessions,
  arrivals = null,
  historyViewSpec = undefined,
  surfaceVisible = false,
}) {
  const historyStatus = history.status || history || {};
  const requestPort = history.request || history.open || history.loadOlder || EMPTY_REQUEST;
  const controller = useMemo(
    () => createController({ channelID, viewKey, viewSessions }),
    [channelID, viewKey, viewSessions],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { session, unseen, tailCaughtUp: readerPresent } = state;
  const hasManagedHistoryLifecycle = Object.prototype.hasOwnProperty.call(historyStatus, 'attached')
    && Object.prototype.hasOwnProperty.call(historyStatus, 'messageCurrent')
    && Object.prototype.hasOwnProperty.call(historyStatus, 'headSeq');
  const [latestRequiredRevision, setLatestRequiredRevision] = useState(0);
  const markReadPort = history.markRead || history.onReadLatest;
  const markNotificationsReadPort = history.markNotificationsRead;
  // This object is a render candidate until the insertion effect publishes it.
  // Refs are shared by React's current/work-in-progress fibers, so assigning
  // them in render lets a suspended candidate rewrite the authority observed
  // by the still-committed DOM and its async callbacks.
  const commitOwnerCandidate = useMemo(() => Object.freeze({
    controller,
    activationID: controller.activationID,
    channelID,
    viewKey,
    session,
    snapshot,
    historyStatus,
    historyRequest: requestPort,
    markRead: markReadPort,
    markNotificationsRead: markNotificationsReadPort,
    arrivals,
  }), [arrivals, channelID, controller, historyStatus, markNotificationsReadPort, markReadPort, requestPort, session, snapshot, viewKey]);
  const committedOwnerRef = useRef(commitOwnerCandidate);
  const sessionRef = useRef(session);
  const snapshotRef = useRef(snapshot);
  const historyStatusRef = useRef(historyStatus);
  const resolveArrivalsRef = useRef(null);
  const acknowledgeArrivalsRef = useRef(null);
  const domEvidence = useDOMEvidencePort({
    owner: commitOwnerCandidate,
    controller,
    historyStatus,
    snapshot,
    surfaceVisible,
  });
  const acknowledgeChannelNotifications = useNotificationConfirmation({
    channelID,
    viewKey,
    controller,
    session,
    historyStatus,
    committedOwnerRef,
    domEvidence,
  });
  const [viewabilityState, setViewabilityState] = useState(() => ({
    controller,
    visible: snapshot.rows.length > 0,
  }));
  // A semantic filter can replace its controller while retaining this
  // channel's physical list. If its projection is already readable in that
  // first render, do not manufacture a loading frame. A cold activation that
  // began empty, however, remains materializing until the list reports a real
  // visible-row observation.
  const presentationViewable = viewabilityState.controller === controller
    ? viewabilityState.visible
    : snapshot.rows.length > 0;
  const arrivalBaseline = Number.isSafeInteger(Number(arrivals?.acknowledgedRevision))
    ? Number(arrivals.acknowledgedRevision)
    : Number(arrivals?.revision || 0);
  const arrivalCursorRef = useRef({ controller, revision: arrivalBaseline });
  const arrivalDispositionRef = useRef({
    controller,
    throughRevision: arrivalBaseline,
    acknowledgedRevision: arrivalBaseline,
  });
  const lifecycleRef = useRef({ controller: null, epoch: 0 });
  const syncStatus = historyStatus.sync || {};
  const hasManagedSyncLifecycle = Object.prototype.hasOwnProperty.call(historyStatus, 'sync');
  const syncObservationCurrent = !hasManagedSyncLifecycle
    || (Number(syncStatus.interestRevision || 0) > 0
      && Number(syncStatus.fulfilledRevision || 0) >= Number(syncStatus.interestRevision || 0));
  const currentTailKnown = historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && Number(historyStatus.headSeq || 0) > 0;
  const latestObligationFulfilled = latestRequiredRevision === 0
    || Number(syncStatus.fulfilledRevision || 0) >= latestRequiredRevision;
  const currentPresentationKnown = Number(historyStatus.presentationRevision || 0) > 0
    && Number(snapshot.sourceRevision || 0) >= Number(historyStatus.presentationRevision || 0);
  // A managed history source must prove that its current head and matching
  // Presentation revision are installed before Reading may issue a tail
  // command. An unmanaged source has no scheduler/currentness obligation to
  // wait for: its supplied snapshot is the complete authority for this
  // activation. Treating that source as permanently stale made a following
  // remount depend on Virtuoso's one-shot initial estimate; if the data was
  // revised while the list materialized, the sole Reading issuer rejected the
  // committed height and left the viewport at the first row.
  const bottomReady = !hasManagedHistoryLifecycle || (
    currentTailKnown
    && latestObligationFulfilled
    && currentPresentationKnown
  );
  const knownHead = Math.max(
    Number(historyStatus.headSeq || 0),
    Number(syncStatus.targetHead || 0),
  );
  const authoritativeEmpty = hasManagedHistoryLifecycle
    && historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && historyStatus.localReplicaReady !== false
    && knownHead === 0
    && syncObservationCurrent;
  const knownNonEmpty = historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && knownHead > 0;
  const semanticRangeEstablished = !hasManagedHistoryLifecycle
    || historyStatus.loaded === true
    || Number(historyStatus.completedPages || 0) > 0;
  const semanticExhausted = hasManagedHistoryLifecycle
    && semanticRangeEstablished
    && historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && historyStatus.localReplicaReady !== false
    && historyStatus.hasOlder === false
    && Number(historyStatus.buffered || 0) === 0
    && historyStatus.loading !== true
    && syncObservationCurrent;
  const {
    presentationInitializing,
    restorePending,
  } = useReadingInitialization({
    controller,
    session,
    snapshot,
    historyStatus,
    hasManagedHistoryLifecycle,
    authoritativeEmpty,
    semanticExhausted,
    channelID,
    viewKey,
  });
  const actorFilterCount = Number(historyViewSpec?.actorFilter?.size || 0);
  // This boundary is derived entirely from the Scheduler's attached,
  // generation-current scan facts. Zero matching rows alone can never create
  // it; a later generation or newly proven older range removes it naturally.
  const historyBoundary = semanticExhausted
    ? Object.freeze({
      kind: 'exhausted',
      generation: Number(historyStatus.generation || 0),
      filtered: actorFilterCount > 0 || historyViewSpec?.scope === 'mine',
      actorFiltered: actorFilterCount > 0,
    })
    : null;
  const presentationPending = snapshot.rows.length > 0
    && surfaceVisible === true
    && !presentationViewable;
  const foregroundHistoryError = historyStatus.historyDemand?.phase === 'error';
  // Freshness has its own durable obligation and retry owner. A failed
  // channel_meta/catch-up attempt must not be flattened into an endless
  // "syncing" state merely because no physical history page failed.
  const syncHistoryError = !syncObservationCurrent
    ? String(syncStatus.error || '')
    : '';
  const localReplicaError = historyStatus.attached !== true
    ? String(historyStatus.localReplicaError || '')
    : '';
  const cachePhase = localReplicaError
    ? 'error'
    : historyStatus.localReplicaReady === false ? 'pending' : 'current';
  // A physical page can establish scan progress without producing one row in
  // this semantic view, then the exact next source/frontier can fail and stop
  // automatic dispatch. `semanticRangeEstablished` does not make that failure
  // non-blocking: with zero Presentation rows there is no list edge that can
  // create a foreground owner and inherit the Scheduler's blockedSource.
  // Preserve readable content when rows exist, and do not surface a stale
  // preceding-source error while a replacement batch is already running.
  const blockingHistoryError = historyStatus.error
    && historyStatus.loading !== true
    && (snapshot.rows.length === 0 || !semanticRangeEstablished)
    ? String(historyStatus.error)
    : '';
  const availabilityError = foregroundHistoryError
    ? String(historyStatus.historyDemand?.error || historyStatus.error || '')
    : syncHistoryError || localReplicaError || blockingHistoryError;
  // Readability and remote freshness are orthogonal. Durable cache rows stay
  // visible while the current connection proves its head; pending/error here
  // explains why Waiting/control remain unavailable without clearing content.
  const freshnessPhase = !hasManagedSyncLifecycle || syncObservationCurrent
    ? 'current'
    : syncHistoryError ? 'error' : 'pending';
  const freshnessError = freshnessPhase === 'error' ? syncHistoryError : '';
  const availability = snapshot.rows.length > 0
    ? (presentationPending ? 'materializing' : 'readable')
    : availabilityError
      ? 'error'
      : !hasManagedHistoryLifecycle
        ? 'empty-known'
        : (authoritativeEmpty || semanticExhausted)
          ? 'empty-known'
          // A fresh semantic activation can already be current at the raw
          // ledger head while its first matching Presentation row is still in
          // the existing runway. Keep the bounded initialization feedback;
          // `partial` is only truthful after that activation has degraded or
          // the reader deliberately selected a zero-row filter.
          : presentationInitializing
            ? 'syncing'
          : semanticRangeEstablished && historyStatus.hasOlder === true
            ? 'partial'
          : (knownNonEmpty || historyStatus.loading === true ? 'syncing' : 'unknown');
  const emptyReason = authoritativeEmpty ? 'channel' : 'filtered';
  // This is the only authority that may turn a Presentation candidate into
  // the current entry. Exact view/source binding rejects stale filter and
  // activation frames; continuous physical coverage rejects partial batches.
  const presentationAuthority = currentEntryAuthority({
    snapshot,
    historyStatus,
    bottomReady,
    availability: presentationPending ? 'readable' : availability,
    authoritativeEmpty,
  });
  const historyDemand = historyStatus.historyDemand?.phase === 'pending'
    || historyStatus.historyDemand?.phase === 'error'
    ? historyStatus.historyDemand
    : Number(historyStatus.historyDemand?.revision || 0) > 0
      ? historyStatus.historyDemand
      : IDLE_HISTORY_DEMAND;

  useLayoutEffect(() => {
    controller.start();
    return () => controller.suspend();
  }, [controller]);


  useEffect(() => {
    const epoch = lifecycleRef.current.epoch + 1;
    lifecycleRef.current = { controller, epoch };
    return () => {
      queueMicrotask(() => {
        const current = lifecycleRef.current;
        if (current.controller !== controller || current.epoch === epoch) controller.close();
      });
    };
  }, [controller]);


  useEffect(() => {
    const revision = Number(arrivals?.revision || 0);
    const previousRevision = arrivalCursorRef.current.revision;
    if (revision <= previousRevision) {
      // Presentation can advance after the transport cursor has already been
      // consumed. Revisit staged identities so a later filter commit can
      // retire rows that are no longer in this view without awaiting geometry.
      resolveArrivalsRef.current?.();
      acknowledgeArrivalsRef.current?.();
      return;
    }
    arrivalCursorRef.current.revision = revision;
    const visible = snapshot.entities;
    // The overflow prefix may be sparse because repeated frames collapse to
    // one stable identity. Selecting the last `revision delta` entries is a
    // conservative suffix: it contains every event newer than the cursor and
    // may include older collapsed entries, which the revision filter removes.
    const records = pendingArrivalEvents(arrivals, previousRevision)
      .filter((event) => (event.rowIDs || [event.rowID]).some((rowID) => visible?.has?.(rowID)))
      .map((event) => ({
        key: event.key || event.rowID,
        seq: Number(event.seq || 0),
        rowIDs: event.rowIDs || [event.rowID],
        presentationRevision: Number(snapshot.revision || 0),
      }));
    if (records.length) {
      readingTrace('reading.unseen-arrival', {
        activationID: controller.activationID,
        inputEpoch: sessionRef.current.inputEpoch,
        presentationRevision: Number(snapshot.revision || 0),
        channelId: channelID,
        arrivalRevision: revision,
        count: records.length,
        records,
      });
      controller.stageArrivals(records, Number(snapshot.revision || 0));
      // Join observation-before-arrival without publishing an intermediate
      // unseen count. Arrival-before-observation stays private until the
      // matching Presentation commit reports its exact visible identities.
      resolveArrivalsRef.current?.();
    }
    const disposition = arrivalDispositionRef.current;
    if (disposition.controller === controller) {
      disposition.throughRevision = Math.max(disposition.throughRevision, revision);
    }
    acknowledgeArrivalsRef.current?.();
  }, [arrivals?.events, arrivals?.revision, channelID, controller, snapshot.entities, snapshot.revision]);

  const historyConsumer = useHistoryConsumer({
    channelID,
    viewKey,
    controller,
    committedOwnerRef,
    commitOwnerCandidate,
    snapshotRef,
    historyStatusRef,
    historyStatus,
    snapshot,
    session,
    historyViewSpec,
    requestPort,
    authoritativeEmpty,
    semanticExhausted,
    hasManagedHistoryLifecycle,
    knownHead,
    history,
    localReplicaError,
    syncHistoryError,
    foregroundHistoryError,
    blockingHistoryError,
  });
  const requestHistory = historyConsumer.request;

  const captureBottomIntent = useCallback(() => {
    if (!controller.isStarted()) return null;
    const current = controller.getSnapshot().session;
    return Object.freeze({
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
      mode: current.mode,
      bottomIntentID: String(current.bottomIntent?.id || ''),
      presentationRevision: Number(snapshotRef.current.revision || 0),
      baselineTailID: String(snapshotRef.current.rows?.at(-1)?.id || ''),
    });
  }, [controller]);

  const requestBottom = useCallback((reason = 'explicit', expected = null, target = null) => {
    if (!controller.isStarted()) return false;
    const current = controller.getSnapshot().session;
    if (expected && (
      expected.activationID !== current.activationID
      || Number(expected.inputEpoch) !== current.inputEpoch
      || Number(expected.intentRevision) !== current.intentRevision
      || expected.mode !== current.mode
    )) return false;
    readingTrace('reading.bottom-intent', {
      activationID: controller.activationID,
      inputEpoch: current.inputEpoch,
      channelId: channelID,
      reason,
    });
    controller.update((current) => requestLatest(current, `${reason}:${newId()}`, target || undefined));
    return true;
  }, [channelID, controller]);

  const bindBottomIntentTargets = useCallback((expected, messageIDs) => {
    if (!controller.isStarted()) return false;
    const before = controller.getSnapshot().session;
    const after = controller.update((current) => bindLatestIntentTargets(current, expected, messageIDs));
    return after !== before;
  }, [controller]);

  const revokeBottomIntent = useCallback((expected) => {
    if (!controller.isStarted() || !expected) return false;
    const before = controller.getSnapshot().session;
    const expectedID = String(expected.bottomIntentID || '');
    if (!expectedID.startsWith('composer:send-start:')
      || expected.activationID !== before.activationID
      || Number(expected.inputEpoch) !== before.inputEpoch
      || Number(expected.intentRevision) !== before.intentRevision
      || before.bottomIntent.id !== expectedID) return false;
    const after = controller.update((current) => consumeLatestIntent(current, {
      id: expectedID,
      inputEpoch: expected.inputEpoch,
      activationID: expected.activationID,
    }));
    return after !== before;
  }, [controller]);

  const acknowledgeDisposedArrivals = useCallback(() => {
    const owner = committedOwnerRef.current;
    const disposition = arrivalDispositionRef.current;
    if (owner.controller !== controller
      || disposition.controller !== controller
      || controller.pendingArrivalCount() > 0
      || disposition.throughRevision <= disposition.acknowledgedRevision) return false;
    const throughRevision = disposition.throughRevision;
    owner.arrivals?.acknowledge?.(throughRevision);
    disposition.acknowledgedRevision = throughRevision;
    return true;
  }, [controller]);

  const resolveArrivals = useCallback(() => {
    const owner = committedOwnerRef.current;
    if (owner.controller !== controller) return false;
    const current = controller.getSnapshot().session;
    const evidence = domEvidence.current();
    if (evidence.controller !== controller
      || evidence.activationID !== current.activationID) return false;
    const evidenceCurrent = evidence.owner === owner;
    const canUseVisibleEvidence = evidenceCurrent
      && evidence.surfaceVisible === true
      && domEvidence.isDocumentVisible();
    const presentationRevision = Number(owner.snapshot.revision || 0);
    const resolution = controller.resolveArrivals({
      entities: owner.snapshot.entities,
      visibleRows: canUseVisibleEvidence ? evidence.visibleRows : [],
      presentationRevision,
      // A hidden document/surface cannot have shown the row, so the current
      // committed projection itself is sufficient negative visibility proof.
      // A visible surface must wait for evidence from that same presentation.
      // A stale visible observation still permits the projection-only
      // out-of-scope branch inside the controller, but revision zero prevents
      // it from classifying any still-in-scope row as unseen.
      observationRevision: evidenceCurrent
        ? (canUseVisibleEvidence ? Number(evidence.presentationRevision || 0) : presentationRevision)
        : 0,
    });
    if (resolution.decisions.length) {
      readingTrace('reading.arrival-resolution', {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        presentationRevision,
        visibleRows: canUseVisibleEvidence ? evidence.visibleRows : [],
        decisions: resolution.decisions,
        pending: resolution.pending,
        unseen: resolution.unseen,
      });
    }
    const presentedBoundary = canUseVisibleEvidence
      && evidence.atTail === true
      && current.mode === READING_MODE.following
      && Number(evidence.presentationRevision || 0) === presentationRevision
      ? resolution.decisions.reduce((high, decision) => (
        decision.outcome === 'visible' ? Math.max(high, Number(decision.seq || 0)) : high
      ), 0)
      : 0;
    if (presentedBoundary > 0) {
      acknowledgeChannelNotifications(presentedBoundary);
    }
    acknowledgeDisposedArrivals();
    return resolution.decisions.length > 0;
  }, [acknowledgeChannelNotifications, acknowledgeDisposedArrivals, controller, domEvidence]);

  const acknowledgeVisibleRows = useCallback(() => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = domEvidence.current();
    if (owner.controller !== controller
      || !evidenceBelongsTo(evidence, { owner, controller, activationID: current.activationID })
      || evidence.surfaceVisible !== true
      || !evidence.visibleRows?.length
      || !domEvidence.isDocumentVisible()) return false;
    const before = controller.unseenEvidence();
    const remaining = controller.acknowledgeVisibleRows(evidence.visibleRows);
    readingTrace('reading.visible-rows-ack', {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      visibleRows: evidence.visibleRows,
      before,
      remaining,
    });
    // A following tail publishes the same identities through
    // markVisibleTailRead below, together with its separately fenced physical
    // cursor claim. Browsing/non-tail observations have no physical authority
    // but still acknowledge the exact rows the user actually saw.
    if (evidence.atTail !== true || current.mode !== READING_MODE.following) {
      const scope = historyViewSpec?.scope || '';
      owner.markRead?.(Object.freeze({
        channelId: channelID,
        viewKey,
        activationID: current.activationID,
        generation: Number(evidence.generation || 0),
        sourceRevision: Number(evidence.sourceRevision || 0),
        scope,
        actorFilterCount: scope === 'all' ? 0 : Number(historyViewSpec?.actorFilter?.size || 0),
        atTail: evidence.atTail === true,
        following: false,
        surfaceVisible: true,
        installedHighSeq: Number(evidence.installedHighSeq || 0),
        visibleRows: evidence.visibleRows,
      }), Object.freeze({
        viewKey,
        activationID: current.activationID,
      }));
    }
    return true;
  }, [channelID, controller, domEvidence, historyViewSpec, unseen, viewKey]);

  // Installed-tail acknowledgement for the viewport notice. Same fences as the
  // durable tail receipt below: the observation must belong to the committed
  // owner and the currently presented revision, the reader must actually be
  // following at the physical tail, and the surface/document must be visible.
  // A jump-to-latest that has not yet reached the tail therefore clears nothing.
  const acknowledgeInstalledTail = useCallback(() => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = domEvidence.current();
    if (owner.controller !== controller
      || !evidenceBelongsTo(evidence, { owner, controller, activationID: current.activationID })
      || evidence.atTail !== true
      || evidence.surfaceVisible !== true
      || current.mode !== READING_MODE.following
      || Number(evidence.installedHighSeq || 0) <= 0
      || Number(evidence.presentationRevision || 0) !== Number(owner.snapshot.revision || 0)
      || !domEvidence.isDocumentVisible()) return null;
    const before = controller.unseenEvidence();
    const result = controller.acknowledgeInstalledTail({
      installedHighSeq: Number(evidence.installedHighSeq || 0),
    });
    if (result.acknowledged.length) {
      readingTrace('reading.installed-tail-ack', {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        presentationRevision: Number(evidence.presentationRevision || 0),
        installedHighSeq: Number(evidence.installedHighSeq || 0),
        before,
        acknowledged: result.acknowledged,
        pending: result.pending,
        unseen: result.unseen,
      });
    }
    acknowledgeDisposedArrivals();
    const presentedBoundary = result.acknowledged.reduce((high, record) => {
      const presented = (record.rowIDs || []).some((rowID) => (
        Number(owner.snapshot.entities?.get?.(rowID)?.seqHigh || 0) >= Number(record.seq || 0)
      ));
      return presented ? Math.max(high, Number(record.seq || 0)) : high;
    }, 0);
    return Object.freeze({ ...result, presentedBoundary });
  }, [acknowledgeDisposedArrivals, controller, domEvidence]);

  // 在场只是把已有证据读一遍再发布：跟随 ∧ 在底部 ∧ Surface 可见 ∧ 页面可见。
  // 证据必须属于当前 controller 的当前 activation。owner 提交本身不制造在场或
  // 离场事实；真正的 DOM 观测会以 atTail 精确更新这份读数。
  const publishTailPresence = useCallback(() => {
    const current = controller.getSnapshot().session;
    const evidence = domEvidence.current();
    const live = evidence.controller === controller
      && evidence.activationID === current.activationID;
    const out = controller.observeTailPresence({
      atTail: live && evidence.atTail === true,
      surfaceVisible: live && evidence.surfaceVisible === true && surfaceVisible === true,
      documentVisible: domEvidence.isDocumentVisible(),
    });
    return out;
  }, [controller, domEvidence, surfaceVisible]);

  const markVisibleTailRead = useCallback(() => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = domEvidence.current();
    const currentSnapshot = owner.snapshot;
    if (owner.controller !== controller
      || !evidenceBelongsTo(evidence, { owner, controller, activationID: current.activationID })
      || evidence.atTail !== true
      || evidence.surfaceVisible !== true
      || current.mode !== READING_MODE.following
      || evidence.installedHighSeq <= 0
      || Number(evidence.presentationRevision || 0) !== Number(currentSnapshot.revision || 0)
      || !domEvidence.isDocumentVisible()) return false;
    const scope = historyViewSpec?.scope || '';
    // Reaching the installed tail of this view is the acknowledgement of the
    // backlog this view has installed. The demand port derives exact read
    // identities (and, for an unfiltered view, the physical cursor) from the
    // identity rows on the receipt, so the receipt carries every installed
    // in-scope row at or below the observed installed high-water together
    // with the rows that were actually inside the viewport. Rows above that
    // high-water (later arrivals) are excluded and need their own tail
    // observation. Scope is still bounded by this view's projection: a
    // filtered view cannot name rows it never installed.
    const acknowledgedRows = installedTailReadRows(
      currentSnapshot.rows,
      Number(evidence.installedHighSeq || 0),
      evidence.visibleRows,
    );
    const receipt = Object.freeze({
      channelId: channelID,
      viewKey,
      activationID: current.activationID,
      generation: Number(evidence.generation || 0),
      sourceRevision: Number(evidence.sourceRevision || 0),
      scope,
      actorFilterCount: scope === 'all' ? 0 : Number(historyViewSpec?.actorFilter?.size || 0),
      atTail: true,
      following: true,
      surfaceVisible: true,
      installedHighSeq: Number(evidence.installedHighSeq || 0),
      visibleRows: acknowledgedRows,
      observedRows: evidence.visibleRows,
      tailAcknowledged: true,
    });
    const accepted = owner.markRead?.(receipt, Object.freeze({
      viewKey,
      activationID: current.activationID,
    }));
    domEvidence.markReadPending(evidence, accepted === false);
    return accepted || false;
  }, [channelID, controller, domEvidence, historyViewSpec, viewKey]);

  // Publish every authority-bearing input and callback as one commit-owned
  // frame before child layout effects can report DOM geometry. An aborted or
  // suspended render never reaches this boundary and therefore cannot lend its
  // snapshot/generation/ports to the previously committed surface.
  useInsertionEffect(() => {
    const previous = committedOwnerRef.current;
    committedOwnerRef.current = commitOwnerCandidate;
    sessionRef.current = session;
    snapshotRef.current = snapshot;
    historyStatusRef.current = historyStatus;
    resolveArrivalsRef.current = resolveArrivals;
    acknowledgeArrivalsRef.current = acknowledgeDisposedArrivals;
    if (previous.controller !== controller) {
      arrivalCursorRef.current = { controller, revision: arrivalBaseline };
      arrivalDispositionRef.current = {
        controller,
        throughRevision: arrivalBaseline,
        acknowledgedRevision: arrivalBaseline,
      };
    }
  }, [
    acknowledgeDisposedArrivals,
    arrivalBaseline,
    arrivals,
    commitOwnerCandidate,
    controller,
    historyStatus,
    markReadPort,
    resolveArrivals,
    session,
    snapshot,
  ]);

  useEffect(() => {
    if (domEvidence.visibilityRevision === 0) return;
    if (!domEvidence.isDocumentVisible()) {
      publishTailPresence();
      return;
    }
    const installed = acknowledgeInstalledTail();
    resolveArrivals();
    acknowledgeVisibleRows();
    acknowledgeChannelNotifications(installed?.presentedBoundary || 0);
    markVisibleTailRead();
    publishTailPresence();
  }, [domEvidence.visibilityRevision]);

  // 提交后的兜底发布。观测/可见性事件已经各自发布过一次；这一条负责那些不经过
  // 事件的变化——surfaceVisible 入参翻转、insertion effect 因 owner 更替作废了
  // 旧证据。它也重投一次被 current/read-authority 门明确拒绝的同一份回执；证据
  // 仍由 ReadingSession 单持有，并重新通过所有围栏。observeTailPresence 只在读数
  // 真的变了时才 emit，所以这里是幂等的。
  useEffect(() => {
    const evidence = domEvidence.current();
    if (evidence.readPending === true) {
      if (evidence.owner === committedOwnerRef.current
        && evidence.controller === controller
        && evidence.activationID === controller.getSnapshot().session.activationID) {
        markVisibleTailRead();
      } else domEvidence.markReadPending(evidence, false);
    }
    publishTailPresence();
  });

  const caughtUpScope = historyViewSpec?.scope || '';
  const caughtUpActorFiltered = Number(historyViewSpec?.actorFilter?.size || 0) > 0;
  // 一条给通知面用的只读读数：这条视图此刻是不是"用户正看着的最新端"，以及它
  // 覆盖的范围（频道栏据此决定能替哪一格说话）。它是 published 读数的投影，不
  // 是新的真相持有者。
  const tailCaughtUp = useMemo(() => Object.freeze({
    channelId: channelID,
    caughtUp: readerPresent === true,
    scope: caughtUpScope,
    actorFiltered: caughtUpActorFiltered,
  }), [caughtUpActorFiltered, caughtUpScope, channelID, readerPresent]);

  const beginNavigation = useCallback((input = {}) => {
    const operationID = admissionOperationID(historyStatus, {
      channelID, activationID: controller.activationID, viewKey,
    }) || historyConsumer.operationID();
    if (input.direction !== 'older') {
      historyConsumer.cancel('trusted-reverse-input');
      if (operationID) historyStatus.presentationAdmission?.cancel?.(channelID, operationID);
    }
    const nextSession = controller.update((current) => takeReadingControl(current, input));
    if (input.direction === 'older' && operationID) {
      const renewal = historyStatus.presentationAdmission?.advanceInputEpoch?.(channelID, {
        operationID,
        activationID: controller.activationID,
        direction: input.direction,
        inputEpoch: nextSession.inputEpoch,
        currentInputEpoch: controller.getSnapshot().session.inputEpoch,
      });
      if (renewal) diagnostic('debug', 'history.admission_input_advanced', {
        channelId: channelID,
        ...renewal,
      });
    }
    return Object.freeze({ inputGeneration: nextSession.inputEpoch });
  }, [channelID, controller, historyConsumer, historyStatus, viewKey]);

  const updateNavigation = useCallback((input = {}) => {
    const current = controller.getSnapshot().session;
    if (Number(input.inputGeneration) !== Number(current.inputEpoch)) return false;
    if (input.direction !== 'older') {
      const operationID = admissionOperationID(historyStatus, {
        channelID, activationID: controller.activationID, viewKey,
      }) || historyConsumer.operationID();
      historyConsumer.cancel('trusted-reverse-input');
      if (operationID) historyStatus.presentationAdmission?.cancel?.(channelID, operationID);
    }
    controller.update((active) => updateReadingControl(active, {
      inputEpoch: input.inputGeneration,
      direction: input.direction,
      gestureID: input.gestureID,
      geometryRevision: input.geometryRevision,
    }));
    return true;
  }, [channelID, controller, historyConsumer, historyStatus, viewKey]);

  const finishNavigation = useCallback((input = {}) => (
    Number(input.inputGeneration) === Number(controller.getSnapshot().session.inputEpoch)
  ), [controller]);

  const cancelNavigation = useCallback((input = {}) => {
    const before = controller.getSnapshot().session;
    if (Number(input.inputGeneration) !== Number(before.inputEpoch)) return false;
    const operationID = admissionOperationID(historyStatus, {
      channelID, activationID: controller.activationID, viewKey,
    }) || historyConsumer.operationID();
    historyConsumer.cancel(`trusted-navigation-cancel:${input.reason || 'cancelled'}`);
    if (operationID) historyStatus.presentationAdmission?.cancel?.(channelID, operationID);
    const after = controller.update((active) => cancelReadingControl(active, {
      inputEpoch: input.inputGeneration,
      gestureID: input.gestureID,
    }));
    return after !== before;
  }, [channelID, controller, historyConsumer, historyStatus, viewKey]);

  // Timeline's Admission commit runs in a parent layout effect, after this
  // hook's insertion effect has published the exact Reading owner. Expose a
  // read-only receipt instead of letting Timeline infer currentness from its
  // render candidate.
  const currentAdmissionAuthority = useCallback(() => {
    const owner = committedOwnerRef.current;
    return Object.freeze({
      activationID: String(owner?.activationID || ''),
      inputEpoch: Number(owner?.session?.inputEpoch || 0),
      viewID: String(owner?.viewKey || ''),
      epoch: `${owner?.channelID || ''}:${Number(owner?.historyStatus?.generation || 0)}`,
    });
  }, []);

  return useMemo(() => ({
    activationID: controller.activationID,
    session,
    // unseen 是回执真相（记录数）。unseenNotice 是显示值：用户就在最新端看着时
    // 恒为 0，不等任何一条回执落地——IM 模型下那些到达本来就是"即读"。
    unseen,
    unseenNotice: viewportUnseenNotice(unseen, tailCaughtUp.caughtUp),
    tailCaughtUp,
    initializing: presentationInitializing,
    restorePending,
    bottomReady,
    presentationAuthority,
    availability,
    emptyReason,
    presentationPending,
    availabilityError,
    freshness: Object.freeze({ phase: freshnessPhase, error: freshnessError }),
    cache: Object.freeze({
      phase: cachePhase,
      error: localReplicaError,
      code: String(historyStatus.localReplicaErrorCode || ''),
    }),
    status: historyStatus,
    // This is a semantic edge-demand lifecycle. Physical background batches
    // remain available on status.loading/backgroundLoading for diagnostics,
    // but must not mount or restart the foreground history affordance.
    historyDemand,
    historyBoundary,
    historyReveal: historyStatus.historyReveal || null,
    currentAdmissionAuthority,
    acknowledgeHistoryReveal(commitID) {
      return historyStatus.presentationAdmission?.acknowledge?.(channelID, commitID) === true;
    },
    requestHistory,
    retryHistoryDemand() {
      return historyConsumer.retry();
    },
    retryAvailability() {
      return historyConsumer.retryAvailability();
    },
    onAtTop(detail = {}) {
      return requestHistory('top', HISTORY_URGENCY.interactive, detail);
    },
    onNearTop(detail = {}) {
      return requestHistory('runway', HISTORY_URGENCY.anticipatory, {
        revealRows: HISTORY_RUNWAY_REVEAL_RECORDS,
        revealBytes: HISTORY_RUNWAY_REVEAL_BYTES,
        demandUnits: detail.demandUnits,
      });
    },
    onUnderfill(detail = {}) {
      return requestHistory('underfill', HISTORY_URGENCY.anticipatory, {
        ...detail,
        consumer: HISTORY_CONSUMER.viewportUnderfill,
      });
    },
    beginNavigation,
    updateNavigation,
    finishNavigation,
    cancelNavigation,
    onReadingObservation(observation) {
      const current = controller.getSnapshot().session;
      const activationID = observation.activationID || controller.activationID;
      // Reject the entire stale observation, including read-cursor side
      // effects. A reducer no-op alone still lets an old scroller claim tail.
      if (committedOwnerRef.current !== commitOwnerCandidate
        || activationID !== current.activationID) return current;
      const observedCurrentRow = observation.surfaceVisible === true
        && observation.visibleRows?.some((visible) => (
          snapshotRef.current.rows.some((row) => row.id === visible.messageID)
        ));
      if (observedCurrentRow) {
        // rangeChanged is an edge, not durable visibility state. A range can
        // commit while its callback still belongs to the previous render
        // owner, then remain unchanged after the current owner takes over.
        // The adapter's current, hit-tested visible-row observation is an
        // equivalent materialization acknowledgement and closes that lost
        // edge without consulting Scheduler loading or background supply.
        setViewabilityState((previous) => (
          previous.controller === controller && previous.visible
            ? previous
            : { controller, visible: true }
        ));
      }
      controller.update((active) => observeReading(active, {
        ...observation,
        activationID,
      }));
      domEvidence.observe({ ...observation, activationID });
      // Installed-tail acknowledgement runs before arrival resolution so a
      // candidate at or below the reached tail is never first published as
      // unseen and then retracted inside the same observation.
      const installed = acknowledgeInstalledTail();
      resolveArrivals();
      acknowledgeVisibleRows();
      acknowledgeChannelNotifications(installed?.presentedBoundary || 0);
      // 同一次观测既是回执证据，也是"用户此刻在不在最新端"的读数。
      publishTailPresence();
      // Durable channel read progress retains its physical-tail contract.
      // Viewport-notice acknowledgement above is intentionally independent:
      // browsing users can read a committed row without granting follow.
      markVisibleTailRead();
      return controller.getSnapshot().session;
    },
    onPresentationMaterialized(observation) {
      const current = controller.getSnapshot().session;
      if (committedOwnerRef.current !== commitOwnerCandidate
        || surfaceVisible !== true
        || observation?.activationID !== current.activationID
        || Number(observation?.presentationRevision || 0) !== Number(snapshotRef.current.revision || 0)
        || snapshotRef.current.rows.length === 0
        || Number(observation?.startIndex) < 0
        || Number(observation?.endIndex) < Number(observation?.startIndex)) return false;
      setViewabilityState((previous) => (
        previous.controller === controller && previous.visible
          ? previous
          : { controller, visible: true }
      ));
      return true;
    },
    onSurfaceVisibilityChange(visible) {
      if (committedOwnerRef.current !== commitOwnerCandidate || visible === true) return;
      domEvidence.clear();
      // Once the surface is hidden, the current committed projection is
      // definitive negative visibility evidence; do not leave its candidates
      // waiting for a layout observation that a hidden adapter will not emit.
      resolveArrivals();
      publishTailPresence();
    },
    consumeBottomIntent(intent) {
      const before = controller.getSnapshot().session;
      const after = controller.update((current) => consumeLatestIntent(current, {
        ...intent,
        activationID: controller.activationID,
      }));
      return after !== before;
    },
    jumpToLatest() {
      requestBottom('latest');
      // Freshness is a data obligation, not a second scroll command. The
      // adapter consumes the one bottom intent only after the current head is
      // installed; a later user input invalidates it before that can happen.
      if (typeof history.refreshLatest === 'function') {
        setLatestRequiredRevision(Number(syncStatus.interestRevision || 0) + 1);
      }
      void Promise.resolve(history.refreshLatest?.()).catch((error) => {
        diagnostic('warn', 'history.latest_refresh_failed', { channelId: channelID, error });
      });
    },
    requestBottom,
    captureBottomIntent,
    bindBottomIntentTargets,
    revokeBottomIntent,
    isFollowing() { return controller.getSnapshot().session.mode === READING_MODE.following; },
    getSession() { return controller.getSnapshot().session; },
  }), [acknowledgeChannelNotifications, acknowledgeInstalledTail, acknowledgeVisibleRows, availability, availabilityError, beginNavigation, bindBottomIntentTargets, blockingHistoryError, bottomReady, cachePhase, cancelNavigation, captureBottomIntent, channelID, commitOwnerCandidate, controller, currentAdmissionAuthority, domEvidence, emptyReason, finishNavigation, foregroundHistoryError, freshnessError, freshnessPhase, history, historyBoundary, historyConsumer, historyDemand, historyStatus, localReplicaError, markVisibleTailRead, presentationAuthority, presentationInitializing, presentationPending, publishTailPresence, requestBottom, requestHistory, resolveArrivals, restorePending, revokeBottomIntent, semanticRangeEstablished, session, surfaceVisible, syncHistoryError, syncStatus.interestRevision, tailCaughtUp, unseen, updateNavigation]);
}
