import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reduceViewportMode, VIEWPORT_EVENT, VIEWPORT_MODE } from '../../model/conversation-viewport.js';
import { diagnostic } from '../../model/diagnostics.js';
import { HISTORY_INTENT, HISTORY_URGENCY, normalizeHistoryDemandPort } from '../../model/history-demand.js';
import { createTopIntentController, HISTORY_OPERATION } from '../../model/history-interaction.js';

export const VIRTUAL_INDEX_BASE = 1_000_000_000;
const HISTORY_RUNWAY_ROWS = 96;

// Reading intent only. Virtuoso and DOM geometry belong exclusively to the
// adapter; this hook sends semantic commands and consumes semantic observations.
export function useConversationViewport({
  channelId, lastSeq, history, viewKey, listKey, items, firstVisibleSeq,
  latestVisibleSeq, geometryKey = '', viewSpec, navigationTarget = null, onNavigationTargetConsumed,
  initialSession = {}, onSessionChange,
}) {
  const adapterRef = useRef(null);
  // Loading/restoring are transient process states and are never restored as
  // stable reader intent. An anchor restores browsing; everything else starts
  // from the only stable anchorless state, following.
  const initialMode = initialSession.anchor ? VIEWPORT_MODE.restoring : (
    initialSession.mode === VIEWPORT_MODE.browsing ? VIEWPORT_MODE.browsing : VIEWPORT_MODE.following
  );
  const initialViewportSnapshotRef = useRef(initialSession.viewportSnapshot || null);
  const canRestoreViewportSnapshot = Boolean(
    initialMode !== VIEWPORT_MODE.following
    && initialSession.anchor?.rowID
    && initialViewportSnapshotRef.current?.listKey === listKey
    && initialViewportSnapshotRef.current?.geometryKey === geometryKey
    && initialViewportSnapshotRef.current?.state,
  );
  const initialAnchorRef = useRef(initialSession.anchor || null);
  const restoreIssuedRef = useRef(canRestoreViewportSnapshot);
  const restoreRequestRef = useRef(null);
  const navigationIssuedRef = useRef(null);
  const followsTailRef = useRef(initialMode === VIEWPORT_MODE.following);
  // Physical geometry is not reading intent. A row collapse or late media
  // measurement can make Virtuoso report the bottom without the reader ever
  // asking to return there. Only a downward gesture or an explicit jump arms
  // the transition back to following.
  const tailArrivalArmedRef = useRef(followsTailRef.current);
  const currentAnchorRef = useRef(initialSession.anchor || null);
  const atTopRef = useRef(false);
  const atBottomRef = useRef(followsTailRef.current);
  const transitionRef = useRef({
    key: canRestoreViewportSnapshot ? listKey : '',
    firstID: items[0]?.id || '',
    firstSeq: firstVisibleSeq,
    lastSeq: latestVisibleSeq,
    length: items.length,
    firstItemIndex: canRestoreViewportSnapshot
      ? Number(initialViewportSnapshotRef.current.firstItemIndex || VIRTUAL_INDEX_BASE)
      : VIRTUAL_INDEX_BASE,
  });
  const operationSerialRef = useRef(0);
  const controllerRef = useRef(null);
  const runtimeRef = useRef(null);
  const previousViewKeyRef = useRef(viewKey);
  const [atBottom, setAtBottom] = useState(() => followsTailRef.current);
  const [atTop, setAtTop] = useState(false);
  const [unseen, setUnseen] = useState(() => Number(initialSession.unseenTail || 0));
  const [mode, setMode] = useState(initialMode);
  const transitionMode = (event, options) => setMode((current) => reduceViewportMode(current, event, options));

  const port = normalizeHistoryDemandPort(history);
  const status = port.status;
  runtimeRef.current = {
    channelId, lastSeq, port, status, viewKey, listKey, geometryKey, items,
    firstVisibleSeq, latestVisibleSeq, viewSpec, onSessionChange, mode, unseen,
  };

  function persistSession() {
    const current = runtimeRef.current;
    if (!current?.onSessionChange) return;
    current.onSessionChange({
      // Only stable reader intent crosses a remount. Loading/restoring are
      // processes owned by this mounted controller, not session state.
      mode: followsTailRef.current ? VIEWPORT_MODE.following : VIEWPORT_MODE.browsing,
      anchor: followsTailRef.current ? null : currentAnchorRef.current,
      unseenTail: current.unseen,
      ...(followsTailRef.current ? { viewportSnapshot: null } : {}),
    });
  }

  function handleAnchorObserved(anchor = null) {
    if (!anchor?.rowID || followsTailRef.current) return;
    const row = runtimeRef.current?.items?.find((candidate) => candidate.id === anchor.rowID);
    currentAnchorRef.current = {
      rowID: anchor.rowID,
      offset: Number(anchor.offset || 0),
      seq: Number(row?.seqLow ?? row?.seq ?? 0),
    };
    persistSession();
  }

  function handleAdapterSnapshot(stateSnapshot) {
    const current = runtimeRef.current;
    if (!current?.onSessionChange || !Array.isArray(stateSnapshot?.ranges)) return;
    if (followsTailRef.current || !currentAnchorRef.current?.rowID) {
      current.onSessionChange({ viewportSnapshot: null });
      return;
    }
    current.onSessionChange({
      viewportSnapshot: {
        listKey: current.listKey,
        geometryKey: current.geometryKey,
        firstItemIndex: Number(transitionRef.current.firstItemIndex || VIRTUAL_INDEX_BASE),
        state: stateSnapshot,
      },
    });
  }

  async function openHistoryDemand(goal) {
    const activePort = runtimeRef.current?.port;
    if (!activePort) return { kind: HISTORY_OPERATION.exhausted };
    return await activePort.open({
      intent: HISTORY_INTENT.scrollHistory,
      urgency: HISTORY_URGENCY.interactive,
      ...goal,
    }) || { kind: HISTORY_OPERATION.exhausted };
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
        else if (operationState === HISTORY_OPERATION.satisfied) {
          // firstItemIndex is the sole prepend compensation.
          transitionMode(VIEWPORT_EVENT.demandSatisfied);
          transitionMode(VIEWPORT_EVENT.anchorRestored);
        } else if ([HISTORY_OPERATION.exhausted, HISTORY_OPERATION.failed, HISTORY_OPERATION.cancelled].includes(operationState)) {
          transitionMode(VIEWPORT_EVENT.demandClosed, { followsTail: followsTailRef.current });
        }
      },
    });
  }

  if (controllerRef.current === null) controllerRef.current = createController();

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
  else if (previousList.firstID && items[0]?.id !== previousList.firstID) {
    // Preserve a semantic row, not a ledger sequence. A presentation row may
    // span multiple ledger facts, so its seqLow can change while its identity
    // and place in the conversation remain stable.
    prepended = items.findIndex((entry) => entry.id === previousList.firstID);
    if (prepended > 0) firstItemIndex = previousList.firstItemIndex - prepended;
  }
  const nextTransition = {
    key: listKey, firstID: items[0]?.id || '', firstSeq: firstVisibleSeq, lastSeq: latestVisibleSeq,
    length: items.length, firstItemIndex,
  };

  useLayoutEffect(() => {
    transitionRef.current = nextTransition;
    if (prepended > 0) {
      atTopRef.current = false;
      setAtTop(false);
      controllerRef.current?.observePrepend();
    }
  }, [listKey, nextTransition.firstID, firstVisibleSeq, latestVisibleSeq, items.length, firstItemIndex, prepended]);

  // Changing scope/filter changes the list's meaning. It is explicit
  // navigation, not prepend, and always starts from the latest item.
  useLayoutEffect(() => {
    if (previousViewKeyRef.current === viewKey) return;
    previousViewKeyRef.current = viewKey;
    if (navigationTarget?.rowID && navigationTarget.channelId === channelId) {
      navigationIssuedRef.current = `${navigationTarget.channelId}:${navigationTarget.rowID}:${navigationTarget.token ?? ''}`;
      onNavigationTargetConsumed?.(navigationTarget.token);
    }
    initialAnchorRef.current = null;
    currentAnchorRef.current = null;
    restoreIssuedRef.current = true;
    followsTailRef.current = true;
    tailArrivalArmedRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    setUnseen(0);
    transitionMode(VIEWPORT_EVENT.jumpLatest);
    controllerRef.current?.setView(viewKey);
    controllerRef.current?.leaveTop();
    persistSession();
  }, [viewKey, navigationTarget?.rowID, navigationTarget?.channelId, navigationTarget?.token, channelId, onNavigationTargetConsumed]);

  // Restore is one adapter command. No DOM polling or repeated pixel correction.
  useLayoutEffect(() => {
    const anchor = initialAnchorRef.current;
    if (!anchor || restoreIssuedRef.current || !items.length) return;
    const itemIndex = items.findIndex((row) => row.id === anchor.rowID);
    if (itemIndex < 0) return;
    restoreIssuedRef.current = true;
    followsTailRef.current = false;
    tailArrivalArmedRef.current = false;
    currentAnchorRef.current = anchor;
    adapterRef.current?.restore({ index: firstItemIndex + itemIndex, offset: Number(anchor.offset || 0) });
    transitionMode(VIEWPORT_EVENT.anchorRestored);
  }, [listKey, firstItemIndex, items]);

  useLayoutEffect(() => {
    if (!navigationTarget?.rowID || navigationTarget.channelId !== channelId) return;
    const navigationKey = `${navigationTarget.channelId}:${navigationTarget.rowID}:${navigationTarget.token ?? ''}`;
    if (navigationIssuedRef.current === navigationKey) return;
    const itemIndex = items.findIndex((row) => row.id === navigationTarget.rowID);
    if (itemIndex < 0) return;
    navigationIssuedRef.current = navigationKey;
    initialAnchorRef.current = null;
    currentAnchorRef.current = { rowID: navigationTarget.rowID, offset: 0, seq: Number(items[itemIndex]?.seqLow || 0) };
    followsTailRef.current = false;
    tailArrivalArmedRef.current = false;
    setAtBottom(false);
    transitionMode(VIEWPORT_EVENT.userBrowse);
    adapterRef.current?.focus({ index: firstItemIndex + itemIndex });
    onNavigationTargetConsumed?.(navigationTarget.token);
  }, [navigationTarget?.token, navigationTarget?.rowID, navigationTarget?.channelId, channelId, firstItemIndex, items, onNavigationTargetConsumed]);

  useEffect(() => {
    const anchor = initialAnchorRef.current;
    if (!anchor || restoreIssuedRef.current || restoreRequestRef.current) return;
    if (items.some((row) => row.id === anchor.rowID)) return;
    const demand = port.open({
      intent: HISTORY_INTENT.restorePosition,
      urgency: HISTORY_URGENCY.blocking,
      anchorSeq: Number(anchor.seq || 0),
      viewSpec,
    });
    const request = Promise.resolve(demand).then((result) => {
      if (restoreRequestRef.current !== request || initialAnchorRef.current !== anchor) return;
      if ((runtimeRef.current?.items || []).some((row) => row.id === anchor.rowID)) return;
      if (![HISTORY_OPERATION.exhausted, HISTORY_OPERATION.failed, HISTORY_OPERATION.cancelled].includes(result?.kind)) return;
      initialAnchorRef.current = null;
      currentAnchorRef.current = null;
      restoreIssuedRef.current = true;
      followsTailRef.current = true;
      tailArrivalArmedRef.current = true;
      adapterRef.current?.latest({ behavior: 'auto' });
      transitionMode(VIEWPORT_EVENT.jumpLatest);
      persistSession();
    }).finally(() => {
      if (restoreRequestRef.current === request) restoreRequestRef.current = null;
    });
    restoreRequestRef.current = request;
  }, [items, status.buffered, status.hasOlder, status.loading, status.attached, port, viewSpec]);

  function markLatestRead() {
    const current = runtimeRef.current;
    if (!current?.lastSeq || document.visibilityState === 'hidden' || !followsTailRef.current || !atBottomRef.current) return;
    current.port.markRead(current.lastSeq);
  }

  useEffect(() => {
    markLatestRead();
    const handleVisibility = () => markLatestRead();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [lastSeq, atBottom, port]);

  useEffect(() => {
    if (previousList.key !== listKey || followsTailRef.current) {
      setUnseen(0);
      return;
    }
    if (latestVisibleSeq <= previousList.lastSeq) return;
    const added = items.filter((row) => Number(row.seqHigh ?? row.seq ?? 0) > previousList.lastSeq).length;
    setUnseen((value) => value + Math.max(1, added));
  }, [listKey, latestVisibleSeq, items]);

  function requestHistory(trigger, {
    urgency = HISTORY_URGENCY.interactive, revealRows,
  } = {}) {
    const current = runtimeRef.current;
    if (!current) return;
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setView(current.viewKey);
    const controllerState = controller.snapshot();
    const exhausted = current.status.attached && !current.status.loading
      && !current.status.hasOlder && Number(current.status.buffered || 0) === 0;
    if (exhausted) return;
    const ownedView = current.viewKey;
    void controller.enterTop({
      operationId: `${current.channelId}:${++operationSerialRef.current}`,
      anchorSeq: current.firstVisibleSeq,
      topEpoch: controllerState.epoch,
      viewSpec: current.viewSpec,
      intent: HISTORY_INTENT.scrollHistory,
      urgency,
      revealRows,
      trigger,
    }).then(() => {
      if (controllerRef.current === controller && controller.snapshot().viewKey === ownedView && !controller.snapshot().active) {
        transitionMode(VIEWPORT_EVENT.anchorRestored);
      }
    });
  }

  function handleRangeChanged(range) {
    const relativeStart = Math.max(0, Number(range?.startIndex || 0) - Number(transitionRef.current.firstItemIndex || 0));
    if (relativeStart <= HISTORY_RUNWAY_ROWS) {
      requestHistory('range-runway', { urgency: HISTORY_URGENCY.anticipatory, revealRows: HISTORY_RUNWAY_ROWS });
    }
  }

  function handleStartReached() {
    atTopRef.current = true;
    setAtTop(true);
    requestHistory('start-reached');
  }

  function handleAtTopChange(value) {
    atTopRef.current = Boolean(value);
    setAtTop(Boolean(value));
    if (value) requestHistory('at-top');
  }

  function handleUserIntent(intent) {
    if (initialAnchorRef.current && !restoreIssuedRef.current) {
      initialAnchorRef.current = null;
      restoreIssuedRef.current = true;
    }
    if (navigationTarget?.rowID && navigationTarget.channelId === channelId) {
      navigationIssuedRef.current = `${navigationTarget.channelId}:${navigationTarget.rowID}:${navigationTarget.token ?? ''}`;
      onNavigationTargetConsumed?.(navigationTarget.token);
    }
    if (intent === 'older' || intent === 'browse') {
      followsTailRef.current = false;
      tailArrivalArmedRef.current = false;
      transitionMode(VIEWPORT_EVENT.userBrowse);
      if (intent === 'older') {
        controllerRef.current?.rearm();
        if (atTopRef.current) requestHistory('user-older-at-top');
      }
    } else if (intent === 'newer') {
      tailArrivalArmedRef.current = true;
      controllerRef.current?.leaveTop();
      // When geometry already says we are at the tail, Virtuoso need not emit
      // another atBottomStateChange. The downward gesture itself completes the
      // transition instead of leaving the reader stranded in browsing.
      if (atBottomRef.current && !followsTailRef.current) enterFollowing();
    }
  }

  function enterFollowing() {
    followsTailRef.current = true;
    tailArrivalArmedRef.current = true;
    currentAnchorRef.current = null;
    transitionMode(VIEWPORT_EVENT.tailReached);
    controllerRef.current?.leaveTop();
    setUnseen(0);
    markLatestRead();
    persistSession();
  }

  function handleAtBottomChange(value) {
    // Virtuoso can briefly report both edges while the initial anchor's local
    // window is still being restored. That measurement is not a user action
    // and must not turn a saved browsing session into following.
    if (value && initialAnchorRef.current && !restoreIssuedRef.current) return;
    atBottomRef.current = Boolean(value);
    setAtBottom(Boolean(value));
    if (!value) return;
    if (!followsTailRef.current && !tailArrivalArmedRef.current) return;
    enterFollowing();
  }

  useEffect(() => {
    if (!atTopRef.current) return;
    const canLoad = Number(status.buffered || 0) > 0 || Boolean(status.hasOlder) || Boolean(status.loading) || !status.attached;
    if (canLoad) requestHistory('top-state-change');
  }, [viewKey, status.attached, status.loading, status.hasOlder, status.buffered, firstVisibleSeq, items.length]);

  function jumpToLatest() {
    followsTailRef.current = true;
    tailArrivalArmedRef.current = true;
    currentAnchorRef.current = null;
    setUnseen(0);
    transitionMode(VIEWPORT_EVENT.jumpLatest);
    controllerRef.current?.leaveTop();
    persistSession();
    // The target may be far outside the materialized range. Deterministic IM
    // navigation is one atomic relocation; a long native smooth scroll would
    // expose recycled intermediate rows and compete with fresh user input.
    adapterRef.current?.latest({ behavior: 'auto' });
  }

  return {
    adapterRef,
    firstItemIndex,
    hasInitialAnchor: Boolean(initialAnchorRef.current && !restoreIssuedRef.current),
    hasPendingNavigation: Boolean(
      navigationTarget?.rowID
      && navigationTarget.channelId === channelId
      && navigationIssuedRef.current !== `${navigationTarget.channelId}:${navigationTarget.rowID}:${navigationTarget.token ?? ''}`
    ),
    atTop,
    mode,
    unseen,
    status,
    restoreStateFrom: canRestoreViewportSnapshot ? initialViewportSnapshotRef.current.state : null,
    followOutput: () => (followsTailRef.current ? 'auto' : false),
    handleAdapterSnapshot,
    handleAnchorObserved,
    handleUserIntent,
    handleStartReached,
    handleAtTopChange,
    handleAtBottomChange,
    handleRangeChanged,
    jumpToLatest,
  };
}
