import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { readingTrace } from '../../model/diagnostics.js';
import { READING_MODE } from '../../model/reading-session.js';
import { FollowingTailList } from './FollowingTailList.jsx';
import { MessageList } from './LegendMessageList.jsx';
import { ReadingNavigationOwner } from './ReadingNavigationOwner.jsx';

// ReadingSession owns the mode synchronously. This component owns only the
// paint handoff between the two mutually-exclusive geometry implementations.
// During following -> browsing, the old DOM remains the sole visible/input
// surface while Virtuoso positions the exact current navigation target below
// it. Input settle, target positioning and paint admission are separate: only
// a matching receipt may atomically reveal the incoming surface.
export function ReadingContainerHandoff({ reading, surfaceVisible, ...props }) {
  const currentSession = reading.getSession?.() || reading.session;
  const browsing = currentSession.mode === READING_MODE.browsing;
  const [ready, setReady] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState(null);
  const navigationTargetRef = useRef(null);
  const revealReceiptRef = useRef(null);
  const readyActivationRef = useRef('');
  const outgoingEpochRef = useRef(currentSession.inputEpoch);
  const focusWithinRef = useRef(false);
  const stackRef = useRef(null);

  useLayoutEffect(() => {
    const target = navigationTargetRef.current;
    const activationInvalid = Boolean(target && target.activationID !== reading.activationID);
    const inputInvalid = Boolean(
      target && Number(target.inputGeneration) !== Number(currentSession.inputEpoch),
    );
    const completedActivationInvalid = Boolean(
      ready && readyActivationRef.current && readyActivationRef.current !== reading.activationID,
    );
    if (!browsing || activationInvalid || inputInvalid || completedActivationInvalid) {
      navigationTargetRef.current = null;
      revealReceiptRef.current = null;
      outgoingEpochRef.current = currentSession.inputEpoch;
      setNavigationTarget(null);
      // After the exact receipt has atomically revealed browsing, a later
      // ordinary browsing transaction advances inputEpoch without revoking the
      // already-active renderer. `ready` remains the completed handoff marker
      // until mode/activation replacement; only a still-pending target is
      // cancelled by an epoch mismatch.
      if (!ready || !browsing || activationInvalid || completedActivationInvalid) {
        readyActivationRef.current = '';
        setReady(false);
      }
    }
  }, [browsing, currentSession.inputEpoch, reading.activationID, ready]);

  const receiptMatches = useCallback((target, receipt) => Boolean(
    target
    && receipt
    && receipt.ownerToken === target.ownerToken
    && receipt.activationID === target.activationID
    && Number(receipt.inputGeneration) === Number(target.inputGeneration)
    && receipt.transactionID === target.transactionID
    && receipt.hostToken === target.hostToken
    && Number(receipt.targetRevision) === Number(target.targetRevision)
    && Number(receipt.presentationRevision) === Number(target.presentationRevision)
    && receipt.targetID === target.bookmark?.messageID
    && receipt.materialized === true
    && Number(receipt.paintRevision) > 0
  ), []);

  const onFollowingNavigationTarget = useCallback((target) => {
    if (target.activationID !== reading.activationID) {
      readingTrace('reading.navigation-target-rejected', {
        reason: 'activation', targetActivationID: target.activationID,
        activationID: reading.activationID,
      });
      return;
    }
    const current = reading.getSession?.() || reading.session;
    if (target.phase === 'revoked'
      || Number(target.inputGeneration) !== Number(current.inputEpoch)) {
      navigationTargetRef.current = null;
      revealReceiptRef.current = null;
      outgoingEpochRef.current = current.inputEpoch;
      setNavigationTarget(null);
      readyActivationRef.current = '';
      setReady(false);
      readingTrace('reading.navigation-target-rejected', {
        reason: target.phase === 'revoked' ? 'revoked' : 'input-generation',
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        targetInputEpoch: target.inputGeneration,
      });
      return;
    }
    const previous = navigationTargetRef.current;
    const replaced = !previous
      || previous.ownerToken !== target.ownerToken
      || previous.transactionID !== target.transactionID
      || previous.targetRevision !== target.targetRevision;
    navigationTargetRef.current = target;
    if (!previous) outgoingEpochRef.current = target.originInputEpoch;
    setNavigationTarget(target);
    readingTrace('reading.navigation-target-accepted', {
      activationID: target.activationID,
      inputEpoch: target.inputGeneration,
      transactionID: target.transactionID,
      targetRevision: target.targetRevision,
      targetID: target.bookmark?.messageID || '',
      phase: target.phase,
      replaced,
    });
    if (replaced) {
      revealReceiptRef.current = null;
      readyActivationRef.current = '';
      setReady(false);
    }
    if (target.phase === 'settled' && receiptMatches(target, revealReceiptRef.current)) {
      readyActivationRef.current = target.activationID;
      setReady(true);
    }
  }, [reading, receiptMatches]);

  const onNavigationRevealReceipt = useCallback((receipt) => {
    const target = navigationTargetRef.current;
    if (!receiptMatches(target, receipt)) return;
    revealReceiptRef.current = receipt;
    if (target.phase === 'settled') {
      readyActivationRef.current = target.activationID;
      setReady(true);
    }
  }, [receiptMatches]);

  // A restored browsing session has no outgoing following paint. Dual mount is
  // reserved for the synchronous following->browsing edge captured above.
  const exactTarget = navigationTarget
    && navigationTarget.activationID === reading.activationID
    && Number(navigationTarget.inputGeneration) === Number(currentSession.inputEpoch)
    && navigationTarget.phase !== 'revoked'
    ? navigationTarget
    : null;
  const handoffPending = browsing && Boolean(exactTarget) && !ready;
  const followingKey = browsing
    ? `following:${exactTarget?.activationID || reading.activationID}:${outgoingEpochRef.current}`
    : `following:${reading.activationID}:${currentSession.inputEpoch}`;
  const focusIncoming = exactTarget?.focusOwned === true || focusWithinRef.current;

  const visibleRole = handoffPending || !browsing ? 'following' : 'browsing';

  return <ReadingNavigationOwner
    activationID={reading.activationID}
    reading={reading}
    stackRef={stackRef}
    visibleRole={visibleRole}
    onFollowingNavigationTarget={onFollowingNavigationTarget}
  ><div
      ref={stackRef}
      className="timeline-reading-stack"
      data-handoff-pending={handoffPending || undefined}
      data-handoff-ready={browsing && ready ? 'true' : undefined}
      onFocusCapture={() => { focusWithinRef.current = true; }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusWithinRef.current = false;
      }}
    >
    {(!browsing || handoffPending) && <div
      className={browsing ? 'timeline-reading-layer is-outgoing' : 'timeline-reading-layer is-active'}
      aria-hidden={undefined}
    >
      <FollowingTailList
        key={followingKey}
        {...props}
        reading={reading}
        surfaceVisible={surfaceVisible}
        active
        focusOnMount={!browsing && focusIncoming}
      />
    </div>}
    {browsing && <div
      className={`timeline-reading-layer is-incoming${handoffPending ? '' : ' is-active'}`}
      aria-hidden={handoffPending || undefined}
      inert={handoffPending || undefined}
    >
      <MessageList
        {...props}
        reading={reading}
        surfaceVisible={!handoffPending && surfaceVisible}
        handoffPending={handoffPending}
        navigationTarget={exactTarget}
        focusOnMount={focusIncoming}
        onNavigationRevealReceipt={onNavigationRevealReceipt}
      />
    </div>}
    </div></ReadingNavigationOwner>;
}
