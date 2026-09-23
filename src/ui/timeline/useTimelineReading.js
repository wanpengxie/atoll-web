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
// are prepended. This owner never writes scrollTop.
//
// Leaving a view remembers how it was being read, in page memory only: a
// following view reopens at its newest row whatever it held before; a browsing
// view reopens on the row that was at the top, at the same offset. A reload or
// restart has no memory, so every view opens following.
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
// A reopened browsing position has landed well within this.
const RESTORE_SETTLE_MS = 1_000;

let activationSequence = 0;

// view key → { mode: 'following' } | { mode: 'browsing', id, offset }
const readingPositions = new Map();
const OPEN_AT_LATEST = Object.freeze({ index: 'LAST', align: 'end' });

// The row at the top edge of the list and how far its top sits above that
// edge. Rows render in list order, so the first one reaching below the edge is
// the one the reader is looking at from the top.
function topAnchor(node) {
  if (!node?.isConnected) return null;
  const edge = node.getBoundingClientRect().top;
  for (const element of node.querySelectorAll('[data-presentation-row-id]')) {
    const rect = element.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > edge + 1) {
      return Object.freeze({ id: element.dataset.presentationRowId, offset: Math.round(edge - rect.top) });
    }
  }
  return null;
}

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
  const positionKey = `${channelID}\u0000${viewKey || ''}`;
  // How this view opens, decided once per activation from the rows it opens
  // with. Following opens at the newest row through the vendor's initial
  // location. Browsing does not use it: the vendor keeps re-seeking an initial
  // index until it considers it reached, and rows arriving above meanwhile
  // turn that index into another row. The browsing row is sought by id
  // instead (see seekingRef), so position has one owner.
  const opening = useMemo(() => {
    const saved = readingPositions.get(positionKey);
    if (saved?.mode === READING_MODE.browsing
      && rows.some((row) => String(row?.id || '') === saved.id)) {
      return Object.freeze({
        mode: READING_MODE.browsing,
        anchor: Object.freeze({ id: saved.id, offset: saved.offset }),
        location: undefined,
      });
    }
    return Object.freeze({ mode: READING_MODE.following, anchor: null, location: OPEN_AT_LATEST });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationID]);

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
  const followedTailRef = useRef('');
  const movedUpRef = useRef(false);
  const anchorRef = useRef(null);
  const restoringRef = useRef(false);
  // The row a reopened browsing view is being brought to: { id, offset,
  // index }. Rows can still arrive above it while the list opens (the page's
  // own history catching up), which moves it by index, so it is re-sought on
  // every change until the reader acts or the restore window ends.
  const seekingRef = useRef(null);
  const reseekRef = useRef(() => {});
  // Bring the sought row back to the top unless it is already on screen. Only
  // asked when the vendor has admitted every row it was handed, so the index
  // it seeks is the index it holds.
  reseekRef.current = () => {
    const seeking = seekingRef.current;
    const port = portRef.current;
    if (!seeking || !port) return;
    const index = rowsRef.current.findIndex((row) => String(row?.id || '') === seeking.id);
    if (index < 0) return;
    const range = rangeRef.current;
    const at = index + firstRef.current;
    if (seeking.index === index && range.known && at >= range.start && at <= range.end) return;
    seeking.index = index;
    port.seek?.({ index, align: 'start', offset: seeking.offset });
  };
  const anchorFrameRef = useRef(0);
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
    // Rows prepended while a reopened position is still being sought would
    // move the row it seeks by index; the chain resumes once it has landed.
    if (seekingRef.current) return;
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
    const onInput = () => {
      inputAtRef.current = Date.now();
      // The reader took over: whatever is on screen now is theirs.
      if (seekingRef.current) {
        seekingRef.current = null;
        evaluateRef.current();
      }
    };
    return Object.freeze({
      attach(port) {
        portRef.current = port;
        // A reopened browsing view is brought to its row once the list exists.
        reseekRef.current();
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
          // Browsing remembers the row at the top, once per frame.
          if (modeRef.current === READING_MODE.browsing && !anchorFrameRef.current) {
            anchorFrameRef.current = globalThis.requestAnimationFrame(() => {
              anchorFrameRef.current = 0;
              if (modeRef.current === READING_MODE.browsing) anchorRef.current = topAnchor(node) || anchorRef.current;
            });
          }
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
      // The patched vendor asks this whenever its formal range count grows.
      // That also happens with no new output at all: a row re-measured after
      // a revision change, or the rows above admitted by the reader's own
      // upward notch. Following means following new rows at the tail, so
      // answer "follow" only when the tail of the data actually changed.
      followOutput() {
        if (modeRef.current !== READING_MODE.following) return false;
        const rows = rowsRef.current;
        const tail = rows.length ? String(rows[rows.length - 1]?.id || '') : '';
        // Older history prepended above changes the count, not the tail.
        if (tail === followedTailRef.current) return false;
        followedTailRef.current = tail;
        return 'auto';
      },
      atBottomStateChange(value) {
        const next = value === true;
        atBottomRef.current = next;
        setAtBottomState(next);
        // A list reopened on a browsing position first reports the bottom
        // state of its unpositioned first frame; only a report after it has
        // gone to that position says where the reader is.
        if (restoringRef.current) {
          if (next) return;
          restoringRef.current = false;
        }
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
        if (formalRef.current.ready) reseekRef.current();
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
        reseekRef.current();
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

  // A channel or view replacement is a new reading: open as the view was
  // left (see `opening`), drop every scheduler fact of the previous one. On
  // leaving, remember how it was being read.
  useLayoutEffect(() => {
    const scheduler = schedulerRef.current;
    const browsing = opening.mode === READING_MODE.browsing;
    modeRef.current = opening.mode;
    setModeState(opening.mode);
    atBottomRef.current = !browsing;
    setAtBottomState(!browsing);
    movedUpRef.current = browsing;
    restoringRef.current = browsing;
    // If the reopened position is itself at the bottom, no "left the bottom"
    // report ever ends the restore: settle it from the last report.
    const restoreTimer = browsing ? globalThis.setTimeout(() => {
      if (seekingRef.current) {
        seekingRef.current = null;
        evaluateRef.current();
      }
      if (!restoringRef.current) return;
      restoringRef.current = false;
      if (atBottomRef.current) {
        movedUpRef.current = false;
        setMode(READING_MODE.following);
      }
    }, RESTORE_SETTLE_MS) : null;
    anchorRef.current = opening.anchor;
    seekingRef.current = browsing && anchorRef.current?.id
      ? { id: String(anchorRef.current.id), offset: Number(anchorRef.current.offset || 0), index: -1 }
      : null;
    farRef.current = false;
    setFarFromBottomState(false);
    rangeRef.current = { known: false, start: 0, end: 0 };
    const opened = rowsRef.current;
    followedTailRef.current = opened.length ? String(opened[opened.length - 1]?.id || '') : '';
    scheduler.token = null;
    scheduler.attempts = 0;
    scheduler.definitive = false;
    if (scheduler.retryTimer) globalThis.clearTimeout(scheduler.retryTimer);
    scheduler.retryTimer = null;
    demandRef.current = IDLE_DEMAND;
    setDemandState(IDLE_DEMAND);
    return () => {
      if (scheduler.retryTimer) globalThis.clearTimeout(scheduler.retryTimer);
      scheduler.retryTimer = null;
      scheduler.token = null;
      if (restoreTimer) globalThis.clearTimeout(restoreTimer);
      restoringRef.current = false;
      seekingRef.current = null;
      if (anchorFrameRef.current) globalThis.cancelAnimationFrame(anchorFrameRef.current);
      anchorFrameRef.current = 0;
      const anchor = anchorRef.current;
      readingPositions.set(positionKey, modeRef.current === READING_MODE.browsing && anchor?.id
        ? Object.freeze({ mode: READING_MODE.browsing, id: String(anchor.id), offset: Number(anchor.offset || 0) })
        : Object.freeze({ mode: READING_MODE.following }));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationID]);

  // Following means the newest row stays in view. The vendor follows rows
  // appended at the end on its own; rows inserted in the middle (a gap filled
  // after a reconnect) or a replaced window keep its pixel offset instead, so
  // those send it to the newest row. Older history prepended above is never
  // a reason to move.
  const changeKind = snapshot.changes?.kind || '';
  const snapshotRevision = snapshot.revision;
  useLayoutEffect(() => {
    if (seekingRef.current) return;
    if (modeRef.current !== READING_MODE.following) return;
    if (changeKind !== 'mixed' && changeKind !== 'rebase') return;
    // The reader is moving the list right now; that input, not this change,
    // decides whether they are still following.
    if (Date.now() - inputAtRef.current < INPUT_WINDOW_MS) return;
    portRef.current?.toLatest('auto');
  }, [changeKind, snapshotRevision]);

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
    const list = node.getBoundingClientRect();
    // The waiting dock floats over the bottom of the list: what is under it
    // is not on screen for the reader.
    const dock = node.closest('.conversation-surface')?.querySelector('.agent-wait-layer')?.getBoundingClientRect();
    const bottom = dock && dock.height > 0 && dock.top < list.bottom && dock.bottom > list.top ? Math.max(list.top, dock.top) : list.bottom;
    const view = { top: list.top, bottom };
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
    opening: opening.location,
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
    holdPointed, jumpToLatest, list, mode, opening, retryHistoryDemand, toLatest, unseen,
  ]);
}
