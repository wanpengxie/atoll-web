import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { diagnostic } from '../../model/diagnostics.js';
import { HISTORY_INTENT, HISTORY_URGENCY } from '../../model/history-demand.js';

// One reading model for the conversation list.
//
// State:
//   mode      following | browsing   — following sticks to the newest row
//   unseen    rows that arrived below while browsing
//   history   idle | pending | error — the older-history scheduler
//
// Everything positional belongs to the vendored Virtuoso: following output,
// keeping place while a row grows, holding the reader still while older rows
// are prepended. This owner never writes scrollTop and keeps no bookmark.
//
// Older history is level-triggered: whenever fewer than PREFETCH_ROWS loaded
// rows sit above the viewport, older rows exist, nothing is in flight and the
// vendor has finished admitting the previous page, one page is requested.
// Every exit from "in flight" (success, failure, timeout) re-evaluates, so the
// chain cannot stop on a state it cannot leave.

export const READING_MODE = Object.freeze({ following: 'following', browsing: 'browsing' });

const PREFETCH_ROWS = 40;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
// A vendor range that stays pending this long is treated as settled so a row
// that never obtains a size cannot hold the history chain forever.
const FORMAL_PENDING_LIMIT_MS = 5_000;
// Upward movement is the reader's only when an input preceded it; a scroll
// correction by the vendor is not a reason to leave following.
const INPUT_WINDOW_MS = 1_000;
// Far enough from the newest row that scrolling back by hand is a chore: the
// "back to bottom" affordance appears beyond this many screens.
const FAR_FROM_BOTTOM_SCREENS = 4;
const DEFINITIVE_HISTORY_ERRORS = new Set([
  'forbidden', 'not_member', 'channel_not_found', 'channel_retired', 'access_denied',
]);
const IDLE_DEMAND = Object.freeze({ phase: 'idle', error: '' });
const NOTIFICATION_LEASE_REVOKE = 'notification-lease-revoke';

let activationSequence = 0;

function pageVisible() {
  return globalThis.document?.visibilityState !== 'hidden';
}

function installedHighSeq(rows, headSeq) {
  let high = 0;
  for (const row of rows) {
    if (row?.local === true || row?.localState) continue;
    const seq = Number(row?.seqHigh || 0);
    if (seq > high && seq <= headSeq) high = seq;
  }
  return high;
}

function historyErrorMessage(error) {
  return String(error?.detail || error?.message || error || '读取更早动态失败');
}

