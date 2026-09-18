import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { HISTORY_INTENT, HISTORY_URGENCY } from '../../model/history-demand.js';
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

// Anticipatory reveal is deliberately smaller than the Scheduler's warm raw
// reservoir. These are raw ledger records/bytes, not rendered message rows;
// filtered facts may require several cooperative segments before one visible
// presentation row advances the frontier.
const HISTORY_RUNWAY_REVEAL_RECORDS = 8;
const HISTORY_RUNWAY_REVEAL_BYTES = 256 * 1024;
// Presentation-only budget: history correctness does not expire here. After
// this bounded wait the live window becomes readable and the saved bookmark is
// kept for a future activation; a late page is only a normal prepend.
const RESTORE_INITIALIZATION_BUDGET_MS = 500;
const PENDING_ARRIVAL_LIMIT = 1_024;
const EMPTY_REQUEST = () => Promise.resolve({ kind: 'exhausted' });
const IDLE_HISTORY_DEMAND = Object.freeze({ revision: 0, phase: 'idle', error: '' });
const BLOCKING_ADMISSION_PHASES = new Set(['pending-baseline-commit', 'committed-awaiting-layout']);
const ADDRESSABLE_ADMISSION_PHASES = new Set(['pending', 'pending-baseline-commit', 'committed-awaiting-layout']);

function currentBlockingAdmission(historyStatus, channelID, activationID, viewKey) {
  const authority = historyStatus?.presentationAdmission;
  // The render snapshot can lag a synchronous Scheduler settle by one React
  // commit. Prefer the authority's live state so another zero-row under-fill
  // cannot replace the just-settled transaction before Timeline publishes it.
  const live = authority?.snapshot?.(channelID);
  const state = live || historyStatus?.presentationAdmissionState;
  if (!state || !BLOCKING_ADMISSION_PHASES.has(state.phase)) return null;
  const token = state.token || state.committed;
  if (!token) return authority?.snapshot ? null : state;
  const expectedEpoch = `${channelID}:${Number(historyStatus?.generation || 0)}`;
  return token.activationID === activationID
    && token.viewID === viewKey
    && token.epoch === expectedEpoch
    ? state
    : null;
}

// The admission authority owns a reveal operation after begin; the transport
// request merely carries the same handle while its promise is alive. Read the
// live authority first so every caller uses the operation's lifetime, while
// fencing retired activation/view/generation owners before exposing it.
function currentAdmissionOperationID(historyStatus, channelID, activationID, viewKey) {
  const state = historyStatus?.presentationAdmission?.snapshot?.(channelID);
  const token = state?.token || state?.committed;
  const expectedEpoch = `${channelID}:${Number(historyStatus?.generation || 0)}`;
  return state && ADDRESSABLE_ADMISSION_PHASES.has(state.phase)
    && token?.activationID === activationID
    && token?.viewID === viewKey
    && token?.epoch === expectedEpoch
    ? String(token.operationID || '')
    : '';
}

function historyProgressKey(historyStatus = {}) {
  return JSON.stringify([
    Number(historyStatus.generation || 0),
    historyStatus.attached === true,
    historyStatus.messageCurrent === true,
    historyStatus.hasOlder === true,
    historyStatus.loading === true,
    Number(historyStatus.completedPages || 0),
    Number(historyStatus.revealVersion || 0),
    Number(historyStatus.presentationRevision || 0),
    Number(historyStatus.retryAt || 0),
    String(historyStatus.error || ''),
    Number(historyStatus.historyDemand?.revision || 0),
    String(historyStatus.sourceLease || ''),
  ]);
}

function historySourceAuthorityKey(historyStatus = {}) {
  return JSON.stringify([
    Number(historyStatus.generation || 0),
    historyStatus.attached === true,
    historyStatus.localReplicaReady === true,
    String(historyStatus.sourceLease || ''),
  ]);
}

// A local-only exhausted result completes one semantic obligation against one
// exact cache frontier. Foreground pending/idle revisions are consequences of
// executing that obligation, not new supply. Only source ownership or actual
// cache/page/reveal progress may make the same obligation runnable again.
function historySupplyProgressKey(historyStatus = {}) {
  return JSON.stringify([
    historySourceAuthorityKey(historyStatus),
    Number(historyStatus.oldestSeq || 0),
    Number(historyStatus.completedPages || 0),
    Number(historyStatus.revealVersion || 0),
    Number(historyStatus.buffered || 0),
    historyStatus.hasOlder === true,
  ]);
}

function ownsHistoryOperation(currentOwner, requestOwner, controller, activePromise, promise) {
  return currentOwner.controller === controller
    && currentOwner.activationID === requestOwner.activationID
    && currentOwner.channelID === requestOwner.channelID
    && currentOwner.viewKey === requestOwner.viewKey
    && Number(currentOwner.historyStatus?.generation || 0)
      === Number(requestOwner.historyStatus?.generation || 0)
    && activePromise === promise;
}

function rangeCovers(ranges = [], low, high) {
  const start = Number(low || 0);
  const end = Number(high || 0);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end < start) return false;
  return ranges.some((range) => Number(range?.lowSeq || 0) <= start && Number(range?.highSeq || 0) >= end);
}

export function currentEntryAuthority({ snapshot, historyStatus, bottomReady, availability, authoritativeEmpty }) {
  const candidate = snapshot?.currentEntryCandidate;
  const durableCandidateCovered = Boolean(
    candidate
    && candidate.local !== true
    && rangeCovers(historyStatus?.coverage, candidate.seqHigh, historyStatus?.headSeq),
  );
  const localEchoTailCovered = Boolean(
    candidate?.local === true
    && (
      authoritativeEmpty
      || (bottomReady && rangeCovers(historyStatus?.coverage, historyStatus?.headSeq, historyStatus?.headSeq))
    ),
  );
  if (availability !== 'readable'
    || !candidate
    || (!((bottomReady && durableCandidateCovered) || localEchoTailCovered))) return null;
  return Object.freeze({
    epoch: snapshot.epoch,
    viewID: snapshot.viewID,
    sourceRevision: Number(snapshot.sourceRevision || 0),
    candidateID: candidate.id,
  });
}

export function pendingArrivalEvents(arrivals, previousRevision) {
  const revision = Number(arrivals?.revision || 0);
  const events = arrivals?.events || [];
  const baseRevision = Math.max(0, revision - events.length);
  const firstIndex = Math.max(0, Number(previousRevision || 0) - baseRevision);
  return events.slice(firstIndex)
    .filter((event) => Number(event?.revision || 0) > previousRevision && Number(event?.revision || 0) <= revision);
}

