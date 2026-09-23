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
// Scrolling settles this long after the last scroll event; the rows on
// screen then are what the reader has seen.
const SEEN_SETTLE_MS = 200;

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

// A reader-pointed element is held in place only until the reader acts again.
const READER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
const HOLD_WINDOW_MS = 600;

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
  const seenTimerRef = useRef(null);
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
    const rowsBefore = rowsRef.current.length;
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
      // Ask from the feed's own older frontier, not from the oldest row this
      // view shows: a filtered view may show none of the rows already
      // loaded, and asking from its bottom would fetch the same page again.
      const frontier = Number(statusRef.current?.beforeSeq || 0);
      request = Promise.resolve(historyRef.current?.request?.({
        intent: HISTORY_INTENT.scrollHistory,
        urgency: HISTORY_URGENCY.interactive,
        signal: abort.signal,
        ...(frontier > 0 ? { beforeSeq: frontier } : {}),
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
      // A page that added rows to this view is re-evaluated once the vendor
      // has admitted them. A page with no visible row (a filtered view)
      // changes no row, so no list callback will follow — and the status
      // change it caused may have been evaluated while this request still
      // held the token. Re-evaluate here, after the render, so a filtered
      // view keeps scanning until it shows something or reaches the start.
      globalThis.setTimeout(() => {
        if (scheduler.token === null && rowsRef.current.length === rowsBefore) evaluateRef.current();
      }, 0);
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
          if (seenTimerRef.current) globalThis.clearTimeout(seenTimerRef.current);
          seenTimerRef.current = globalThis.setTimeout(() => {
            seenTimerRef.current = null;
            reportOnScreenRef.current(node);
          }, SEEN_SETTLE_MS);
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
          if (seenTimerRef.current) globalThis.clearTimeout(seenTimerRef.current);
          seenTimerRef.current = null;
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
  // The reader acted on something inside a row (collapsed it), and that
  // action changes the height above what they pointed at. Stop following —
  // the reader is on this row — and keep the pointed element where it was
  // while the change lands: the DOM change itself (MutationObserver, before
  // the next frame) and the layout passes that follow it (ResizeObserver)
  // each let the vendor scroll by however far the element moved. It ends on
  // the reader's own next input or after a short window. No lease: the next
  // change after that is the vendor's as usual.
  const holdPointed = useCallback((node, container = node?.parentElement) => {
    if (!node?.isConnected || !container) return;
    const before = node.getBoundingClientRect().top;
    movedUpRef.current = true;
    setMode(READING_MODE.browsing);
    let stopped = false;
    const correct = () => {
      if (stopped || !node.isConnected) return;
      const delta = node.getBoundingClientRect().top - before;
      if (Math.abs(delta) > 1) portRef.current?.scrollBy?.(delta);
    };
    const mutation = typeof MutationObserver === 'function' ? new MutationObserver(correct) : null;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(correct) : null;
    mutation?.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
    resize?.observe(container);
    // The vendor answers the row's new size by re-laying the list (its own
    // offsets, its own scroll corrections); those move the element too.
    const itemList = container.closest('[data-testid="virtuoso-item-list"]');
    if (itemList) mutation?.observe(itemList, { attributes: true, attributeFilter: ['style'] });
    const scroller = container.closest('.timeline-message-list');
    scroller?.addEventListener('scroll', correct, { passive: true });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      mutation?.disconnect();
      resize?.disconnect();
      scroller?.removeEventListener('scroll', correct);
      for (const type of READER_INPUT) scroller?.removeEventListener(type, stop, true);
    };
    for (const type of READER_INPUT) scroller?.addEventListener(type, stop, { capture: true, passive: true });
    globalThis.setTimeout(stop, HOLD_WINDOW_MS);
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

  // ---- read position and unread -------------------------------------------

  // The feed keeps, per channel, how far the reader has read (see
  // channel-feed-runtime markSeen / unreadRoots). This owner only reports what
  // was on screen; the unfiltered "all" view also clears rows not related to
  // the reader, any other view only related ones.
  const allView = String(historyViewSpec?.scope || '') === 'all'
    && Number(historyViewSpec?.actorFilter?.size || 0) === 0;
  const seenOptionsRef = useRef({ all: allView });
  seenOptionsRef.current = { all: allView };
  const reportSeen = useCallback((seq) => {
    if (!(seq > 0) || !surfaceVisibleRef.current || !pageVisible()) return;
    historyRef.current?.markSeen?.(seq, seenOptionsRef.current);
  }, []);
  const reportOnScreenRef = useRef(() => {});
  reportOnScreenRef.current = (node) => {
    if (!node?.isConnected) return;
    const view = node.getBoundingClientRect();
    const seqByID = new Map(rowsRef.current.map((row) => [String(row?.id || ''), row]));
    let high = 0;
    for (const element of node.querySelectorAll('[data-presentation-row-id]')) {
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0 || rect.bottom <= view.top || rect.top >= view.bottom) continue;
      const row = seqByID.get(element.dataset.presentationRowId);
      if (row && row.local !== true && !row.localState) high = Math.max(high, Number(row.seqHigh || 0));
    }
    reportSeen(Math.min(high, Number(statusRef.current?.headSeq || 0)));
  };

  const generation = Number(historyStatus.generation || 0);
  const headSeq = Number(historyStatus.headSeq || 0);
  const highSeq = installedHighSeq(rows, headSeq);
  // Following on a visible page: live arrivals are read as they land, in the
  // feed's own publish, so a new row is never counted unread for a frame.
  const canFollowLive = typeof history?.followLive === 'function';
  useLayoutEffect(() => {
    if (mode !== READING_MODE.following || !surfaceVisible || !documentVisible || !canFollowLive) return undefined;
    return historyRef.current?.followLive?.({ all: allView }) || undefined;
  }, [activationID, allView, canFollowLive, documentVisible, mode, surfaceVisible]);
  // At the bottom of a visible page the reader has seen the newest row.
  useLayoutEffect(() => {
    if (mode !== READING_MODE.following || !atBottom || !surfaceVisible || !documentVisible) return;
    reportSeen(highSeq);
  }, [allView, atBottom, documentVisible, highSeq, mode, reportSeen, surfaceVisible]);

  // "N 条新动态": unread rows of this view, shown while not at the bottom.
  // Unread is defined by the feed's read position, so history loaded above
  // the reader, the reader's own messages and rows already read never count.
  const unreadRoots = history?.unreadRoots;
  const unseen = useMemo(() => {
    if (mode !== READING_MODE.browsing || !unreadRoots) return 0;
    let count = 0;
    for (const row of rows) {
      const id = String(row?.id || '');
      if (unreadRoots.related?.has(id) || unreadRoots.other?.has(id)) count += 1;
    }
    return count;
  }, [mode, rows, unreadRoots]);

  // ---- surface-facing summary ----------------------------------------------

  const attached = historyStatus.attached === true && historyStatus.messageCurrent === true;
  const availability = attached
    ? (rows.length > 0 || historyStatus.hasOlder === true ? 'readable' : 'empty-known')
    : historyStatus.error && rows.length === 0 ? 'error' : 'pending';
  const historyBoundary = attached && historyStatus.hasOlder === false && demand.phase === 'idle'
    ? Object.freeze({ kind: 'exhausted', generation, actorFiltered: Number(historyViewSpec?.actorFilter?.size || 0) > 0 })
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
    holdPointed,
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
    holdPointed, jumpToLatest, list, mode, retryHistoryDemand, toLatest, unseen,
  ]);
}
