import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reduceViewportMode, VIEWPORT_EVENT, VIEWPORT_MODE } from '../../model/conversation-viewport.js';
import { diagnostic } from '../../model/diagnostics.js';
import { HISTORY_INTENT, HISTORY_URGENCY, normalizeHistoryDemandPort } from '../../model/history-demand.js';
import { createTopIntentController, HISTORY_OPERATION } from '../../model/history-interaction.js';

export const VIRTUAL_INDEX_BASE = 1_000_000_000;

function physicalBottom(node) {
  return Math.max(0, node.scrollHeight - node.clientHeight);
}

function isAtBottom(node, threshold = 24) {
  return Boolean(node) && physicalBottom(node) - node.scrollTop <= threshold;
}

function isAtTop(node) {
  return Boolean(node) && node.scrollTop <= 1;
}

// Owns the complete conversation viewport transaction. Timeline supplies
// semantic rows and a finite history-demand port; this hook alone translates
// input intent into demand and adapter geometry into scroll commands.
export function useConversationViewport({
  channelId,
  lastSeq,
  history,
  viewKey,
  listKey,
  items,
  firstVisibleSeq,
  latestVisibleSeq,
  viewSpec,
  initialSession = {},
  onSessionChange,
}) {
  const listRef = useRef(null);
  const scrollerRef = useRef(null);
  const scrollCleanupRef = useRef(() => {});
  const initialAnchorRef = useRef(initialSession.anchor || null);
  const restoredAnchorRef = useRef(false);
  const anchorRestoreRef = useRef(null);
  const restoreRequestRef = useRef(null);
  const followLatestRef = useRef(!initialSession.anchor && initialSession.mode !== VIEWPORT_MODE.browsing);
  const persistFrameRef = useRef(0);
  const visibleRangeRef = useRef(null);
  const pointerActiveRef = useRef(false);
  const touchYRef = useRef(null);
  const transitionRef = useRef({ key: '', firstSeq: 0, lastSeq: 0, length: 0, firstItemIndex: VIRTUAL_INDEX_BASE });
  const interactionReadyRef = useRef('');
  const requestRef = useRef(null);
  const operationSerialRef = useRef(0);
  const controllerRef = useRef(null);
  const runtimeRef = useRef(null);
  const layoutChangeRef = useRef(null);
  const layoutPortRef = useRef(null);
  const [atBottom, setAtBottom] = useState(() => followLatestRef.current);
  const [unseen, setUnseen] = useState(() => Number(initialSession.unseenTail || 0));
  const [mode, setMode] = useState(() => initialSession.anchor ? VIEWPORT_MODE.restoring : (initialSession.mode || VIEWPORT_MODE.following));
  const [adapterEpoch, setAdapterEpoch] = useState(0);
  const transitionMode = (event, options) => setMode((current) => reduceViewportMode(current, event, options));

  const port = normalizeHistoryDemandPort(history);
  const status = port.status;
  runtimeRef.current = {
    channelId,
    lastSeq,
    port,
    status,
    viewKey,
    listKey,
    items,
    firstVisibleSeq,
    latestVisibleSeq,
    viewSpec,
    onSessionChange,
    mode,
    unseen,
  };

  function semanticAnchor() {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const viewportRect = scroller.getBoundingClientRect();
    const candidates = [...scroller.querySelectorAll('[data-presentation-row-id]')]
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > viewportRect.top && rect.top < viewportRect.bottom)
      .sort((left, right) => left.rect.top - right.rect.top);
    const anchor = candidates[0];
    if (!anchor) return null;
    const rowID = anchor.node.dataset.presentationRowId || '';
    const row = runtimeRef.current?.items?.find((candidate) => candidate.id === rowID);
    return rowID ? { rowID, offset: anchor.rect.top - viewportRect.top, seq: Number(row?.seqLow || 0) } : null;
  }

  function persistSession({ preserveMissingAnchor = false } = {}) {
    const current = runtimeRef.current;
    if (!current?.onSessionChange) return;
    const anchor = followLatestRef.current ? null : semanticAnchor();
    const change = {
      mode: followLatestRef.current ? VIEWPORT_MODE.following : current.mode,
      unseenTail: current.unseen,
    };
    if (followLatestRef.current || anchor || !preserveMissingAnchor) change.anchor = anchor;
    current.onSessionChange(change);
  }

  function schedulePersistSession() {
    cancelAnimationFrame(persistFrameRef.current);
    persistFrameRef.current = requestAnimationFrame(persistSession);
  }

  function clearLayoutChange(transaction = layoutChangeRef.current) {
    if (!transaction) return;
    cancelAnimationFrame(transaction.frame || 0);
    if (layoutChangeRef.current === transaction) layoutChangeRef.current = null;
  }

  function clearAnchorRestore({ userIntent = false } = {}) {
    const transaction = anchorRestoreRef.current;
    if (transaction) {
      cancelAnimationFrame(transaction.frame || 0);
      transaction.scroller?.style.removeProperty('overflow-anchor');
    }
    anchorRestoreRef.current = null;
    if (!userIntent) return;
    // A physical input means the reader accepts the currently materialized
    // position and takes ownership from every pending restore transaction.
    // Do not let the restore effect restart on the next render and pull the
    // viewport back underneath the gesture.
    restoredAnchorRef.current = true;
    initialAnchorRef.current = null;
    interactionReadyRef.current = runtimeRef.current?.listKey || '';
  }

  function yieldViewportToUser() {
    clearLayoutChange();
    clearAnchorRestore({ userIntent: true });
  }

  function beginLayoutChange({ key, anchor } = {}) {
    clearLayoutChange();
    const scroller = scrollerRef.current;
    if (!key || !anchor?.isConnected || !scroller) return;
    // Expanding or collapsing a row is an explicit reading action. Once it
    // starts, tail-following must not reinterpret the controller's corrective
    // scroll events as a reason to jump back to the physical bottom.
    followLatestRef.current = false;
    transitionMode(VIEWPORT_EVENT.userBrowse);
    const transaction = {
      key,
      anchor,
      scroller,
      anchorTop: anchor.getBoundingClientRect().top,
      startedAt: performance.now(),
      stableFrames: 0,
      frame: 0,
    };
    layoutChangeRef.current = transaction;
  }

  function commitLayoutChange({ key, anchor } = {}) {
    const transaction = layoutChangeRef.current;
    if (!transaction || transaction.key !== key || transaction.anchor !== anchor) return;
    const maximum = physicalBottom(transaction.scroller);
    if (transaction.scroller.scrollTop > maximum) transaction.scroller.scrollTop = maximum;
    const correct = () => {
      if (layoutChangeRef.current !== transaction || !transaction.anchor.isConnected) return false;
      const delta = transaction.anchor.getBoundingClientRect().top - transaction.anchorTop;
      if (Math.abs(delta) > 0.5) {
        transaction.scroller.scrollTop += delta;
        transaction.stableFrames = 0;
      } else {
        transaction.stableFrames += 1;
      }
      return true;
    };
    // React has committed the changed height before this layout effect. Keep
    // the clicked control in place before paint, then cover only the bounded
    // measurement window of this one row. No observer or timeout survives the
    // interaction, and any physical input cancels the transaction immediately.
    correct();
    const settle = () => {
      if (!correct()) return;
      if (transaction.stableFrames >= 3 || performance.now() - transaction.startedAt >= 120) {
        clearLayoutChange(transaction);
        return;
      }
      transaction.frame = requestAnimationFrame(settle);
    };
    transaction.frame = requestAnimationFrame(settle);
  }

  if (layoutPortRef.current === null) {
    layoutPortRef.current = Object.freeze({
      begin: beginLayoutChange,
      commit: commitLayoutChange,
      cancel: (key) => {
        if (!key || layoutChangeRef.current?.key === key) clearLayoutChange();
      },
    });
  }

  async function openHistoryDemand(goal) {
    const activePort = runtimeRef.current?.port;
    const result = activePort
      ? await activePort.open({
        intent: HISTORY_INTENT.scrollHistory,
        urgency: HISTORY_URGENCY.interactive,
        ...goal,
      })
      : { kind: HISTORY_OPERATION.exhausted };
    return result || { kind: HISTORY_OPERATION.exhausted };
  }

  function createController() {
    return createTopIntentController({
      load: openHistoryDemand,
      onState: ({ state: operationState, epoch, viewKey: operationView, result, reason }) => {
        const current = runtimeRef.current;
        diagnostic('debug', `history.intent_${operationState}`, {
          channelId: current?.channelId || '', epoch, viewKey: operationView, reason: reason || result?.kind || '',
        });
        if (operationState === 'started') transitionMode(VIEWPORT_EVENT.demandStarted);
        else if (operationState === HISTORY_OPERATION.satisfied) transitionMode(VIEWPORT_EVENT.demandSatisfied);
        else if ([HISTORY_OPERATION.exhausted, HISTORY_OPERATION.failed, HISTORY_OPERATION.cancelled].includes(operationState)) {
          transitionMode(VIEWPORT_EVENT.demandClosed, { followsTail: followLatestRef.current });
        }
      },
    });
  }

  if (controllerRef.current === null) controllerRef.current = createController();

  const setScroller = useCallback((node) => {
    if (scrollerRef.current === node) return;
    scrollCleanupRef.current();
    scrollerRef.current = node;
    if (!node) {
      scrollCleanupRef.current = () => {};
      return;
    }
    setAdapterEpoch((value) => value + 1);
    const distanceFromBottom = () => physicalBottom(node) - node.scrollTop;
    const handleScroll = () => {
      if (distanceFromBottom() <= 2) {
        followLatestRef.current = true;
      } else if (pointerActiveRef.current) {
        followLatestRef.current = false;
        transitionMode(VIEWPORT_EVENT.userBrowse);
      } else if (followLatestRef.current) {
        // This command belongs to the viewport owner. It corrects a virtualizer
        // measurement while following; child renderers never write scrollTop.
        node.scrollTop = physicalBottom(node);
      }
      const controller = controllerRef.current;
      if (node.scrollTop > 1 && !controller?.snapshot().active) controller?.leaveTop();
      schedulePersistSession();
    };
    const handleTopInput = () => {
      if (node.scrollTop <= 1) requestRef.current?.('top-input', { continuation: true, queueWhileActive: true });
    };
    const handleWheel = (event) => {
      yieldViewportToUser();
      if (event.deltaY < 0) {
        followLatestRef.current = false;
        transitionMode(VIEWPORT_EVENT.userBrowse);
      }
      handleTopInput();
    };
    const handlePointerDown = () => {
      yieldViewportToUser();
      pointerActiveRef.current = true;
    };
    const handlePointerUp = () => { pointerActiveRef.current = false; };
    const handleTouchStart = (event) => {
      yieldViewportToUser();
      touchYRef.current = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY != null && touchYRef.current != null && nextY > touchYRef.current + 2) {
        followLatestRef.current = false;
        transitionMode(VIEWPORT_EVENT.userBrowse);
      }
      touchYRef.current = nextY ?? null;
      handleTopInput();
    };
    const handleKeyDown = (event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        yieldViewportToUser();
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
          followLatestRef.current = false;
          transitionMode(VIEWPORT_EVENT.userBrowse);
        }
      }
    };
    node.addEventListener('scroll', handleScroll, { passive: true });
    node.addEventListener('wheel', handleWheel, { passive: true });
    node.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    node.addEventListener('touchstart', handleTouchStart, { passive: true });
    node.addEventListener('touchmove', handleTouchMove, { passive: true });
    node.addEventListener('keydown', handleKeyDown);
    scrollCleanupRef.current = () => {
      node.removeEventListener('scroll', handleScroll);
      node.removeEventListener('wheel', handleWheel);
      node.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchmove', handleTouchMove);
      node.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => () => {
    // Passive cleanup can run after React has detached the old Surface DOM.
    // Preserve the last scroll-time anchor instead of overwriting it with null.
    persistSession({ preserveMissingAnchor: true });
    scrollCleanupRef.current();
    cancelAnimationFrame(persistFrameRef.current);
    clearAnchorRestore();
    clearLayoutChange();
  }, []);

  useLayoutEffect(() => {
    let controller = controllerRef.current;
    if (!controller || controller.snapshot().disposed) {
      controller = createController();
      controllerRef.current = controller;
    }
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [channelId]);

  const previousList = transitionRef.current;
  let firstItemIndex = previousList.firstItemIndex;
  let prepended = 0;
  if (previousList.key !== listKey) firstItemIndex = VIRTUAL_INDEX_BASE;
  else if (firstVisibleSeq && previousList.firstSeq && firstVisibleSeq < previousList.firstSeq) {
    prepended = items.findIndex((entry) => Number(entry.seqLow ?? entry.seq) === previousList.firstSeq);
    if (prepended > 0) firstItemIndex = previousList.firstItemIndex - prepended;
  }
  const nextTransition = {
    key: listKey,
    firstSeq: firstVisibleSeq,
    lastSeq: latestVisibleSeq,
    length: items.length,
    firstItemIndex,
  };

  useLayoutEffect(() => {
    transitionRef.current = nextTransition;
  }, [listKey, firstVisibleSeq, latestVisibleSeq, items.length, firstItemIndex]);

  // Recreate the reader's semantic position after Timeline or a responsive
  // Surface topology remounts. The adapter materializes the row; the viewport
  // controller alone performs the pixel correction.
  useLayoutEffect(() => {
    const anchor = initialAnchorRef.current;
    if (!anchor || restoredAnchorRef.current || !scrollerRef.current || !items.length) return;
    const itemIndex = items.findIndex((row) => row.id === anchor.rowID);
    if (itemIndex < 0) return;
    restoredAnchorRef.current = 'restoring';
    followLatestRef.current = false;
    transitionMode(VIEWPORT_EVENT.demandSatisfied);
    const targetIndex = firstItemIndex + itemIndex;
    const transaction = {
      anchor,
      targetIndex,
      scroller: scrollerRef.current,
      startedAt: performance.now(),
      stableFrames: 0,
      frame: 0,
    };
    anchorRestoreRef.current = transaction;
    // This is an explicit navigation transaction, so it temporarily owns the
    // viewport. Native anchoring resumes as soon as the semantic position is
    // restored; allowing both controllers here makes them undo each other.
    transaction.scroller.style.overflowAnchor = 'none';
    listRef.current?.scrollToIndex({ index: targetIndex, align: 'start', behavior: 'auto' });
    const correct = () => {
      if (anchorRestoreRef.current !== transaction) return;
      const scroller = scrollerRef.current;
      const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.rowID) : anchor.rowID.replaceAll('"', '\\"');
      const node = scroller?.querySelector(`[data-presentation-row-id="${escaped}"]`);
      if (!scroller || !node) {
        if (performance.now() - transaction.startedAt < 2_000) {
          listRef.current?.scrollToIndex({ index: targetIndex, align: 'start', behavior: 'auto' });
          transaction.frame = requestAnimationFrame(correct);
        } else {
          restoredAnchorRef.current = false;
          transaction.scroller.style.removeProperty('overflow-anchor');
          anchorRestoreRef.current = null;
        }
        return;
      }
      const delta = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - Number(anchor.offset || 0);
      if (Math.abs(delta) > 0.5) {
        scroller.scrollTop += delta;
        transaction.stableFrames = 0;
      } else {
        transaction.stableFrames += 1;
      }
      if (performance.now() - transaction.startedAt >= 300 && transaction.stableFrames >= 4) {
        restoredAnchorRef.current = true;
        transaction.scroller.style.removeProperty('overflow-anchor');
        anchorRestoreRef.current = null;
        interactionReadyRef.current = listKey;
        transitionMode(VIEWPORT_EVENT.anchorRestored);
        schedulePersistSession();
        return;
      }
      transaction.frame = requestAnimationFrame(correct);
    };
    transaction.frame = requestAnimationFrame(correct);
  }, [listKey, firstItemIndex, items, adapterEpoch]);

  useEffect(() => {
    const anchor = initialAnchorRef.current;
    if (!anchor || restoredAnchorRef.current || restoreRequestRef.current) return;
    if (items.some((row) => row.id === anchor.rowID)) return;
    if (status.localReplicaReady === false) return;
    const demand = port.open({
      intent: HISTORY_INTENT.restorePosition,
      urgency: HISTORY_URGENCY.blocking,
      anchorSeq: Number(anchor.seq || 0),
      viewSpec,
    });
    const request = Promise.resolve(demand).then(async (result) => {
      if (restoreRequestRef.current !== request || initialAnchorRef.current !== anchor) return;
      const currentRows = runtimeRef.current?.items || [];
      if (currentRows.some((row) => row.id === anchor.rowID)) return;
      if (![HISTORY_OPERATION.exhausted, HISTORY_OPERATION.failed, HISTORY_OPERATION.cancelled].includes(result?.kind)) return;
      // Channel reattachment can briefly report an exhausted remote demand
      // before its already-cached projection is republished. Do not turn that
      // transport instant into a destructive navigation decision.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      if (restoreRequestRef.current !== request || initialAnchorRef.current !== anchor) return;
      if ((runtimeRef.current?.items || []).some((row) => row.id === anchor.rowID)) return;
      initialAnchorRef.current = null;
      followLatestRef.current = true;
      transitionMode(VIEWPORT_EVENT.jumpLatest);
      listRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
    }).finally(() => {
      if (restoreRequestRef.current === request) restoreRequestRef.current = null;
    });
    restoreRequestRef.current = request;
  }, [items, status.localReplicaReady, status.buffered, status.hasOlder, status.loading, status.attached, port, viewSpec]);

  function scrollerIsAtBottom() {
    return scrollerRef.current ? isAtBottom(scrollerRef.current) : atBottom;
  }

  function markLatestRead() {
    const current = runtimeRef.current;
    if (!current?.lastSeq || !scrollerRef.current) return;
    if (document.visibilityState === 'hidden' || !followLatestRef.current || !scrollerIsAtBottom()) return;
    current.port.markRead(current.lastSeq);
  }

  useEffect(() => {
    markLatestRead();
    const handleVisibility = () => markLatestRead();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [lastSeq, atBottom, port]);

  useEffect(() => {
    const physicallyAtBottom = scrollerIsAtBottom();
    if (previousList.key !== listKey || (physicallyAtBottom && followLatestRef.current)) {
      setUnseen(0);
      return;
    }
    const added = Math.max(0, items.length - previousList.length);
    if (added > 0 && latestVisibleSeq > previousList.lastSeq) {
      diagnostic('debug', 'timeline.realtime_arrived_while_reading', {
        channelId, added, latestVisibleSeq, previousLastSeq: previousList.lastSeq,
      });
      setUnseen((value) => value + added);
    }
  }, [listKey, latestVisibleSeq, items.length]);

  function requestHistory(trigger, {
    continuation = false,
    queueWhileActive = false,
    allowNearStart = false,
    urgency = HISTORY_URGENCY.interactive,
    revealRows,
  } = {}) {
    const current = runtimeRef.current;
    if (!current || current.status.localReplicaReady === false) return;
    const scroller = scrollerRef.current;
    const physicallyAtTop = !scroller || isAtTop(scroller);
    const visibleRange = visibleRangeRef.current;
    const relativeStart = visibleRange
      ? Math.max(0, Number(visibleRange.startIndex || 0) - Number(transitionRef.current.firstItemIndex || 0))
      : Number.POSITIVE_INFINITY;
    // The virtualizer's range includes its overscan. Forty-eight materialized
    // rows therefore gives the scheduler several viewports of runway instead
    // of waiting for the reader's gesture to hit the physical boundary.
    const nearStart = allowNearStart && relativeStart <= 48;
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setView(current.viewKey);
    const controllerState = controller.snapshot();
    const historyExhausted = current.status.attached
      && !current.status.loading
      && !current.status.hasOlder
      && Number(current.status.buffered || 0) === 0;
    const detail = {
      channelId: current.channelId,
      trigger,
      demandPending: controllerState.active,
      demandArmed: !controllerState.consumed || continuation,
      demandAnchorSeq: current.firstVisibleSeq,
      firstVisibleSeq: current.firstVisibleSeq,
      latestVisibleSeq: current.latestVisibleSeq,
      visibleItems: current.items.length,
      buffered: Number(current.status.buffered || 0),
      hasOlder: Boolean(current.status.hasOlder),
      loading: Boolean(current.status.loading),
      attached: Boolean(current.status.attached),
      generation: Number(current.status.generation || 0),
      scrollTop: Math.round(Number(scroller?.scrollTop || 0)),
      scrollHeight: Math.round(Number(scroller?.scrollHeight || 0)),
      clientHeight: Math.round(Number(scroller?.clientHeight || 0)),
      physicallyAtTop,
      relativeStart: Number.isFinite(relativeStart) ? relativeStart : -1,
      interactionReady: interactionReadyRef.current === current.listKey,
    };
    if (interactionReadyRef.current !== current.listKey) {
      diagnostic('info', 'timeline.history_top_not_ready', detail);
      return;
    }
    // Reaching the oldest known row is a stable terminal state. Repeated wheel
    // or touch input at the physical boundary must not reopen exhausted demand
    // or cause another presentation transition.
    if (historyExhausted) {
      if (controllerState.active) controller.leaveTop();
      diagnostic('debug', 'timeline.history_top_exhausted', detail);
      return;
    }
    if (!physicallyAtTop && !nearStart) {
      diagnostic('info', 'timeline.history_top_stale', detail);
      return;
    }
    diagnostic('info', controllerState.active || (controllerState.consumed && !continuation)
      ? 'timeline.history_top_ignored'
      : 'timeline.history_top_observed', detail);
    const operationId = `${current.channelId}:${++operationSerialRef.current}`;
    const ownedView = current.viewKey;
    void controller.enterTop({
      operationId,
      anchorSeq: current.firstVisibleSeq,
      topEpoch: controllerState.epoch,
      viewSpec: current.viewSpec,
      intent: HISTORY_INTENT.scrollHistory,
      urgency,
      revealRows,
    }, { continuation, queueWhileActive }).then(() => {
      if (controllerRef.current === controller
        && controller.snapshot().viewKey === ownedView
        && !controller.snapshot().active
        && !isAtTop(scrollerRef.current)) {
        controller.leaveTop();
        transitionMode(VIEWPORT_EVENT.anchorRestored);
      }
    });
  }
  requestRef.current = requestHistory;

  function handleAtBottomChange(value) {
    const confirmed = value && followLatestRef.current && scrollerIsAtBottom();
    setAtBottom(confirmed);
    if (!confirmed) return;
    followLatestRef.current = true;
    transitionMode(VIEWPORT_EVENT.tailReached);
    interactionReadyRef.current = listKey;
    setUnseen(0);
    if (isAtTop(scrollerRef.current)) requestHistory('short-list-ready', { continuation: true });
    else controllerRef.current?.leaveTop();
    markLatestRead();
  }

  function handleRangeChanged(range) {
    visibleRangeRef.current = range;
    schedulePersistSession();
    // Refill before the reader hits the physical boundary. At the boundary a
    // prepend must compensate the height of a whole batch under an active
    // gesture, which feels like a bounce even when mathematically anchored.
    // Near-start demand lets the scheduler prepare and release the next batch
    // while there is still scroll runway.
    requestRef.current?.('range-near-start', {
      allowNearStart: true,
      urgency: HISTORY_URGENCY.anticipatory,
      revealRows: 96,
    });
  }

  function handleAtTopChange(value) {
    if (value) {
      requestHistory('at-top-state');
      return;
    }
    if (!isAtTop(scrollerRef.current)) {
      controllerRef.current?.leaveTop();
      diagnostic('debug', 'timeline.history_top_left', {
        channelId,
        pending: controllerRef.current?.snapshot().active,
        scrollTop: Math.round(Number(scrollerRef.current?.scrollTop || 0)),
      });
    }
  }

  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller || status.localReplicaReady === false) return;
    controller.setView(viewKey);
    const scroller = scrollerRef.current;
    if (!scroller || interactionReadyRef.current !== listKey || scroller.scrollTop > 1) return;
    const canLoad = Number(status.buffered || 0) > 0
      || Boolean(status.hasOlder)
      || Boolean(status.loading)
      || !status.attached;
    if (!canLoad) return;
    const short = scroller.clientHeight > 0 && scroller.scrollHeight <= scroller.clientHeight + 1;
    requestHistory(short ? 'short-list-layout' : 'top-level-state', { continuation: short });
  }, [viewKey, listKey, status.localReplicaReady, status.attached, status.loading, status.hasOlder, status.buffered, firstVisibleSeq, items.length]);

  function jumpToLatest() {
    setUnseen(0);
    followLatestRef.current = true;
    transitionMode(VIEWPORT_EVENT.jumpLatest);
    controllerRef.current?.leaveTop();
    listRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' });
  }

  function followTail(totalHeight = 0) {
    const scroller = scrollerRef.current;
    if (!scroller || !followLatestRef.current) return;
    const pin = () => {
      const current = scrollerRef.current;
      if (!current || !followLatestRef.current) return;
      const bottom = Math.max(Number(totalHeight || 0), physicalBottom(current));
      if (Math.abs(current.scrollTop - physicalBottom(current)) > 1) current.scrollTop = bottom;
    };
    pin();
    queueMicrotask(pin);
    requestAnimationFrame(pin);
  }

  return {
    listRef,
    scrollerRef,
    setScroller,
    firstItemIndex,
    hasInitialAnchor: Boolean(initialAnchorRef.current),
    mode,
    unseen,
    status,
    layoutPort: layoutPortRef.current,
    handleStartReached: () => requestHistory('start-reached'),
    handleAtTopChange,
    handleAtBottomChange,
    handleRangeChanged,
    followTail,
    jumpToLatest,
  };
}
