import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { READING_MODE } from '../../model/reading-session.js';
import { FollowingTailList } from './FollowingTailList.jsx';
import { MessageList } from './LegendMessageList.jsx';

// ReadingSession owns the mode synchronously. This component owns only the
// paint handoff between the two mutually-exclusive geometry implementations.
// During following -> browsing, the old DOM remains the painted snapshot while
// Virtuoso materializes the already-committed bookmark underneath it. No timer
// and no scroll writer participates in the reveal.
export function ReadingContainerHandoff({ reading, surfaceVisible, ...props }) {
  const browsing = reading.session.mode === READING_MODE.browsing;
  const [ready, setReady] = useState(false);
  const handoffOriginRef = useRef({
    activationID: reading.activationID,
    inputEpoch: reading.session.inputEpoch,
    focusOwned: false,
    armed: false,
  });
  const focusWithinRef = useRef(false);

  useLayoutEffect(() => {
    if (!browsing) {
      handoffOriginRef.current.armed = false;
      setReady(false);
    }
  }, [browsing]);

  const onHandoffStart = useCallback((detail) => {
    handoffOriginRef.current = {
      activationID: detail.activationID,
      inputEpoch: detail.inputEpoch,
      focusOwned: detail.focusOwned === true || focusWithinRef.current,
      armed: true,
    };
  }, []);

  const onHandoffReady = useCallback((detail) => {
    if (detail.activationID !== reading.activationID) return;
    if ((reading.getSession?.() || reading.session).mode !== READING_MODE.browsing) return;
    if (!handoffOriginRef.current.armed) return;
    setReady(true);
  }, [reading, reading.activationID]);

  // A restored browsing session has no outgoing following paint. Dual mount is
  // reserved for the synchronous following->browsing edge captured above.
  const handoffPending = browsing && handoffOriginRef.current.armed && !ready;
  const followingKey = browsing
    ? `following:${handoffOriginRef.current.activationID}:${handoffOriginRef.current.inputEpoch}`
    : `following:${reading.activationID}:${reading.session.inputEpoch}`;
  const focusIncoming = handoffOriginRef.current.focusOwned || focusWithinRef.current;

  return <div
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
      aria-hidden={browsing || undefined}
      inert={browsing || undefined}
    >
      <FollowingTailList
        key={followingKey}
        {...props}
        reading={reading}
        surfaceVisible={!browsing && surfaceVisible}
        active={!browsing}
        focusOnMount={!browsing && focusIncoming}
        onHandoffStart={onHandoffStart}
      />
    </div>}
    {browsing && <div
      className={`timeline-reading-layer is-incoming${handoffPending ? '' : ' is-active'}`}
    >
      <MessageList
        {...props}
        reading={reading}
        surfaceVisible={!handoffPending && surfaceVisible}
        handoffPending={handoffPending}
        focusOnMount={focusIncoming}
        onHandoffReady={onHandoffReady}
      />
    </div>}
  </div>;
}