// Reaching the latest content of one semantic view acknowledges the backlog
// that view has actually installed, not only the rows that happen to be inside
// the viewport at that instant. The set is bounded by the DOM-derived
// installed high-water so a row that lands after the observation (seqHigh
// above it) is never swept into this older receipt. Local echo rows carry no
// durable identity and are excluded.
export function installedTailReadRows(rows = [], installedHighSeq = 0, visibleRows = []) {
  const high = Number(installedHighSeq || 0);
  const byID = new Map();
  const admit = (messageID, seqHigh) => {
    const id = String(messageID || '');
    const seq = Number(seqHigh || 0);
    if (!id || !Number.isSafeInteger(seq) || seq <= 0 || seq > high) return;
    byID.set(id, Math.max(byID.get(id) || 0, seq));
  };
  for (const row of visibleRows || []) admit(row?.messageID, row?.seqHigh);
  for (const row of rows || []) {
    if (!row || row.localState || row.body?.local === true) continue;
    admit(row.id, row.seqHigh);
  }
  return Object.freeze([...byID].map(([messageID, seqHigh]) => Object.freeze({ messageID, seqHigh })));
}

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
  // 观测写进 visibleTailEvidenceRef，这里保存的是该证据在本 activation 上的最
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
  const needsInitialization = Boolean(
    (session.mode === READING_MODE.browsing
      && session.bookmark
      && !snapshot.rows.some((row) => row.id === session.bookmark.messageID))
    // A fresh activation also gets one declarative initialization. Without
    // this boundary a streamed initial tail can mount at its first partial
    // projection, then leave the last rows below the viewport if the
    // virtualizer observes several appends before currentness is established.
    || (session.mode === READING_MODE.following && hasManagedHistoryLifecycle)
  );
  const [initializationState, setInitializationState] = useState(() => ({
    controller,
    value: needsInitialization,
  }));
  // useState initializers do not rerun when a semantic view replaces the
  // controller. Derive the replacement activation's first render from its own
  // saved session, while late setters from the retired controller remain
  // tagged and therefore cannot publish readiness for the new activation.
  const initializing = initializationState.controller === controller
    ? initializationState.value
    : needsInitialization;
  const setInitializing = useCallback((value) => {
    setInitializationState((current) => ({
      controller,
      value: typeof value === 'function' ? Boolean(value(
        current.controller === controller ? current.value : needsInitialization,
      )) : Boolean(value),
    }));
  }, [controller, needsInitialization]);
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
  const markReadRef = useRef(markReadPort);
  const resolveArrivalsRef = useRef(null);
  const acknowledgeArrivalsRef = useRef(null);
  const arrivalsRef = useRef(arrivals);
  const visibleTailEvidenceRef = useRef({
    owner: commitOwnerCandidate,
    controller,
    activationID: controller.activationID,
    atTail: false,
    surfaceVisible: false,
    installedHighSeq: 0,
    presentationRevision: 0,
    sourceRevision: 0,
    generation: 0,
    headSeq: 0,
    notificationAuthorityRevision: 0,
    observationRevision: 0,
    visibleRows: Object.freeze([]),
    readPending: false,
  });
  // One channel mount owns one notification confirmation lifecycle even when
  // its semantic filter replaces the Reading controller. A backlog boundary
  // is born only from a legal committed DOM tail observation; follow events
  // are presentation-bounded. Pending delivery retains the immutable object.
  const notificationConfirmationRef = useRef({
    authorityRevision: Number(historyStatus.notificationAuthorityRevision || 0),
    generation: Number(historyStatus.generation || 0),
    needsBacklog: true,
    requiredObservationRevision: 1,
    confirmedBoundary: 0,
    queuedPresented: null,
    pending: null,
  });
  const notificationObservationRevisionRef = useRef(0);
  const acknowledgeChannelNotificationsRef = useRef(null);
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
  const runwayRequestRef = useRef(null);
  const deferredAdmissionDemandRef = useRef(null);
  const failedAnticipatoryRequestRef = useRef(null);
  const exhaustedHistoryKeyRef = useRef(null);
  const localExhaustedHistoryKeyRef = useRef(null);
  const arrivalBaseline = Number.isSafeInteger(Number(arrivals?.acknowledgedRevision))
    ? Number(arrivals.acknowledgedRevision)
    : Number(arrivals?.revision || 0);
  const arrivalCursorRef = useRef({ controller, revision: arrivalBaseline });
  const arrivalDispositionRef = useRef({
    controller,
    throughRevision: arrivalBaseline,
    acknowledgedRevision: arrivalBaseline,
  });
  const historyEpochRef = useRef(0);
  const initializationDeadlineRef = useRef({ controller: null, deadline: 0 });
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
  const bottomReady = currentTailKnown
    && latestObligationFulfilled
    && currentPresentationKnown;
  const knownHead = Math.max(
    Number(historyStatus.headSeq || 0),
    Number(syncStatus.targetHead || 0),
  );
  const historySourceKey = historySourceAuthorityKey(historyStatus);
  const authoritativeEmpty = hasManagedHistoryLifecycle
    && historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && historyStatus.localReplicaReady !== false
    && knownHead === 0
    && syncObservationCurrent;
  // Restore supply and readable presentation are independent. A missing saved
  // bookmark keeps the initial-view request alive, but must never replace rows
  // that are already readable with a recovery placeholder.
  const presentationInitializing = initializing
    && snapshot.rows.length === 0
    && !authoritativeEmpty;
  // Unlike `initializing`, this never controls whether readable rows render.
  // The list uses it only to defer its one exact bookmark positioning command
  // until the initial-view supply effect has observed the installed target.
  const restorePending = initializing && session.mode === READING_MODE.browsing;
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
    && historyStatus.loading !== true
    && syncObservationCurrent;
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
  const availabilityError = foregroundHistoryError
    ? String(historyStatus.historyDemand?.error || historyStatus.error || '')
    : syncHistoryError || localReplicaError || (!semanticRangeEstablished ? String(historyStatus.error || '') : '');
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
    // A non-local exhausted operation is the Scheduler's authoritative EOF
    // receipt for this attachment generation. The React hasOlder snapshot can
    // still be true for one commit after that receipt, so it cannot revoke the
    // cache. Only a new controller/generation names a different authority.
    const exhausted = exhaustedHistoryKeyRef.current;
    if (exhausted && (exhausted.controller !== controller
      || exhausted.generation !== Number(historyStatus.generation || 0))) {
      exhaustedHistoryKeyRef.current = null;
    }
  }, [controller, historyStatus.generation]);

  useEffect(() => {
    // Exhaustion and request coalescing are properties of one semantic view,
    // not of the channel's physical cursor. Switching scope/member filters
    // cancels the preceding semantic obligation before the new view opens its
    // own operation. The shared scheduler remains the sole physical owner.
    runwayRequestRef.current?.abortController?.abort();
    runwayRequestRef.current = null;
    deferredAdmissionDemandRef.current = null;
    failedAnticipatoryRequestRef.current = null;
    exhaustedHistoryKeyRef.current = null;
    localExhaustedHistoryKeyRef.current = null;
    return () => {
      if (runwayRequestRef.current?.controller === controller) {
        runwayRequestRef.current.abortController?.abort();
        runwayRequestRef.current = null;
      }
      if (deferredAdmissionDemandRef.current?.controller === controller) {
        deferredAdmissionDemandRef.current = null;
      }
      if (failedAnticipatoryRequestRef.current?.controller === controller) {
        failedAnticipatoryRequestRef.current = null;
      }
    };
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
    if (!initializing) return undefined;
    const bookmark = sessionRef.current.bookmark;
    const following = sessionRef.current.mode === READING_MODE.following;
    // `bottomReady` authorizes following geometry; it does not prove that the
    // current semantic view has anything readable. Ending initialization from
    // raw-head currentness alone exposes a transient filtered-empty state while
    // the existing semantic runway is still finding its first matching row.
    if ((following && (snapshot.rows.length > 0 || authoritativeEmpty || semanticExhausted))
      || (!following && (!bookmark || snapshot.rows.some((row) => row.id === bookmark.messageID)))) {
      diagnostic('debug', 'reading.initialization_ready', {
        channelId: channelID,
        viewKey,
        mode: following ? READING_MODE.following : READING_MODE.browsing,
        sourceRevision: Number(snapshot.sourceRevision || 0),
        presentationRevision: Number(historyStatus.presentationRevision || 0),
        rowCount: snapshot.rows.length,
      });
      setInitializing(false);
      return undefined;
    }
    let active = true;
    if (initializationDeadlineRef.current.controller !== controller) {
      initializationDeadlineRef.current = {
        controller,
        deadline: Date.now() + RESTORE_INITIALIZATION_BUDGET_MS,
      };
    }
    const remaining = Math.max(0, initializationDeadlineRef.current.deadline - Date.now());
    const timer = setTimeout(() => {
      if (!active) return;
      diagnostic('warn', 'reading.initialization_degraded', {
        channelId: channelID,
        viewKey,
        mode: following ? READING_MODE.following : READING_MODE.browsing,
        headSeq: Number(historyStatusRef.current.headSeq || 0),
        sourceRevision: Number(snapshotRef.current.sourceRevision || 0),
        presentationRevision: Number(historyStatusRef.current.presentationRevision || 0),
        visibleHighSeq: snapshotRef.current.rows.reduce(
          (high, row) => Math.max(high, Number(row.seqHigh || 0)),
          0,
        ),
      });
      setInitializing(false);
    }, remaining);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [authoritativeEmpty, channelID, controller, initializing, semanticExhausted, setInitializing, snapshot, viewKey]);

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

  const requestHistory = useCallback((
    reason,
    urgency = HISTORY_URGENCY.interactive,
    {
      revealRows,
      revealBytes,
      demandUnits = 1,
      intent = HISTORY_INTENT.scrollHistory,
      targetSeq = 0,
      requiredVisibleCoverage = null,
    } = {},
  ) => {
    if (committedOwnerRef.current !== commitOwnerCandidate) {
      return Promise.resolve({ kind: 'stale-owner', deduplicated: true });
    }
    const requestOwner = committedOwnerRef.current;
    const first = snapshotRef.current.rows[0];
    const key = `${first?.id || ''}:${first?.seqLow || 0}`;
    const obligationKey = JSON.stringify([
      intent,
      Number(targetSeq || 0),
      String(requiredVisibleCoverage?.messageID || ''),
      Number(requiredVisibleCoverage?.seq || 0),
      key,
    ]);
    const exhausted = exhaustedHistoryKeyRef.current;
    if (exhausted?.controller === controller
      && exhausted.generation === Number(historyStatusRef.current.generation || 0)
      && exhausted.key === obligationKey) {
      return Promise.resolve({ kind: 'exhausted', deduplicated: true });
    }
    const localExhausted = localExhaustedHistoryKeyRef.current;
    const supplyProgressKey = historySupplyProgressKey(historyStatusRef.current);
    if (localExhausted?.controller === controller
      && localExhausted.key === obligationKey
      && localExhausted.progressKey === supplyProgressKey) {
      return Promise.resolve({ kind: 'exhausted', localOnly: true, deduplicated: true });
    }
    const failedAnticipatory = failedAnticipatoryRequestRef.current;
    if (urgency !== HISTORY_URGENCY.interactive
      && failedAnticipatory?.controller === controller
      && failedAnticipatory.activationID === controller.activationID
      && failedAnticipatory.channelID === channelID
      && failedAnticipatory.viewKey === viewKey
      && failedAnticipatory.key === obligationKey
      && failedAnticipatory.progressKey === historyProgressKey(historyStatusRef.current)) {
      return Promise.resolve({ kind: 'failed-pending-progress', deduplicated: true });
    }
    if (urgency === HISTORY_URGENCY.interactive) failedAnticipatoryRequestRef.current = null;
    if (runwayRequestRef.current) {
      const active = runwayRequestRef.current;
      const currentSourceKey = historySourceAuthorityKey(historyStatusRef.current);
      if (active.controller === controller
        && (active.sourceKey !== currentSourceKey || active.key !== obligationKey)) {
        const sourceChanged = active.sourceKey !== currentSourceKey;
        active.abortController?.abort(sourceChanged
          ? 'history-source-replaced'
          : 'history-obligation-replaced');
        diagnostic('info', 'history.intent_handoff', {
          channelId: channelID,
          viewKey,
          fromSourceLease: active.sourceKey,
          toSourceLease: currentSourceKey,
          sourceChanged,
        });
        // The caller's exact immutable obligation is the successor. Chaining
        // it to the one active attempt makes settlement itself the handoff;
        // no React refresh edge or second pending/error lifecycle is needed.
        return active.promise.then(() => requestHistory(reason, urgency, {
          revealRows,
          revealBytes,
          demandUnits,
          intent,
          targetSeq,
          requiredVisibleCoverage,
        }));
      }
      if (urgency === HISTORY_URGENCY.interactive
        && active.urgency !== HISTORY_URGENCY.interactive) {
        const promoted = active.operation?.promote?.({
          intent,
          urgency: HISTORY_URGENCY.interactive,
        }) === true;
        active.urgency = HISTORY_URGENCY.interactive;
        diagnostic('debug', 'history.intent_promoted', {
          channelId: channelID,
          epoch: active.epoch,
          viewKey,
          reason,
          promoted,
        });
        readingTrace('history.intent-promoted', {
          activationID: controller.activationID,
          inputEpoch: controller.getSnapshot().session.inputEpoch,
          presentationRevision: Number(snapshotRef.current.revision || 0),
          channelId: channelID,
          epoch: active.epoch,
          viewKey,
          reason,
          promoted,
        });
      }
      return active.promise;
    }
    const admission = currentBlockingAdmission(
      historyStatusRef.current,
      channelID,
      controller.activationID,
      viewKey,
    );
    if (admission) {
      if (urgency === HISTORY_URGENCY.interactive) {
        const previous = deferredAdmissionDemandRef.current;
        deferredAdmissionDemandRef.current = {
          controller,
          activationID: controller.activationID,
          channelID,
          viewKey,
          generation: Number(historyStatusRef.current.generation || 0),
          reason,
          urgency,
          revealRows: Math.max(Number(previous?.revealRows || 0), Number(revealRows || 0)),
          revealBytes: Math.max(Number(previous?.revealBytes || 0), Number(revealBytes || 0)),
          demandUnits: Math.max(Number(previous?.demandUnits || 1), Number(demandUnits || 1)),
          intent,
          targetSeq: Number(targetSeq || 0),
          requiredVisibleCoverage,
        };
      }
      return Promise.resolve({ kind: 'admission-pending', deduplicated: true });
    }
    const epoch = historyEpochRef.current + 1;
    historyEpochRef.current = epoch;
    const attemptProgressKey = historySourceAuthorityKey(historyStatusRef.current);
    const attemptSupplyProgressKey = historySupplyProgressKey(historyStatusRef.current);
    diagnostic('debug', 'history.intent_started', {
      channelId: channelID,
      epoch,
      viewKey,
      reason,
      urgency,
      anchorSeq: Number(first?.seqLow || 0),
      installedVisibleRows: snapshotRef.current.rows.length,
      scope: historyViewSpec?.scope || '',
      actorFilterCount: Number(historyViewSpec?.actorFilter?.size || 0),
      intent,
      targetSeq: Number(targetSeq || 0),
      revealRows: Number(revealRows || 0),
      revealBytes: Number(revealBytes || 0),
      sourceLease: String(historyStatusRef.current.sourceLease || ''),
    });
    readingTrace('history.intent-started', {
      activationID: controller.activationID,
      inputEpoch: controller.getSnapshot().session.inputEpoch,
      presentationRevision: Number(snapshotRef.current.revision || 0),
      channelId: channelID,
      epoch,
      viewKey,
      reason,
      urgency,
      anchorID: first?.id || '',
      anchorSeq: Number(first?.seqLow || 0),
      revealRows: Number(revealRows || 0),
      revealBytes: Number(revealBytes || 0),
    });
    const abortController = new AbortController();
    let historyOperation = null;
    const activeSession = controller.getSnapshot().session;
    const uiBaselineIDs = Object.freeze(snapshotRef.current.rows.map((row) => row.id));
    const durableBaselineIDs = Object.freeze(snapshotRef.current.rows
      .filter((row) => !row.localState && row.body?.local !== true)
      .map((row) => row.id));
    const historyRevealIntent = intent === HISTORY_INTENT.scrollHistory ? {
      activationID: controller.activationID,
      inputEpoch: activeSession.inputEpoch,
      operationID: `history:${controller.activationID}:${epoch}`,
      viewID: viewKey,
      epoch: `${channelID}:${Number(historyStatusRef.current.generation || 0)}`,
      baselinePresentationRevision: Number(snapshotRef.current.revision || 0),
      uiBaselineIDs,
      durableBaselineIDs,
      anchorID: first?.id || '',
      anchorSeq: Number(first?.seqLow || 0),
      demandUnits: Math.max(1, Math.min(24, Number(demandUnits) || 1)),
    } : null;
    const promise = Promise.resolve(requestPort({
      intent,
      urgency,
      signal: abortController.signal,
      anchorSeq: Number(first?.seqLow || 0),
      targetSeq: Number(targetSeq || 0),
      requiredVisibleCoverage: requiredVisibleCoverage || undefined,
      revealRows,
      revealBytes,
      reason,
      explicitRetry: reason === 'retry' || reason === 'retry-restore',
      viewSpec: historyViewSpec,
      historyRevealIntent,
      onOperation(operation) {
        historyOperation = operation;
        const active = runwayRequestRef.current;
        if (active?.controller === controller && active.epoch === epoch) active.operation = operation;
      },
    })).then((result) => {
      const currentOwner = committedOwnerRef.current;
      const operationStillCurrent = ownsHistoryOperation(
        currentOwner,
        requestOwner,
        controller,
        runwayRequestRef.current?.promise,
        promise,
      );
      const currentStatus = operationStillCurrent ? currentOwner.historyStatus : requestOwner.historyStatus;
      // A pre-attach or local-only empty source is not authoritative remote
      // exhaustion. Cache only the attached generation's explicit boundary.
      if (operationStillCurrent
        && result?.kind === 'exhausted'
        && currentStatus.attached === true
        && Number(currentStatus.generation || 0) > 0
        && result?.localOnly !== true) {
        exhaustedHistoryKeyRef.current = {
          controller,
          generation: Number(currentStatus.generation || 0),
          key: obligationKey,
        };
      }
      if (operationStillCurrent
        && result?.kind === 'exhausted'
        && result?.localOnly === true
        && historySupplyProgressKey(currentStatus) === attemptSupplyProgressKey) {
        localExhaustedHistoryKeyRef.current = {
          controller,
          key: obligationKey,
          progressKey: attemptSupplyProgressKey,
        };
      }
      if (operationStillCurrent && result?.kind === 'failed'
        && urgency !== HISTORY_URGENCY.interactive) {
        failedAnticipatoryRequestRef.current = {
          controller,
          activationID: requestOwner.activationID,
          channelID,
          viewKey,
          key: obligationKey,
          progressKey: historyProgressKey(currentStatus),
        };
      } else if (operationStillCurrent && result?.kind !== 'failed') {
        failedAnticipatoryRequestRef.current = null;
      }
      diagnostic(result?.kind === 'failed' ? 'warn' : 'debug', `history.intent_${result?.kind || 'failed'}`, {
        channelId: channelID,
        epoch,
        viewKey,
        reason,
        anchorSeq: Number(first?.seqLow || 0),
      });
      readingTrace('history.intent-settled', {
        activationID: requestOwner.activationID,
        inputEpoch: controller.getSnapshot().session.inputEpoch,
        presentationRevision: Number(
          (operationStillCurrent ? currentOwner.snapshot : requestOwner.snapshot)?.revision || 0,
        ),
        channelId: channelID,
        epoch,
        viewKey,
        reason,
        anchorSeq: Number(first?.seqLow || 0),
        result: result?.kind || 'failed',
      });
      return result;
    }, (error) => {
      const currentOwner = committedOwnerRef.current;
      const operationStillCurrent = ownsHistoryOperation(
        currentOwner,
        requestOwner,
        controller,
        runwayRequestRef.current?.promise,
        promise,
      );
      if (operationStillCurrent && urgency !== HISTORY_URGENCY.interactive) {
        failedAnticipatoryRequestRef.current = {
          controller,
          activationID: requestOwner.activationID,
          channelID,
          viewKey,
          key: obligationKey,
          progressKey: historyProgressKey(currentOwner.historyStatus),
        };
      }
      diagnostic('warn', 'history.intent_failed', { channelId: channelID, epoch, viewKey, reason, error });
      readingTrace('history.intent-failed', {
        activationID: controller.activationID,
        inputEpoch: controller.getSnapshot().session.inputEpoch,
        presentationRevision: Number(snapshotRef.current.revision || 0),
        channelId: channelID,
        epoch,
        viewKey,
        reason,
        errorName: error?.name || 'Error',
      });
      return { kind: 'failed', error };
    }).finally(() => {
      if (runwayRequestRef.current?.promise !== promise) return;
      runwayRequestRef.current = null;
    });
    runwayRequestRef.current = {
      key: obligationKey,
      sourceKey: attemptProgressKey,
      promise,
      abortController,
      controller,
      epoch,
      urgency,
      operation: historyOperation,
      operationID: historyRevealIntent?.operationID || '',
    };
    return promise;
  }, [channelID, commitOwnerCandidate, controller, historyViewSpec, requestPort, viewKey]);

  useEffect(() => {
    const bookmark = session.bookmark;
    if (session.mode === READING_MODE.following
      || !bookmark
      || snapshot.rows.some((row) => row.id === bookmark.messageID)
      || authoritativeEmpty
      || semanticExhausted) return;
    // Saved-position recovery is the same activation-owned attempt as every
    // other history demand. Its immutable target survives presentation-shell
    // degradation; source replacement cancels the old physical operation and
    // the single attempt registry hands this exact obligation to the new one.
    void requestHistory('restore-reading', HISTORY_URGENCY.blocking, {
      intent: HISTORY_INTENT.initialView,
      targetSeq: Number(bookmark.seq || 0),
      requiredVisibleCoverage: {
        messageID: bookmark.messageID,
        seq: Number(bookmark.seq || 0),
      },
    });
  }, [
    authoritativeEmpty,
    historySourceKey,
    requestHistory,
    semanticExhausted,
    session.bookmark,
    session.mode,
    snapshot.rows,
  ]);

  useEffect(() => {
    const deferred = deferredAdmissionDemandRef.current;
    if (!deferred) return;
    const currentGeneration = Number(historyStatus.generation || 0);
    const ownerCurrent = deferred.controller === controller
      && deferred.activationID === controller.activationID
      && deferred.channelID === channelID
      && deferred.viewKey === viewKey
      && deferred.generation === currentGeneration;
    if (!ownerCurrent) {
      deferredAdmissionDemandRef.current = null;
      return;
    }
    if (currentBlockingAdmission(
      historyStatus,
      channelID,
      controller.activationID,
      viewKey,
    )) return;
    deferredAdmissionDemandRef.current = null;
    void requestHistory(deferred.reason, deferred.urgency, {
      revealRows: deferred.revealRows,
      revealBytes: deferred.revealBytes,
      demandUnits: deferred.demandUnits,
      intent: deferred.intent,
      targetSeq: deferred.targetSeq,
      requiredVisibleCoverage: deferred.requiredVisibleCoverage,
    });
  }, [
    channelID,
    controller,
    historyStatus.generation,
    historyStatus.presentationAdmission,
    historyStatus.presentationAdmissionState?.phase,
    requestHistory,
    viewKey,
  ]);

  useEffect(() => {
    // The virtual list can only report under-fill after it has at least one
    // row. A semantic projection with zero rows therefore needs its declarative
    // supply edge here: reuse the one HistoryScheduler operation and let
    // loadHistory continue across physical pages until this view gets a row or
    // reaches authoritative EOF. Explicit @me/member filters expose that work;
    // an unfiltered protocol-only projection may remain anticipatory.
    const attachedCurrent = historyStatus.attached === true
      && Number(historyStatus.generation || 0) > 0
      && historyStatus.messageCurrent === true;
    // A disconnected/pre-attach reader can still own a durable local source.
    // The scheduler knows whether that source can continue and returns a
    // bounded local-only exhaustion at its proven frontier. Requiring a Wire
    // generation here stranded matching rows in deeper IndexedDB pages: the
    // first physical page could be real but semantically empty, while only a
    // list row (which did not exist) was otherwise allowed to ask for more.
    const localReplicaAvailable = historyStatus.localReplicaReady === true
      && Number(historyStatus.generation || 0) === 0;
    if (snapshot.rows.length > 0
      || !hasManagedHistoryLifecycle
      || (!attachedCurrent && !localReplicaAvailable)
      || historyStatus.localReplicaReady === false
      || historyStatus.hasOlder !== true
      || historyStatus.historyDemand?.phase === 'error'
      || knownHead <= 0) return;
    const bookmark = session.bookmark;
    if (session.mode !== READING_MODE.following
      && bookmark
      && !snapshot.rows.some((row) => row.id === bookmark.messageID)) return;
    const explicitlyFiltered = Number(historyViewSpec?.actorFilter?.size || 0) > 0
      || historyViewSpec?.scope === 'mine';
    // A zero-row result after the person selected @me or an actor is visible
    // work: keep one foreground demand alive so the UI can show continuous
    // progress and a retry if paging fails. Only an unfiltered projection that
    // contains protocol-only facts remains anticipatory/background work.
    void requestHistory(
      'projection-underfill',
      explicitlyFiltered ? HISTORY_URGENCY.interactive : HISTORY_URGENCY.anticipatory,
    );
  }, [
    hasManagedHistoryLifecycle,
    historyStatus.attached,
    historyStatus.buffered,
    historyStatus.completedPages,
    historyStatus.error,
    historyStatus.generation,
    historyStatus.hasOlder,
    historyStatus.historyDemand?.phase,
    historyStatus.localReplicaReady,
    historyStatus.loading,
    historyStatus.messageCurrent,
    historyStatus.presentationRevision,
    historyStatus.presentationAdmissionState?.phase,
    historyStatus.revealVersion,
    historySourceKey,
    knownHead,
    requestHistory,
    snapshot.rows.length,
    session.bookmark,
    session.mode,
    historyViewSpec,
    viewKey,
  ]);

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
    const evidence = visibleTailEvidenceRef.current;
    if (evidence.controller !== controller
      || evidence.activationID !== current.activationID) return false;
    const evidenceCurrent = evidence.owner === owner;
    const canUseVisibleEvidence = evidenceCurrent
      && evidence.surfaceVisible === true
      && document.visibilityState === 'visible';
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
      acknowledgeChannelNotificationsRef.current?.(presentedBoundary);
    }
    acknowledgeDisposedArrivals();
    return resolution.decisions.length > 0;
  }, [acknowledgeDisposedArrivals, controller]);

  const acknowledgeVisibleRows = useCallback(() => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = visibleTailEvidenceRef.current;
    if (owner.controller !== controller
      || evidence.owner !== owner
      || evidence.controller !== controller
      || evidence.activationID !== current.activationID
      || evidence.surfaceVisible !== true
      || !evidence.visibleRows?.length
      || document.visibilityState !== 'visible') return false;
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
  }, [channelID, controller, historyViewSpec, unseen, viewKey]);

  // Installed-tail acknowledgement for the viewport notice. Same fences as the
  // durable tail receipt below: the observation must belong to the committed
  // owner and the currently presented revision, the reader must actually be
  // following at the physical tail, and the surface/document must be visible.
  // A jump-to-latest that has not yet reached the tail therefore clears nothing.
  const acknowledgeInstalledTail = useCallback(() => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = visibleTailEvidenceRef.current;
    if (owner.controller !== controller
      || evidence.owner !== owner
      || evidence.controller !== controller
      || evidence.activationID !== current.activationID
      || evidence.atTail !== true
      || evidence.surfaceVisible !== true
      || current.mode !== READING_MODE.following
      || Number(evidence.installedHighSeq || 0) <= 0
      || Number(evidence.presentationRevision || 0) !== Number(owner.snapshot.revision || 0)
      || document.visibilityState !== 'visible') return null;
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
  }, [acknowledgeDisposedArrivals, controller]);

  // 在场只是把已有证据读一遍再发布：跟随 ∧ 在底部 ∧ Surface 可见 ∧ 页面可见。
  // 证据必须属于当前 controller 的当前 activation。owner 提交本身不制造在场或
  // 离场事实；真正的 DOM 观测会以 atTail 精确更新这份读数。
  const publishTailPresence = useCallback(() => {
    const current = controller.getSnapshot().session;
    const evidence = visibleTailEvidenceRef.current;
    const live = evidence.controller === controller
      && evidence.activationID === current.activationID;
    const out = controller.observeTailPresence({
      atTail: live && evidence.atTail === true,
      surfaceVisible: live && evidence.surfaceVisible === true && surfaceVisible === true,
      documentVisible: document.visibilityState === 'visible',
    });
    return out;
  }, [controller, surfaceVisible]);

  const acknowledgeChannelNotifications = useCallback((presentedBoundary = 0) => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = visibleTailEvidenceRef.current;
    if (owner.controller !== controller
      || evidence.owner !== owner
      || evidence.controller !== controller
      || evidence.activationID !== current.activationID
      || evidence.atTail !== true
      || evidence.surfaceVisible !== true
      || current.mode !== READING_MODE.following
      || document.visibilityState !== 'visible') return false;
    const confirmation = notificationConfirmationRef.current;
    const authorityRevision = Number(evidence.notificationAuthorityRevision || 0);
    if (confirmation.authorityRevision !== authorityRevision) return false;

    // A continuous confirmation is born only from an eligible related
    // arrival that the current Presentation/DOM disposition has proved
    // installed at this tail. Freeze that observation now; later retries do
    // not borrow a newer Meta head or Presentation revision.
    const proposedBoundary = Math.min(
      Number(presentedBoundary || 0),
      Number(evidence.installedHighSeq || 0),
      Number(evidence.headSeq || 0),
    );
    if (proposedBoundary > confirmation.confirmedBoundary
      && owner.historyStatus.messageCurrent === true
      && Number(evidence.sourceRevision || 0) === Number(owner.historyStatus.presentationRevision || 0)) {
      const proposed = Object.freeze({
        channelId: channelID,
        viewKey,
        activationID: current.activationID,
        authorityRevision,
        generation: Number(evidence.generation || 0),
        cause: 'presented-follow',
        boundary: proposedBoundary,
        presentationRevision: Number(evidence.presentationRevision || 0),
        sourceRevision: Number(evidence.sourceRevision || 0),
        installedHighSeq: Number(evidence.installedHighSeq || 0),
        atTail: true,
        following: true,
        surfaceVisible: true,
      });
      if (!confirmation.queuedPresented
        || proposed.boundary > confirmation.queuedPresented.boundary) {
        confirmation.queuedPresented = proposed;
      }
    }

    let delivered = false;
    // A rejected event is always retried first. A later browsing departure may
    // meanwhile have armed one newer backlog observation, and one presented
    // follow boundary can also be queued behind it, hence the bounded three
    // deliveries through the same scalar reducer.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let event = confirmation.pending;
      if (!event
        && confirmation.needsBacklog
        && Number(evidence.observationRevision || 0) >= confirmation.requiredObservationRevision
        && owner.historyStatus.attached === true
        && Number(evidence.generation || 0) > 0) {
        // The backlog fact is born here, at the first legal committed DOM tail
        // observation after it was armed. Freeze this observation's Meta head;
        // attach/insertion renders before the tail cannot preselect a boundary.
        confirmation.needsBacklog = false;
        event = Object.freeze({
          channelId: channelID,
          viewKey,
          activationID: current.activationID,
          authorityRevision,
          generation: Number(evidence.generation || 0),
          cause: 'tail-backlog',
          boundary: Math.max(0, Number(evidence.headSeq || 0)),
          presentationRevision: Number(evidence.presentationRevision || 0),
          sourceRevision: Number(evidence.sourceRevision || 0),
          installedHighSeq: Number(evidence.installedHighSeq || 0),
          atTail: true,
          following: true,
          surfaceVisible: true,
        });
      } else if (!event
        && confirmation.queuedPresented?.boundary > confirmation.confirmedBoundary) {
        event = confirmation.queuedPresented;
      }
      if (!event) return delivered;
      if (event.boundary <= 0 && event.cause === 'tail-backlog') {
        confirmation.pending = null;
        delivered = true;
        continue;
      }
      const accepted = owner.markNotificationsRead?.(event, Object.freeze({
        viewKey: event.viewKey,
        activationID: event.activationID,
      }));
      if (accepted === false || accepted == null) {
        confirmation.pending = event;
        return false;
      }
      confirmation.pending = null;
      confirmation.confirmedBoundary = Math.max(confirmation.confirmedBoundary, event.boundary);
      if (confirmation.queuedPresented === event
        || confirmation.queuedPresented?.boundary <= confirmation.confirmedBoundary) {
        confirmation.queuedPresented = null;
      }
      delivered = true;
    }
    return delivered;
  }, [channelID, controller, viewKey]);
  acknowledgeChannelNotificationsRef.current = acknowledgeChannelNotifications;

  const markVisibleTailRead = useCallback(() => {
    const owner = committedOwnerRef.current;
    const current = controller.getSnapshot().session;
    const evidence = visibleTailEvidenceRef.current;
    const currentSnapshot = owner.snapshot;
    if (owner.controller !== controller
      || evidence.owner !== owner
      || evidence.controller !== controller
      || evidence.activationID !== current.activationID
      || evidence.atTail !== true
      || evidence.surfaceVisible !== true
      || current.mode !== READING_MODE.following
      || evidence.installedHighSeq <= 0
      || Number(evidence.presentationRevision || 0) !== Number(currentSnapshot.revision || 0)
      || document.visibilityState !== 'visible') return false;
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
    if (visibleTailEvidenceRef.current === evidence) {
      visibleTailEvidenceRef.current = {
        ...evidence,
        // The already fenced DOM evidence remains ReadingSession's single
        // delivery obligation until every downstream currentness/authority
        // gate accepts it. No lower layer stores a retry copy.
        readPending: accepted === false,
      };
    }
    return accepted || false;
  }, [channelID, controller, historyViewSpec, viewKey]);

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
    markReadRef.current = markReadPort;
    arrivalsRef.current = arrivals;
    resolveArrivalsRef.current = resolveArrivals;
    acknowledgeArrivalsRef.current = acknowledgeDisposedArrivals;
    const controllerChanged = previous.controller !== controller;
    const notificationAuthorityRevision = Number(historyStatus.notificationAuthorityRevision || 0);
    const notificationGeneration = Number(historyStatus.generation || 0);
    let confirmation = notificationConfirmationRef.current;
    if (confirmation.authorityRevision !== notificationAuthorityRevision
      || confirmation.generation !== notificationGeneration) {
      confirmation = {
        authorityRevision: notificationAuthorityRevision,
        generation: notificationGeneration,
        needsBacklog: true,
        requiredObservationRevision: notificationObservationRevisionRef.current + 1,
        confirmedBoundary: 0,
        queuedPresented: null,
        pending: null,
      };
      notificationConfirmationRef.current = confirmation;
    }
    // A semantic activation replacement invalidates receipts owned by its
    // predecessor. A deliberate departure from Following only arms a future
    // backlog observation: any receipt that was already born remains the same
    // immutable retry obligation while the person is browsing.
    if (controllerChanged) {
      confirmation.needsBacklog = true;
      confirmation.requiredObservationRevision = notificationObservationRevisionRef.current + 1;
      confirmation.queuedPresented = null;
      confirmation.pending = null;
    } else if (previous.session?.mode === READING_MODE.following
      && session.mode !== READING_MODE.following) {
      confirmation.needsBacklog = true;
      confirmation.requiredObservationRevision = notificationObservationRevisionRef.current + 1;
    }
    if (confirmation.pending
      && (confirmation.pending.activationID !== controller.activationID
        || confirmation.pending.generation !== notificationGeneration)) {
      confirmation.pending = null;
    }
    if (confirmation.queuedPresented
      && (confirmation.queuedPresented.activationID !== controller.activationID
        || confirmation.queuedPresented.generation !== notificationGeneration)) {
      confirmation.queuedPresented = null;
    }
    const sameObservationAuthority = !controllerChanged
      && previous.activationID === commitOwnerCandidate.activationID
      && previous.channelID === commitOwnerCandidate.channelID
      && previous.viewKey === commitOwnerCandidate.viewKey
      && Number(previous.session?.inputEpoch || 0) === Number(session?.inputEpoch || 0)
      && Number(previous.snapshot?.revision || 0) === Number(snapshot?.revision || 0)
      && Number(previous.snapshot?.sourceRevision || 0) === Number(snapshot?.sourceRevision || 0)
      && Number(previous.historyStatus?.generation || 0) === Number(historyStatus?.generation || 0);
    if (sameObservationAuthority
      && visibleTailEvidenceRef.current.owner === previous) {
      // Controller persistence/geometry updates can render a new session
      // object without changing what the DOM actually presents. Transfer the
      // evidence only across that exact authority tuple.
      visibleTailEvidenceRef.current = {
        ...visibleTailEvidenceRef.current,
        owner: commitOwnerCandidate,
      };
    } else if (controllerChanged
      || (surfaceVisible !== true && visibleTailEvidenceRef.current.surfaceVisible !== true)) {
      // A hidden committed surface is definitive negative visibility evidence
      // for its own projection. A visible new projection deliberately keeps
      // the preceding owner token, forcing a fresh DOM observation.
      visibleTailEvidenceRef.current = {
        owner: commitOwnerCandidate,
        controller,
        activationID: controller.activationID,
        atTail: false,
        surfaceVisible: false,
        installedHighSeq: 0,
        presentationRevision: 0,
        sourceRevision: 0,
        generation: 0,
        headSeq: 0,
        notificationAuthorityRevision,
        observationRevision: notificationObservationRevisionRef.current,
        visibleRows: Object.freeze([]),
        readPending: false,
      };
    }
    if (controllerChanged) {
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
    markNotificationsReadPort,
    resolveArrivals,
    session,
    snapshot,
    surfaceVisible,
  ]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        publishTailPresence();
        return;
      }
      const installed = acknowledgeInstalledTail();
      resolveArrivals();
      acknowledgeVisibleRows();
      acknowledgeChannelNotifications(installed?.presentedBoundary || 0);
      markVisibleTailRead();
      publishTailPresence();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [acknowledgeChannelNotifications, acknowledgeInstalledTail, acknowledgeVisibleRows, markVisibleTailRead, publishTailPresence, resolveArrivals]);

  // 提交后的兜底发布。观测/可见性事件已经各自发布过一次；这一条负责那些不经过
  // 事件的变化——surfaceVisible 入参翻转、insertion effect 因 owner 更替作废了
  // 旧证据。它也重投一次被 current/read-authority 门明确拒绝的同一份回执；证据
  // 仍由 ReadingSession 单持有，并重新通过所有围栏。observeTailPresence 只在读数
  // 真的变了时才 emit，所以这里是幂等的。
  useEffect(() => {
    const evidence = visibleTailEvidenceRef.current;
    if (evidence.readPending === true) {
      if (evidence.owner === committedOwnerRef.current
        && evidence.controller === controller
        && evidence.activationID === controller.getSnapshot().session.activationID) {
        markVisibleTailRead();
      } else if (visibleTailEvidenceRef.current === evidence) {
        visibleTailEvidenceRef.current = { ...evidence, readPending: false };
      }
    }
    if (notificationConfirmationRef.current.pending) {
      if (evidence.owner === committedOwnerRef.current
        && evidence.controller === controller
        && evidence.activationID === controller.getSnapshot().session.activationID) {
        acknowledgeChannelNotifications();
      }
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
    const activeRequest = runwayRequestRef.current;
    const requestOperationID = activeRequest?.controller === controller
      ? String(activeRequest.operationID || '')
      : '';
    const operationID = currentAdmissionOperationID(
      historyStatus,
      channelID,
      controller.activationID,
      viewKey,
    ) || requestOperationID;
    if (input.direction !== 'older') {
      activeRequest?.abortController?.abort('trusted-reverse-input');
      if (operationID) historyStatus.presentationAdmission?.cancel?.(channelID, operationID);
      runwayRequestRef.current = null;
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
  }, [channelID, controller, historyStatus, viewKey]);

  const updateNavigation = useCallback((input = {}) => {
    const current = controller.getSnapshot().session;
    if (Number(input.inputGeneration) !== Number(current.inputEpoch)) return false;
    if (input.direction !== 'older') {
      const activeRequest = runwayRequestRef.current;
      activeRequest?.abortController?.abort('trusted-reverse-input');
      const requestOperationID = activeRequest?.controller === controller
        ? String(activeRequest.operationID || '')
        : '';
      const operationID = currentAdmissionOperationID(
        historyStatus, channelID, controller.activationID, viewKey,
      ) || requestOperationID;
      if (operationID) historyStatus.presentationAdmission?.cancel?.(channelID, operationID);
      runwayRequestRef.current = null;
    }
    controller.update((active) => updateReadingControl(active, {
      inputEpoch: input.inputGeneration,
      direction: input.direction,
      gestureID: input.gestureID,
      geometryRevision: input.geometryRevision,
    }));
    return true;
  }, [channelID, controller, historyStatus, viewKey]);

  const finishNavigation = useCallback((input = {}) => (
    Number(input.inputGeneration) === Number(controller.getSnapshot().session.inputEpoch)
  ), [controller]);

  const cancelNavigation = useCallback((input = {}) => {
    const before = controller.getSnapshot().session;
    if (Number(input.inputGeneration) !== Number(before.inputEpoch)) return false;
    const activeRequest = runwayRequestRef.current;
    const requestOperationID = activeRequest?.controller === controller
      ? String(activeRequest.operationID || '')
      : '';
    const operationID = currentAdmissionOperationID(
      historyStatus, channelID, controller.activationID, viewKey,
    ) || requestOperationID;
    activeRequest?.abortController?.abort(`trusted-navigation-cancel:${input.reason || 'cancelled'}`);
    if (operationID) historyStatus.presentationAdmission?.cancel?.(channelID, operationID);
    runwayRequestRef.current = null;
    const after = controller.update((active) => cancelReadingControl(active, {
      inputEpoch: input.inputGeneration,
      gestureID: input.gestureID,
    }));
    return after !== before;
  }, [channelID, controller, historyStatus, viewKey]);

  const retryCurrentHistory = useCallback(() => {
    const current = controller.getSnapshot().session;
    const bookmark = current.bookmark;
    if (current.mode !== READING_MODE.following
      && bookmark
      && !snapshotRef.current.rows.some((row) => row.id === bookmark.messageID)) {
      return requestHistory('retry-restore', HISTORY_URGENCY.interactive, {
        intent: HISTORY_INTENT.initialView,
        targetSeq: Number(bookmark.seq || 0),
        requiredVisibleCoverage: {
          messageID: bookmark.messageID,
          seq: Number(bookmark.seq || 0),
        },
      });
    }
    return requestHistory('retry', HISTORY_URGENCY.interactive);
  }, [controller, requestHistory]);

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
    acknowledgeHistoryReveal(commitID) {
      return historyStatus.presentationAdmission?.acknowledge?.(channelID, commitID) === true;
    },
    requestHistory,
    retryHistoryDemand() {
      return retryCurrentHistory();
    },
    retryAvailability() {
      const retries = [];
      if (localReplicaError && typeof history.retryLocalReplica === 'function') {
        retries.push(Promise.resolve(history.retryLocalReplica()));
      }
      if (syncHistoryError && typeof history.refreshLatest === 'function') {
        retries.push(Promise.resolve(history.refreshLatest()));
      }
      if (foregroundHistoryError || (historyStatus.error && !semanticRangeEstablished)) {
        retries.push(Promise.resolve(retryCurrentHistory()));
      }
      return retries.length > 1 ? Promise.all(retries) : retries[0] || Promise.resolve(false);
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
      return requestHistory('underfill', HISTORY_URGENCY.anticipatory, detail);
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
      const observationRevision = notificationObservationRevisionRef.current + 1;
      notificationObservationRevisionRef.current = observationRevision;
      visibleTailEvidenceRef.current = {
        owner: commitOwnerCandidate,
        controller,
        activationID,
        atTail: Boolean(observation.atTail),
        surfaceVisible: observation.surfaceVisible === true,
        installedHighSeq: Number(observation.installedHighSeq || 0),
        presentationRevision: Number(snapshotRef.current.revision || 0),
        sourceRevision: Number(snapshotRef.current.sourceRevision || 0),
        generation: Number(historyStatusRef.current.generation || 0),
        headSeq: Number(historyStatusRef.current.headSeq || 0),
        notificationAuthorityRevision: Number(historyStatusRef.current.notificationAuthorityRevision || 0),
        observationRevision,
        visibleRows: Object.freeze([...(observation.visibleRows || [])]),
        readPending: false,
      };
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
      visibleTailEvidenceRef.current = {
        owner: commitOwnerCandidate,
        controller,
        activationID: controller.getSnapshot().session.activationID,
        atTail: false,
        surfaceVisible: false,
        installedHighSeq: 0,
        presentationRevision: 0,
        sourceRevision: 0,
        generation: 0,
        headSeq: 0,
        notificationAuthorityRevision: Number(historyStatusRef.current.notificationAuthorityRevision || 0),
        observationRevision: notificationObservationRevisionRef.current,
        visibleRows: Object.freeze([]),
        readPending: false,
      };
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
  }), [acknowledgeInstalledTail, acknowledgeVisibleRows, availability, availabilityError, beginNavigation, bindBottomIntentTargets, bottomReady, cachePhase, cancelNavigation, captureBottomIntent, channelID, commitOwnerCandidate, controller, emptyReason, finishNavigation, foregroundHistoryError, freshnessError, freshnessPhase, history, historyBoundary, historyDemand, historyStatus, localReplicaError, markVisibleTailRead, presentationAuthority, presentationInitializing, presentationPending, publishTailPresence, requestBottom, requestHistory, resolveArrivals, restorePending, retryCurrentHistory, revokeBottomIntent, semanticRangeEstablished, session, surfaceVisible, syncHistoryError, syncStatus.interestRevision, tailCaughtUp, unseen, updateNavigation]);
}
