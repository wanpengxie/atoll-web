import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { readingTrace } from '../../model/diagnostics.js';
import { READING_MODE } from '../../model/reading-session.js';
import { createReadingNavigationCoordinator } from './reading-navigation-coordinator.js';
import { executeReadingDOMCommand } from './reading-dom-command-executor.js';

const ReadingNavigationContext = createContext(null);

function directionFromDelta(delta) {
  if (delta < 0) return 'older';
  if (delta > 0) return 'newer';
  return 'browse';
}

function wheelDeltaPixels(event, root) {
  const delta = Number(event.deltaY || 0);
  if (event.deltaMode === 1) return delta * 16;
  if (event.deltaMode === 2) return delta * Math.max(1, Number(root?.clientHeight || 0));
  return delta;
}

function navigationKey(event) {
  if (event.target.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return null;
  if (event.key === 'Home') {
    return { direction: 'older', sourceID: event.code || event.key, absoluteBoundary: 'top' };
  }
  if (['ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
    return { direction: 'older', sourceID: event.code || event.key };
  }
  if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || event.key === ' ') {
    return { direction: 'newer', sourceID: event.code || event.key };
  }
  return null;
}

function nestedScrollOwner(target, root, delta) {
  for (let node = target; node && node !== root; node = node.parentElement) {
    const style = globalThis.getComputedStyle?.(node);
    const scrollable = /auto|scroll/.test(style?.overflowY || '')
      && node.scrollHeight > node.clientHeight + 1;
    if (!scrollable) continue;
    if (delta < 0 && node.scrollTop > 0) return node;
    if (delta > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return node;
  }
  return null;
}

function traceInputOwner(transaction, host, reason) {
  const node = host?.node;
  const detail = {
    activationID: transaction.activationID,
    inputEpoch: transaction.inputGeneration,
    source: transaction.source,
    // Keep the historic diagnostic field while making `source` canonical.
    type: transaction.source,
    direction: transaction.direction,
    gestureID: transaction.id,
    reason,
    hostRole: transaction.hostRole,
    scrollTop: Number(node?.scrollTop || 0),
    scrollHeight: Number(node?.scrollHeight || 0),
    clientHeight: Number(node?.clientHeight || 0),
  };
  readingTrace('reading.input-owner', detail);
  const sink = globalThis.__ATOLL_READING_TRACE__;
  if (typeof sink !== 'function') return;
  try {
    sink({ stage: 'input-owner', at: globalThis.performance?.now?.() || Date.now(), ...detail });
  } catch {
    readingTrace('reading.test-sink-error', { stage: 'input-owner' });
  }
}

// Stable owner of one physical navigation transaction. Renderers register
// geometry readers and observation sinks; they do not mint ReadingSession
// input epochs. Quiet deadlines end input attribution only. Paint admission
// remains the responsibility of ReadingContainerHandoff + the renderer's
// materialization/anchor proof.
export function ReadingNavigationOwner({
  activationID,
  reading,
  stackRef,
  visibleRole,
  onFollowingNavigationTarget,
  children,
}) {
  const ownerTokenRef = useRef(Object.freeze({}));
  const targetRevisionRef = useRef(0);
  const followingTargetRef = useRef(null);
  const committedRef = useRef({ activationID, reading, visibleRole, onFollowingNavigationTarget });
  const hostsRef = useRef(new Map());
  const hostSequenceRef = useRef(0);
  const transactionOwnerRef = useRef(null);
  const scrollTopsRef = useRef(new WeakMap());
  const touchRef = useRef(null);
  const pointerRef = useRef(null);

  const publishFollowingTarget = (transaction, phase = 'active', reason = '') => {
    if (transaction?.hostRole !== 'following') return null;
    const committed = committedRef.current;
    const host = hostsRef.current.get('following');
    if (!host || host.token !== transaction.hostToken) return null;
    const previous = followingTargetRef.current;
    const bookmark = transaction.latestBookmark || host.readBookmark?.() || null;
    const presentationRevision = Number(host.presentationRevision?.() || 0);
    const samePosition = Boolean(
      previous
      && previous.activationID === transaction.activationID
      && previous.inputGeneration === transaction.inputGeneration
      && previous.transactionID === transaction.id
      && previous.hostToken === transaction.hostToken
      && previous.presentationRevision === presentationRevision
      && previous.bookmark?.messageID === bookmark?.messageID
      && Number(previous.bookmark?.rowViewportOffset) === Number(bookmark?.rowViewportOffset),
    );
    const target = Object.freeze({
      ownerToken: ownerTokenRef.current,
      activationID: transaction.activationID,
      originInputEpoch: transactionOwnerRef.current?.originInputEpoch ?? transaction.inputGeneration,
      inputGeneration: transaction.inputGeneration,
      transactionID: transaction.id,
      hostToken: transaction.hostToken,
      targetRevision: samePosition ? previous.targetRevision : ++targetRevisionRef.current,
      presentationRevision,
      bookmark,
      focusOwned: previous?.transactionID === transaction.id
        ? previous.focusOwned
        : host.ownsFocus?.() === true,
      phase,
      reason,
    });
    followingTargetRef.current = target;
    readingTrace('reading.navigation-target', {
      activationID: target.activationID,
      inputEpoch: target.inputGeneration,
      transactionID: target.transactionID,
      targetRevision: target.targetRevision,
      presentationRevision: target.presentationRevision,
      targetID: target.bookmark?.messageID || '',
      targetViewportOffset: target.bookmark?.rowViewportOffset ?? null,
      phase: target.phase,
      reason: target.reason,
    });
    committed.onFollowingNavigationTarget?.(target);
    return target;
  };

  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createReadingNavigationCoordinator({
      activationID,
      onBegin(transaction) {
        const committed = committedRef.current;
        const owner = committed.reading;
        const host = hostsRef.current.get(transaction.hostRole);
        if (!host || host.token !== transaction.hostToken) return 0;
        const before = owner.getSession?.() || owner.session;
        transactionOwnerRef.current = {
          id: transaction.id,
          owner,
          host,
          originInputEpoch: before.inputEpoch,
        };
        const input = {
          direction: transaction.canFollowTail ? transaction.direction : 'browse',
          gestureID: transaction.id,
          geometryRevision: host?.geometryRevision?.() || 0,
        };
        return owner.beginNavigation?.(input) || 0;
      },
      onUpdate(transaction, reason) {
        const captured = transactionOwnerRef.current;
        if (!captured || captured.id !== transaction.id) return;
        const { owner, host } = captured;
        if (reason === 'begin') traceInputOwner(transaction, host, reason);
        if (reason !== 'begin') {
          owner.updateNavigation?.({
            inputGeneration: transaction.inputGeneration,
            direction: transaction.canFollowTail ? transaction.direction : 'browse',
            gestureID: transaction.id,
            geometryRevision: host?.geometryRevision?.() || 0,
          });
        }
        publishFollowingTarget(transaction, 'active', reason);
        host?.onNavigationUpdate?.(transaction, reason);
      },
      onEnd(transaction, reason) {
        const captured = transactionOwnerRef.current;
        if (!captured || captured.id !== transaction.id) return;
        publishFollowingTarget(transaction, 'settled', reason);
        captured.owner.finishNavigation?.({
          inputGeneration: transaction.inputGeneration,
          direction: transaction.direction,
          gestureID: transaction.id,
          reason,
        });
        captured.host.onNavigationEnd?.(transaction, reason);
        transactionOwnerRef.current = null;
      },
      onCancel(transaction, reason) {
        const captured = transactionOwnerRef.current;
        if (!captured || captured.id !== transaction.id) return;
        const preservesViewport = reason === 'contact-cancel' || reason === 'surface-deactivated';
        publishFollowingTarget(transaction, preservesViewport ? 'settled' : 'revoked', reason);
        captured.owner.cancelNavigation?.({
          inputGeneration: transaction.inputGeneration,
          gestureID: transaction.id,
          reason,
        });
        captured.host.onNavigationCancel?.(transaction, reason);
        transactionOwnerRef.current = null;
      },
    });
  }

  useLayoutEffect(() => {
    const previous = committedRef.current;
    const active = coordinatorRef.current.getSnapshot().transaction;
    const nextSession = reading.getSession?.() || reading.session;
    if (active?.inputGeneration
      && active.activationID === activationID
      && Number(active.inputGeneration) !== Number(nextSession.inputEpoch)) {
      coordinatorRef.current.cancel('external-control');
    }
    if (previous.activationID !== activationID) {
      // Revoke through the previously committed owner before publishing the
      // successor. An abandoned render can never redirect live DOM events.
      coordinatorRef.current.replaceActivation(activationID);
      touchRef.current = null;
      pointerRef.current = null;
    }
    committedRef.current = { activationID, reading, visibleRole, onFollowingNavigationTarget };
  }, [activationID, onFollowingNavigationTarget, reading, visibleRole]);

  useLayoutEffect(() => () => coordinatorRef.current.cancel('owner-unmounted'), []);

  const registerHost = useCallback((role, adapter) => {
    const entry = { ...adapter, role, token: ++hostSequenceRef.current };
    hostsRef.current.set(role, entry);
    if (entry.node) scrollTopsRef.current.set(entry.node, Number(entry.node.scrollTop || 0));
    return () => {
      if (hostsRef.current.get(role) !== entry) return;
      const active = coordinatorRef.current.getSnapshot().transaction;
      if (active?.hostToken === entry.token) coordinatorRef.current.cancel('host-unregistered');
      hostsRef.current.delete(role);
    };
  }, []);

  const commitBottomIntent = useCallback((role, expectedIntentID) => {
    const committed = committedRef.current;
    const host = hostsRef.current.get(role);
    const owner = committed.reading;
    let session = owner.getSession?.() || owner.session;
    const intent = session.bottomIntent;
    const receipt = host?.bottomIntentReceipt?.(intent) || null;
    if (!host?.node
      || committed.visibleRole !== role
      || !expectedIntentID
      || intent?.id !== expectedIntentID
      || intent.inputEpoch !== session.inputEpoch
      || (!receipt && host.bottomIntentReady?.(intent) !== true)) return false;

    // An explicit application command supersedes an unfinished physical-input
    // transaction before it receives geometry authority. The cancellation is
    // synchronous; a later native input advances inputEpoch and therefore makes
    // this exact intent ineligible before any write can occur.
    if (coordinatorRef.current.getSnapshot().transaction) {
      coordinatorRef.current.cancel('application-control');
      session = owner.getSession?.() || owner.session;
      if (session.bottomIntent?.id !== expectedIntentID
        || session.bottomIntent.inputEpoch !== session.inputEpoch) return false;
    }

    const alreadyAtTail = host.atTail?.() === true;
    if (!alreadyAtTail && typeof host.node.scrollTo !== 'function') return false;
    const destinations = receipt?.destinations || [];
    const destinationKinds = [...new Set(destinations.map((entry) => entry.destination).filter(Boolean))];
    const detail = {
      source: 'application-control',
      activationID: session.activationID,
      inputEpoch: session.inputEpoch,
      intentID: expectedIntentID,
      hostRole: role,
      authorityLabel: expectedIntentID.startsWith('composer:send-start:') ? 'intent' : 'bottom-intent',
      sendDestination: destinationKinds.length === 1 ? destinationKinds[0]
        : destinationKinds.length > 1 ? 'mixed' : '',
      sendReadyRevision: Number(receipt?.presentationRevision || 0),
      sendTargetIDs: [...(intent.targetMessageIDs || [])],
      afterPresentationRevision: Number(intent.afterPresentationRevision || 0),
      scrollTop: Number(host.node.scrollTop || 0),
      scrollHeight: Number(host.node.scrollHeight || 0),
      clientHeight: Number(host.node.clientHeight || 0),
    };
    // The issuer event is the authorization boundary for the physical write,
    // so publish it before calling the single DOM capability. Tests and runtime
    // diagnostics can then join the command to the exact intent/epoch.
    if (!alreadyAtTail) readingTrace('reading.issuer-write', detail);
    const executed = alreadyAtTail || executeReadingDOMCommand(Object.freeze({
      type: 'scroll-tail',
      reverse: role === 'following',
    }), { root: host.node });
    if (!executed || host.atTail?.() !== true) return false;

    const current = owner.getSession?.() || owner.session;
    if (current.bottomIntent?.id !== expectedIntentID
      || current.bottomIntent.inputEpoch !== current.inputEpoch) return false;
    if (typeof owner.consumeBottomIntent !== 'function') return false;
    const consumed = owner.consumeBottomIntent({
      id: expectedIntentID,
      inputEpoch: current.inputEpoch,
    }) === true;
    if (consumed && alreadyAtTail) {
      readingTrace('reading.issuer-satisfy', {
        ...detail,
        reason: alreadyAtTail ? 'already-at-tail' : 'explicit-bottom',
        scrollTop: Number(host.node.scrollTop || 0),
        scrollHeight: Number(host.node.scrollHeight || 0),
        clientHeight: Number(host.node.clientHeight || 0),
      });
    }
    return consumed;
  }, []);

  const api = useMemo(() => Object.freeze({
    getTransaction: () => coordinatorRef.current.getSnapshot().transaction,
    registerHost,
    commitBottomIntent,
  }), [commitBottomIntent, registerHost]);

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return undefined;
    const coordinator = coordinatorRef.current;
    const hostForVisibleRole = () => hostsRef.current.get(committedRef.current.visibleRole);
    const eventDetail = (host, extra = {}, { prepare = true, bookmark = true } = {}) => {
      // The renderer may have a visual-only layout transition in flight. The
      // unique physical-input owner synchronously settles it before reading
      // geometry, so a NavigationTarget can never capture an intermediate
      // animated bookmark. Mere touch/selection contact is still potential and
      // deliberately does neither until real motion arrives.
      if (prepare) host.prepareNavigationRead?.(extra);
      return {
        activationID: committedRef.current.activationID,
        hostRole: host.role,
        hostToken: host.token,
        bookmark: bookmark ? host.readBookmark?.() || null : null,
        canFollowTail: host.canFollowTail !== false,
        canRequestHistory: host.canRequestHistory !== false,
        at: globalThis.performance?.now?.() || Date.now(),
        ...extra,
      };
    };
    const shouldDeferFollowing = (host) => host.role === 'following'
      && (committedRef.current.reading.getSession?.()
        || committedRef.current.reading.session).mode === READING_MODE.following;
    const recordInput = (host, detail) => {
      const owner = committedRef.current.reading;
      const session = owner.getSession?.() || owner.session;
      if (detail.direction === 'newer' && session.mode === READING_MODE.following
        && host.atTail?.() === true) return null;
      // Relative following input becomes authoritative only after the browser
      // supplies physical displacement. Home is already an explicit semantic
      // request for the start boundary, so it must not depend on a scroll edge
      // that column-reverse browsers are allowed to omit.
      if (shouldDeferFollowing(host) && detail.absoluteBoundary !== 'top') {
        return coordinator.beginPotential(eventDetail(host, detail));
      }
      return coordinator.recordInput(eventDetail(host, detail));
    };
    const onWheel = (event) => {
      const host = hostForVisibleRole();
      if (!host?.node) return;
      const delta = wheelDeltaPixels(event, host.node);
      if (!delta || nestedScrollOwner(event.target, host.node, delta)) return;
      recordInput(host, { source: 'wheel', direction: directionFromDelta(delta) });
    };
    const onTouchStart = (event) => {
      const host = hostForVisibleRole();
      const touch = event.touches?.[0];
      if (!host?.node || !touch) return;
      if (touchRef.current) return;
      touchRef.current = {
        hostRole: host.role, hostToken: host.token, identifier: touch.identifier, y: touch.clientY,
      };
      coordinator.beginPotential(eventDetail(host, {
        source: 'touch', sourceID: touch.identifier,
      }, { prepare: true, bookmark: false }));
    };
    const onTouchMove = (event) => {
      const contact = touchRef.current;
      const host = contact && hostsRef.current.get(contact.hostRole);
      const touch = [...(event.touches || [])].find((item) => item.identifier === contact?.identifier);
      if (!host?.node || host.token !== contact?.hostToken || !touch) return;
      const delta = Number(touch.clientY) - Number(contact.y);
      if (Math.abs(delta) <= 2 || nestedScrollOwner(event.target, host.node, -delta)) return;
      contact.y = touch.clientY;
      recordInput(host, {
        source: 'touch', sourceID: contact.identifier, direction: delta > 0 ? 'older' : 'newer',
      });
    };
    const onTouchEnd = (event) => {
      const contact = touchRef.current;
      if (!contact) return;
      if (![...(event.changedTouches || [])].some((touch) => touch.identifier === contact.identifier)) return;
      coordinator.endContact({
        activationID: committedRef.current.activationID,
        hostRole: contact.hostRole,
        hostToken: contact.hostToken,
        source: 'touch',
        sourceID: contact.identifier,
      });
      touchRef.current = null;
    };
    const onTouchCancel = (event) => {
      const contact = touchRef.current;
      if (!contact) return;
      if (![...(event.changedTouches || [])].some((touch) => touch.identifier === contact.identifier)) return;
      coordinator.cancelContact({
        activationID: committedRef.current.activationID,
        hostRole: contact.hostRole,
        hostToken: contact.hostToken,
        source: 'touch',
        sourceID: contact.identifier,
      });
      touchRef.current = null;
    };
    const onKeyDown = (event) => {
      const key = navigationKey(event);
      const host = key && hostForVisibleRole();
      if (!host?.node) return;
      recordInput(host, { source: 'key', ...key });
    };
    const onKeyUp = (event) => {
      const current = coordinator.getSnapshot().transaction;
      const sourceID = event.code || event.key;
      if (current?.source !== 'key' || current.sourceID !== String(sourceID || '')) return;
      coordinator.endContact({
        activationID: current.activationID,
        hostRole: current.hostRole,
        hostToken: current.hostToken,
        source: 'key',
        sourceID,
      });
    };
    const onPointerDown = (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      const host = hostForVisibleRole();
      if (!host?.node) return;
      const scrollbar = event.target === host.node;
      pointerRef.current = {
        hostRole: host.role, hostToken: host.token,
        pointerID: event.pointerId, x: event.clientX, y: event.clientY, scrollbar,
      };
      const detail = {
        source: scrollbar ? 'scrollbar' : 'selection',
        sourceID: event.pointerId,
        direction: 'browse',
        canFollowTail: scrollbar,
        canRequestHistory: scrollbar,
      };
      if (scrollbar) recordInput(host, detail);
      else coordinator.beginPotential(eventDetail(host, detail, {
        prepare: true,
        bookmark: false,
      }));
    };
    const onPointerMove = (event) => {
      const pointer = pointerRef.current;
      const host = pointer && hostsRef.current.get(pointer.hostRole);
      if (!host || host.token !== pointer.hostToken
        || event.pointerId !== pointer.pointerID || pointer.scrollbar) return;
      if (Math.abs(event.clientX - pointer.x) < 3 && Math.abs(event.clientY - pointer.y) < 3) return;
      coordinator.recordInput(eventDetail(host, {
        source: 'selection', sourceID: pointer.pointerID, direction: 'browse',
        canFollowTail: false, canRequestHistory: false,
      }));
    };
    const onPointerEnd = (event) => {
      const pointer = pointerRef.current;
      const host = pointer && hostsRef.current.get(pointer.hostRole);
      if (!host || host.token !== pointer.hostToken || event.pointerId !== pointer.pointerID) return;
      coordinator.endContact(eventDetail(host, {
        source: pointer.scrollbar ? 'scrollbar' : 'selection', sourceID: pointer.pointerID,
      }, { prepare: false, bookmark: false }));
      pointerRef.current = null;
    };
    const onPointerCancel = (event) => {
      const pointer = pointerRef.current;
      if (!pointer || event.pointerId !== pointer.pointerID) return;
      coordinator.cancelContact({
        activationID: committedRef.current.activationID,
        hostRole: pointer.hostRole,
        hostToken: pointer.hostToken,
        source: pointer.scrollbar ? 'scrollbar' : 'selection', sourceID: pointer.pointerID,
      });
      pointerRef.current = null;
    };
    const onScroll = (event) => {
      const host = [...hostsRef.current.values()].find((candidate) => candidate.node === event.target);
      if (!host?.node) return;
      const previous = Number(scrollTopsRef.current.get(host.node) ?? host.node.scrollTop ?? 0);
      const next = Number(host.node.scrollTop || 0);
      scrollTopsRef.current.set(host.node, next);
      const direction = host.scrollDirection?.(previous, next) || directionFromDelta(next - previous);
      if (direction === 'browse') return;
      const current = coordinator.getSnapshot().transaction;
      if (!current || current.hostRole !== host.role) return;
      if (current.phase === 'potential') {
        if (direction === 'browse' || host.isEffectiveMotion?.(previous, next) === false) return;
        coordinator.recordInput(eventDetail(host, {
          direction,
          source: current.source,
          sourceID: current.sourceID,
          canFollowTail: current.canFollowTail,
          canRequestHistory: current.canRequestHistory,
        }));
      } else {
        coordinator.recordScroll(eventDetail(host, {
          direction,
          source: current.source,
          sourceID: current.sourceID,
          canFollowTail: current.canFollowTail,
          canRequestHistory: current.canRequestHistory,
        }));
      }
    };
    const onScrollEnd = (event) => {
      const host = [...hostsRef.current.values()].find((candidate) => candidate.node === event.target);
      if (!host) return;
      coordinator.recordScrollEnd({
        activationID: committedRef.current.activationID,
        hostRole: host.role,
        hostToken: host.token,
      });
    };
    const cancelActiveContact = () => {
      coordinator.cancel('surface-deactivated');
      touchRef.current = null;
      pointerRef.current = null;
    };
    const onVisibilityChange = () => {
      if (globalThis.document?.visibilityState === 'hidden') cancelActiveContact();
    };

    stack.addEventListener('wheel', onWheel, { capture: true, passive: true });
    stack.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    stack.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    stack.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    stack.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    stack.addEventListener('keydown', onKeyDown, { capture: true });
    globalThis.addEventListener?.('keyup', onKeyUp, { capture: true });
    stack.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    stack.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    globalThis.addEventListener?.('pointerup', onPointerEnd, { capture: true, passive: true });
    globalThis.addEventListener?.('pointercancel', onPointerCancel, { capture: true, passive: true });
    stack.addEventListener('scroll', onScroll, { capture: true, passive: true });
    stack.addEventListener('scrollend', onScrollEnd, { capture: true, passive: true });
    globalThis.addEventListener?.('blur', cancelActiveContact);
    globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);
    return () => {
      stack.removeEventListener('wheel', onWheel, { capture: true });
      stack.removeEventListener('touchstart', onTouchStart, { capture: true });
      stack.removeEventListener('touchmove', onTouchMove, { capture: true });
      stack.removeEventListener('touchend', onTouchEnd, { capture: true });
      stack.removeEventListener('touchcancel', onTouchCancel, { capture: true });
      stack.removeEventListener('keydown', onKeyDown, { capture: true });
      globalThis.removeEventListener?.('keyup', onKeyUp, { capture: true });
      stack.removeEventListener('pointerdown', onPointerDown, { capture: true });
      stack.removeEventListener('pointermove', onPointerMove, { capture: true });
      globalThis.removeEventListener?.('pointerup', onPointerEnd, { capture: true });
      globalThis.removeEventListener?.('pointercancel', onPointerCancel, { capture: true });
      stack.removeEventListener('scroll', onScroll, { capture: true });
      stack.removeEventListener('scrollend', onScrollEnd, { capture: true });
      globalThis.removeEventListener?.('blur', cancelActiveContact);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
    };
  }, [stackRef]);

  return <ReadingNavigationContext.Provider value={api}>{children}</ReadingNavigationContext.Provider>;
}

export function useReadingNavigationHost(role, adapter, node) {
  const owner = useContext(ReadingNavigationContext);
  useLayoutEffect(() => {
    if (!owner || !node) return undefined;
    return owner.registerHost(role, { ...adapter, node });
  }, [adapter, node, owner, role]);
  return owner;
}

export function useReadingNavigationOwner() {
  return useContext(ReadingNavigationContext);
}