export function useTimelineReading({
  channelID,
  viewKey,
  snapshot,
  historyStatus = {},
  history,
  historyViewSpec,
  surfaceVisible = false,
  onTailCaughtUp,
}) {
  const rows = snapshot.rows;
  const firstItemIndex = Number(snapshot.firstItemIndex || 1);
  const activationID = useMemo(() => {
    activationSequence += 1;
    return `reading:${channelID}:${viewKey}:${activationSequence}`;
  }, [channelID, viewKey]);

  // Latest facts, read by the list callbacks without re-rendering.
  const rowsRef = useRef(rows);
  const firstRef = useRef(firstItemIndex);
  const statusRef = useRef(historyStatus);
  const historyRef = useRef(history);
  const surfaceVisibleRef = useRef(surfaceVisible);
  rowsRef.current = rows;
  firstRef.current = firstItemIndex;
  statusRef.current = historyStatus;
  historyRef.current = history;
  surfaceVisibleRef.current = surfaceVisible;

  const [mode, setModeState] = useState(READING_MODE.following);
  const [atBottom, setAtBottomState] = useState(true);
  const [demand, setDemandState] = useState(IDLE_DEMAND);
  const [documentVisible, setDocumentVisible] = useState(pageVisible);
  const [farFromBottom, setFarFromBottomState] = useState(false);
  const farRef = useRef(false);
  const modeRef = useRef(READING_MODE.following);
  const atBottomRef = useRef(true);
  const portRef = useRef(null);
  const rangeRef = useRef({ known: false, start: 0, end: 0 });
  const seenTailRef = useRef('');
  const inputAtRef = useRef(0);
  const movedUpRef = useRef(false);
  const lastTopRef = useRef(0);
  const scrollerCleanupRef = useRef(null);
  const formalRef = useRef({ ready: true, since: 0, timer: null });
  const schedulerRef = useRef({ token: null, retryTimer: null, attempts: 0, definitive: false });
  const demandRef = useRef(IDLE_DEMAND);

  const setMode = useCallback((next) => {
    if (modeRef.current === next) return;
    modeRef.current = next;
    setModeState(next);
  }, []);
  const setDemand = useCallback((next) => {
    const current = demandRef.current;
    if (current.phase === next.phase && current.error === next.error) return;
    demandRef.current = next;
    setDemandState(next);
  }, []);

  // ---- older-history scheduler -------------------------------------------

  const evaluateRef = useRef(() => {});
  const clearRetry = useCallback(() => {
    const scheduler = schedulerRef.current;
    if (scheduler.retryTimer) globalThis.clearTimeout(scheduler.retryTimer);
    scheduler.retryTimer = null;
  }, []);
  const scheduleRetry = useCallback((error) => {
    const scheduler = schedulerRef.current;
    scheduler.attempts += 1;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** (scheduler.attempts - 1)));
    clearRetry();
    scheduler.retryTimer = globalThis.setTimeout(() => {
      scheduler.retryTimer = null;
      evaluateRef.current();
    }, delay);
    if (error) setDemand(Object.freeze({ phase: 'error', error: `${historyErrorMessage(error)}，正在重试` }));
    else setDemand(IDLE_DEMAND);
  }, [clearRetry, setDemand]);

  const requestOlder = useCallback(() => {
    const scheduler = schedulerRef.current;
    const token = {};
    scheduler.token = token;
    if (demandRef.current.phase !== 'error') setDemand(Object.freeze({ phase: 'pending', error: '' }));
    // A request that never answers is abandoned, not waited on: aborting
    // releases this waiter, so the retry issues a fresh page instead of
    // joining the one that hung.
    const abort = new AbortController();
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = globalThis.setTimeout(() => {
        abort.abort();
        resolve({
          kind: 'failed',
          error: Object.assign(new Error('读取更早动态超时'), { code: 'timeout' }),
        });
      }, REQUEST_TIMEOUT_MS);
    });
    let request;
    try {
      request = Promise.resolve(historyRef.current?.request?.({
        intent: HISTORY_INTENT.scrollHistory,
        urgency: HISTORY_URGENCY.interactive,
        signal: abort.signal,
      }));
    } catch (error) {
      request = Promise.resolve({ kind: 'failed', error });
    }
    Promise.race([request, timeout]).then(
      (outcome) => outcome || { kind: 'cancelled' },
      (error) => ({ kind: 'failed', error }),
    ).then((outcome) => {
      globalThis.clearTimeout(timer);
      if (scheduler.token !== token) return;
      scheduler.token = null;
      if (outcome.kind === 'failed') {
        const code = String(outcome.error?.code || '');
        diagnostic('warn', 'history.older_failed', { channelId: channelID, code, attempts: scheduler.attempts + 1 });
        if (DEFINITIVE_HISTORY_ERRORS.has(code)) {
          scheduler.definitive = true;
          setDemand(Object.freeze({ phase: 'error', error: historyErrorMessage(outcome.error) }));
          return;
        }
        scheduleRetry(outcome.error);
        return;
      }
      if (outcome.kind === 'cancelled') {
        // Superseded by an attach or a replaced source. Not an error, but
        // it must not become a tight loop either.
        scheduleRetry(null);
        return;
      }
      scheduler.attempts = 0;
      setDemand(IDLE_DEMAND);
      // A page with no visible row (a filtered view) changes no row, so no
      // list callback will follow; the status change re-evaluates through the
      // layout effect below. A page that did add rows is re-evaluated once
      // the vendor has admitted them.
    });
  }, [channelID, scheduleRetry, setDemand]);

  const evaluateHistory = useCallback(() => {
    const scheduler = schedulerRef.current;
    const status = statusRef.current || {};
    if (!surfaceVisibleRef.current || !pageVisible()) return;
    if (status.attached !== true || status.messageCurrent !== true) return;
    if (status.hasOlder !== true) return;
    if (scheduler.token || scheduler.retryTimer || scheduler.definitive) return;
    const formal = formalRef.current;
    if (!formal.ready) {
      if (Date.now() - formal.since < FORMAL_PENDING_LIMIT_MS) return;
      diagnostic('warn', 'history.formal_range_stalled', { channelId: channelID });
      formal.ready = true;
    }
    const loaded = rowsRef.current.length;
    if (loaded > 0) {
      const range = rangeRef.current;
      if (!range.known) return;
      const above = Math.max(0, range.start - firstRef.current);
      if (above >= PREFETCH_ROWS) return;
    }
    requestOlder();
  }, [channelID, requestOlder]);
  evaluateRef.current = evaluateHistory;

  const retryHistoryDemand = useCallback(() => {
    const scheduler = schedulerRef.current;
    scheduler.definitive = false;
    clearRetry();
    setDemand(IDLE_DEMAND);
    evaluateRef.current();
  }, [clearRetry, setDemand]);

  // ---- list port -----------------------------------------------------------

  const list = useMemo(() => {
    const onInput = () => { inputAtRef.current = Date.now(); };
    return Object.freeze({
      attach(port) {
        portRef.current = port;
        return () => { if (portRef.current === port) portRef.current = null; };
      },
      bindScroller(node) {
        scrollerCleanupRef.current?.();
        scrollerCleanupRef.current = null;
        if (!node) return;
        lastTopRef.current = node.scrollTop;
        const onScroll = () => {
          const top = node.scrollTop;
          if (top < lastTopRef.current - 1 && Date.now() - inputAtRef.current < INPUT_WINDOW_MS) {
            movedUpRef.current = true;
          }
          lastTopRef.current = top;
          const far = node.scrollHeight - node.clientHeight - top > FAR_FROM_BOTTOM_SCREENS * node.clientHeight;
          if (far !== farRef.current) {
            farRef.current = far;
            setFarFromBottomState(far);
          }
        };
        node.addEventListener('scroll', onScroll, { passive: true });
        node.addEventListener('wheel', onInput, { passive: true });
        node.addEventListener('touchmove', onInput, { passive: true });
        node.addEventListener('keydown', onInput);
        node.addEventListener('pointerdown', onInput);
        scrollerCleanupRef.current = () => {
          node.removeEventListener('scroll', onScroll);
          node.removeEventListener('wheel', onInput);
          node.removeEventListener('touchmove', onInput);
          node.removeEventListener('keydown', onInput);
          node.removeEventListener('pointerdown', onInput);
        };
      },
      followOutput() {
        return modeRef.current === READING_MODE.following ? 'auto' : false;
      },
      atBottomStateChange(value) {
        const next = value === true;
        atBottomRef.current = next;
        setAtBottomState(next);
        if (next) {
          movedUpRef.current = false;
          setMode(READING_MODE.following);
        } else if (movedUpRef.current) {
          setMode(READING_MODE.browsing);
        }
      },
      totalListHeightChanged() {
        if (modeRef.current === READING_MODE.following) portRef.current?.followGrowth();
      },
      rangeChanged(range) {
        rangeRef.current = {
          known: true,
          start: Number(range?.startIndex || 0),
          end: Number(range?.endIndex || 0),
        };
        evaluateRef.current();
      },
      formalRangeStateChange(state) {
        const formal = formalRef.current;
        const ready = state?.phase !== 'pending';
        if (formal.timer) globalThis.clearTimeout(formal.timer);
        formal.timer = null;
        if (!ready) {
          if (formal.ready) formal.since = Date.now();
          formal.ready = false;
          formal.timer = globalThis.setTimeout(() => {
            formal.timer = null;
            evaluateRef.current();
          }, FORMAL_PENDING_LIMIT_MS + 50);
          return;
        }
        formal.ready = true;
        evaluateRef.current();
      },
    });
  }, [setMode]);

  const toLatest = useCallback(() => {
    movedUpRef.current = false;
    setMode(READING_MODE.following);
    portRef.current?.toLatest('auto');
  }, [setMode]);
  const jumpToLatest = useCallback(() => {
    toLatest();
    void historyRef.current?.refreshLatest?.();
  }, [toLatest]);

  // ---- activation ------------------------------------------------------------

  // A channel or view replacement is a new reading: open at the newest row,
  // drop every scheduler fact of the previous one.
  useLayoutEffect(() => {
    const scheduler = schedulerRef.current;
    modeRef.current = READING_MODE.following;
    setModeState(READING_MODE.following);
    atBottomRef.current = true;
    setAtBottomState(true);
    movedUpRef.current = false;
    farRef.current = false;
    setFarFromBottomState(false);
    seenTailRef.current = '';
    rangeRef.current = { known: false, start: 0, end: 0 };
    scheduler.token = null;
    scheduler.attempts = 0;
    scheduler.definitive = false;
    if (scheduler.retryTimer) globalThis.clearTimeout(scheduler.retryTimer);
    scheduler.retryTimer = null;
    demandRef.current = IDLE_DEMAND;
    setDemandState(IDLE_DEMAND);
    portRef.current?.toLatest('auto');
    return () => {
      if (scheduler.retryTimer) globalThis.clearTimeout(scheduler.retryTimer);
      scheduler.retryTimer = null;
      scheduler.token = null;
    };
  }, [activationID]);

  useEffect(() => () => {
    scrollerCleanupRef.current?.();
    const formal = formalRef.current;
    if (formal.timer) globalThis.clearTimeout(formal.timer);
  }, []);

  useEffect(() => {
    const change = () => {
      const visible = pageVisible();
      setDocumentVisible(visible);
      if (visible) {
        clearRetry();
        evaluateRef.current();
      }
    };
    globalThis.document?.addEventListener?.('visibilitychange', change);
    return () => globalThis.document?.removeEventListener?.('visibilitychange', change);
  }, [clearRetry]);

  // Re-evaluate whenever the source can have moved: a page landed (cursor,
  // pages, EOF), the attach changed, the surface became visible. A reconnect
  // cancels the backoff: the link the failure depended on is new.
  const attachKey = `${historyStatus.generation || 0}:${historyStatus.attached === true}:${historyStatus.messageCurrent === true}`;
  const previousAttachKeyRef = useRef(attachKey);
  useLayoutEffect(() => {
    if (previousAttachKeyRef.current !== attachKey) {
      previousAttachKeyRef.current = attachKey;
      clearRetry();
    }
    evaluateRef.current();
  }, [
    attachKey, clearRetry, surfaceVisible, rows.length, firstItemIndex,
    historyStatus.hasOlder, historyStatus.beforeSeq, historyStatus.completedPages,
  ]);

  // ---- unseen --------------------------------------------------------------

  const tailID = String(rows.at(-1)?.id || '');
  if (mode === READING_MODE.following || !seenTailRef.current) seenTailRef.current = tailID;
  const unseen = useMemo(() => {
    if (mode !== READING_MODE.browsing) return 0;
    const seenIndex = rows.findIndex((row) => String(row?.id || '') === seenTailRef.current);
    return seenIndex < 0 ? 0 : rows.length - 1 - seenIndex;
  }, [mode, rows]);

  // ---- tail caught up (read + notification confirmation) -------------------

  const tailCallbackRef = useRef(onTailCaughtUp);
  tailCallbackRef.current = onTailCaughtUp;
  const receiptRef = useRef({ positive: null, epoch: 0 });
  const scope = String(historyViewSpec?.scope || '');
  const actorFilterCount = Number(historyViewSpec?.actorFilter?.size || 0);
  const generation = Number(historyStatus.generation || 0);
  const headSeq = Number(historyStatus.headSeq || 0);
  const authorityRevision = Number(historyStatus.notificationAuthorityRevision || 0);
  const presentationRevision = Number(historyStatus.presentationRevision || 0);
  const sourceRevision = Number(snapshot.sourceRevision || 0);
  const highSeq = installedHighSeq(rows, headSeq);
  const caughtUp = mode === READING_MODE.following
    && atBottom
    && surfaceVisible === true
    && documentVisible
    && historyStatus.attached === true
    && historyStatus.messageCurrent === true
    && generation > 0
    && sourceRevision >= presentationRevision
    && highSeq > 0;

  useLayoutEffect(() => {
    const callback = tailCallbackRef.current;
    if (typeof callback !== 'function') return;
    const receipts = receiptRef.current;
    const previous = receipts.positive;
    if (caughtUp) {
      if (previous
        && previous.installedHighSeq === highSeq
        && previous.generation === generation
        && previous.authorityRevision === authorityRevision
        && previous.scope === scope
        && previous.actorFilterCount === actorFilterCount) return;
      if (!previous) receipts.epoch += 1;
      const range = rangeRef.current;
      const first = firstRef.current;
      const visibleRowIDs = Object.freeze(range.known
        ? rows.slice(Math.max(0, range.start - first), Math.max(0, range.end - first) + 1)
          .map((row) => String(row?.id || '')).filter(Boolean)
        : [tailID].filter(Boolean));
      const owner = Object.freeze({ channelId: channelID, viewKey, activationID, generation });
      const receipt = Object.freeze({
        channelId: channelID,
        viewKey,
        activationID,
        authority: historyStatus.authority,
        owner,
        inputEpoch: receipts.epoch,
        captured: Object.freeze({
          presentationRevision,
          sourceRevision,
          installedHighSeq: highSeq,
          visibleRowIDs,
        }),
        caughtUp: true,
        settled: true,
        scope,
        actorFiltered: actorFilterCount > 0,
        actorFilterCount,
        generation,
        authorityRevision,
        cause: 'presented-follow',
        sourceRevision,
        presentationRevision,
        installedHighSeq: highSeq,
        tailID,
        visibleRowIDs,
        atTail: true,
        following: true,
        surfaceVisible: true,
        physicalSeq: scope === 'all' && actorFilterCount === 0 ? highSeq : 0,
        boundary: highSeq,
      });
      receipts.positive = receipt;
      callback(receipt);
      return;
    }
    if (!previous) return;
    receipts.positive = null;
    receipts.epoch += 1;
    callback(Object.freeze({
      ...previous,
      caughtUp: false,
      atTail: false,
      following: false,
      surfaceVisible: false,
      physicalSeq: 0,
      boundary: 0,
      kind: NOTIFICATION_LEASE_REVOKE,
      reason: surfaceVisible === true && documentVisible ? 'physical-leave' : 'surface-hidden',
      inputEpoch: receipts.epoch,
      cause: '',
    }));
  });

  useLayoutEffect(() => () => {
    const receipts = receiptRef.current;
    const previous = receipts.positive;
    if (!previous || typeof tailCallbackRef.current !== 'function') return;
    receipts.positive = null;
    receipts.epoch += 1;
    tailCallbackRef.current(Object.freeze({
      ...previous,
      caughtUp: false,
      atTail: false,
      following: false,
      surfaceVisible: false,
      physicalSeq: 0,
      boundary: 0,
      kind: NOTIFICATION_LEASE_REVOKE,
      reason: 'activation-cleanup',
      inputEpoch: receipts.epoch,
      cause: '',
    }));
  }, [activationID]);

  // ---- surface-facing summary ----------------------------------------------

  const attached = historyStatus.attached === true && historyStatus.messageCurrent === true;
  const availability = attached
    ? (rows.length > 0 || historyStatus.hasOlder === true ? 'readable' : 'empty-known')
    : historyStatus.error && rows.length === 0 ? 'error' : 'pending';
  const historyBoundary = attached && historyStatus.hasOlder === false && demand.phase === 'idle'
    ? Object.freeze({ kind: 'exhausted', generation, actorFiltered: actorFilterCount > 0 })
    : null;

  return useMemo(() => Object.freeze({
    activationID,
    mode,
    session: Object.freeze({ mode }),
    atBottom,
    unseen,
    unseenNotice: unseen,
    // New arrivals take the slot first; otherwise a reader far up the
    // history gets a one-tap way back to the newest row.
    showJumpToBottom: mode === READING_MODE.browsing && farFromBottom && unseen === 0,
    list,
    toLatest,
    jumpToLatest,
    availability,
    availabilityError: String(historyStatus.error || ''),
    retryAvailability: () => {
      void historyRef.current?.refreshLatest?.();
      retryHistoryDemand();
    },
    historyDemand: demand,
    retryHistoryDemand,
    historyBoundary,
  }), [
    activationID, atBottom, availability, demand, farFromBottom, historyBoundary, historyStatus.error,
    jumpToLatest, list, mode, retryHistoryDemand, toLatest, unseen,
  ]);
}
