import { describe, expect, it } from 'vitest';
import {
  bindLatestIntentTargets,
  acceptPositionRowLease,
  captureContentAnchor,
  cancelHistoryStartIntent,
  cancelReadingControl,
  consumeContentAnchor,
  consumePositionRowLease,
  consumeLatestIntent,
  contentAnchorCommand,
  consumeHistoryStartIntent,
  createReadingSession,
  observeReading,
  positionRowLeaseCommand,
  READING_MODE,
  revokePositionRowLease,
  requestLatest,
  historyStartIntentCommand,
  takeReadingControl,
  updateHistoryAnchor,
  updateReadingControl,
} from '../src/model/reading-session.js';

function session(saved = {}, activationID = 'a1') {
  return createReadingSession({ key: 'c0:all', activationID, saved });
}

describe('reading session authority', () => {
  it('mints an ephemeral, fully fenced Home history-start intent and revokes stale input', () => {
    const current = takeReadingControl(session(), {
      direction: 'older',
      gestureID: 'key:Home',
      historyStart: true,
      channelID: 'c0',
      viewKey: 'all',
      generation: 4,
      sourceLease: 'world:4',
      historyAnchor: { messageID: 'm120', viewportOffset: 200 },
    });
    expect(current.historyAnchor).toBeNull();
    expect(current.historyStartIntent).toMatchObject({
      type: 'history-start',
      activationID: 'a1',
      channelID: 'c0',
      viewKey: 'all',
      generation: 4,
      sourceLease: 'world:4',
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
      direction: 'older',
    });
    expect(historyStartIntentCommand(current, {
      channelID: 'c0', viewKey: 'all', generation: 4, sourceLease: 'world:4',
      inputEpoch: current.inputEpoch, intentRevision: current.intentRevision,
    })).toEqual(current.historyStartIntent);
    expect(historyStartIntentCommand(current, {
      channelID: 'c0', viewKey: 'all', generation: 5, sourceLease: 'world:4',
      inputEpoch: current.inputEpoch, intentRevision: current.intentRevision,
    })).toBeNull();

    const reversed = updateReadingControl(current, {
      inputEpoch: current.inputEpoch, direction: 'newer', gestureID: 'key:Home',
    });
    expect(reversed.historyStartIntent).toBeNull();
    const cancelled = cancelHistoryStartIntent(current, current.historyStartIntent);
    expect(cancelled.historyStartIntent).toBeNull();
    expect(cancelled.inputEpoch).toBe(current.inputEpoch + 1);
    expect(consumeHistoryStartIntent(cancelled, current.historyStartIntent)).toBe(cancelled);
  });

  it('restores saved browsing state without creating an imperative navigation task', () => {
    const bookmark = { messageID: 'm80', viewportOffset: -12, rowViewportOffset: -40 };
    const current = session({ mode: READING_MODE.browsing, bookmark });
    expect(current.mode).toBe(READING_MODE.browsing);
    expect(current.bookmark).toMatchObject(bookmark);
    expect(current).not.toHaveProperty('navigation');
  });

  it('never changes browsing intent because data or geometry changed', () => {
    let current = session({ mode: READING_MODE.browsing, bookmark: { messageID: 'm4', viewportOffset: 12 } });
    current = observeReading(current, {
      activationID: 'a1', bookmark: { messageID: 'm4', viewportOffset: 12 },
      atTail: true, source: 'layout', geometryRevision: 9,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
    expect(current.bookmark.messageID).toBe('m4');
  });

  it('records the currently visible row after layout without treating it as user tail evidence', () => {
    let current = session({ mode: READING_MODE.browsing, bookmark: { messageID: 'm4', viewportOffset: 12 } });
    current = observeReading(current, {
      activationID: 'a1', bookmark: { messageID: 'm7', viewportOffset: -18 },
      atTail: true, source: 'layout', geometryRevision: 9,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
    expect(current.bookmark).toMatchObject({ messageID: 'm7', viewportOffset: -18 });
  });

  it('invalidates a pending return-to-bottom synchronously on native input', () => {
    const requested = requestLatest(takeReadingControl(session(), { direction: 'older' }), 'latest');
    const intent = requested.bottomIntent;
    const browsing = takeReadingControl(requested, { direction: 'older', gestureID: 'wheel' });
    expect(browsing.mode).toBe(READING_MODE.browsing);
    expect(browsing.bottomIntent.id).toBe('');
    expect(consumeLatestIntent(browsing, { ...intent, activationID: 'a1' })).toBe(browsing);
  });

  it('mints a successor authority epoch for an explicit return from browsing', () => {
    const browsing = takeReadingControl(session(), {
      direction: 'older',
      gestureID: 'leave:one',
    });
    const returned = requestLatest(browsing, 'latest:successor', {
      mintSuccessorEpoch: true,
      baselineTailID: 'tail:old',
    });

    expect(returned.mode).toBe(READING_MODE.following);
    expect(returned.inputEpoch).toBe(browsing.inputEpoch + 1);
    expect(returned.intentRevision).toBe(browsing.intentRevision + 1);
    expect(returned.revision).toBe(browsing.revision + 1);
    expect(returned.bottomIntent.inputEpoch).toBe(returned.inputEpoch);
    expect(returned.bottomIntent.baselineTailID).toBe('tail:old');
    expect(consumeLatestIntent(returned, {
      ...returned.bottomIntent,
      inputEpoch: browsing.inputEpoch,
      activationID: returned.activationID,
    })).toBe(returned);
  });

  it('captures a browsing content anchor and emits one typed restore command', () => {
    let current = takeReadingControl(session(), { direction: 'older', gestureID: 'fold' });
    current = captureContentAnchor(current, {
      anchorID: 'turn:body', viewportOffset: 172.5,
      beforeScrollHeight: 9912, expectedExpanded: true,
    });
    const command = contentAnchorCommand(current);
    expect(command).toMatchObject({
      type: 'restore-content-anchor',
      anchorID: 'turn:body', viewportOffset: 172.5,
      beforeScrollHeight: 9912, expectedExpanded: true,
    });
    const consumed = consumeContentAnchor(current, command);
    expect(consumed.contentAnchor).toBeNull();
    expect(contentAnchorCommand(consumed)).toBeNull();
  });

  it('accepts one exact history position lease and revokes it on reverse/latest input', () => {
    let current = takeReadingControl(session(), {
      direction: 'older',
      gestureID: 'wheel:one',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    expect(current.historyAnchor).toMatchObject({
      messageID: 'm80', viewportOffset: -394, inputEpoch: current.inputEpoch,
    });
    const lease = {
      type: 'position-row',
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
      operationID: 'history:a1:7',
      viewID: 'c0:all',
      epoch: 'c0:4',
      presentationRevision: 12,
      messageID: 'm80',
      viewportOffset: -394,
    };
    current = acceptPositionRowLease(current, lease);
    expect(positionRowLeaseCommand(current)).toMatchObject(lease);
    expect(positionRowLeaseCommand(current)).not.toBe(lease);
    expect(positionRowLeaseCommand(
      acceptPositionRowLease(current, { ...lease, viewportOffset: -393 }),
    )).toMatchObject(lease);

    const reversed = updateReadingControl(current, {
      inputEpoch: current.inputEpoch,
      direction: 'newer',
      gestureID: 'wheel:one',
      geometryRevision: 3,
    });
    expect(positionRowLeaseCommand(reversed)).toBeNull();
    expect(revokePositionRowLease(reversed)).toBe(reversed);

    current = takeReadingControl(session(), {
      direction: 'older',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    current = acceptPositionRowLease(current, lease);
    expect(positionRowLeaseCommand(current)).toMatchObject(lease);
    expect(requestLatest(current, 'latest').positionRowLease).toBeNull();
  });

  it('rebases an older input epoch onto its existing physical anchor', () => {
    let current = takeReadingControl(session(), {
      direction: 'older',
      gestureID: 'wheel:one',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    const rebased = takeReadingControl(current, {
      direction: 'older',
      gestureID: 'wheel:one',
      historyAnchor: { messageID: 'm80', viewportOffset: 35 },
    });
    expect(rebased.inputEpoch).toBe(current.inputEpoch + 1);
    expect(rebased.intentRevision).toBe(current.intentRevision + 1);
    expect(rebased.historyAnchor).toMatchObject({
      messageID: 'm80', viewportOffset: -394,
      inputEpoch: rebased.inputEpoch, intentRevision: rebased.intentRevision,
    });
  });

  it('starts an independent older gesture from its newly captured anchor', () => {
    let current = takeReadingControl(session(), {
      direction: 'older',
      gestureID: 'wheel:one',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    const nextGesture = takeReadingControl(current, {
      direction: 'older',
      gestureID: 'wheel:two',
      historyAnchor: { messageID: 'm72', viewportOffset: -120 },
    });
    expect(nextGesture.historyAnchor).toMatchObject({
      gestureID: 'wheel:two', messageID: 'm72', viewportOffset: -120,
      inputEpoch: current.inputEpoch + 1,
      intentRevision: current.intentRevision + 1,
    });
  });

  it('does not reuse an older anchor when the production input has no gesture id', () => {
    let current = takeReadingControl(session(), {
      direction: 'older',
      gestureID: 'wheel:one',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    const next = takeReadingControl(current, {
      direction: 'older',
      historyAnchor: { messageID: 'm72', viewportOffset: -120 },
    });
    expect(next.historyAnchor).toMatchObject({
      messageID: 'm72', viewportOffset: -120, gestureID: '',
    });
    expect(next.historyAnchor.messageID).not.toBe(current.historyAnchor.messageID);
  });

  it('consumes a position lease only after every identity field matches', () => {
    let current = takeReadingControl(session(), {
      direction: 'older',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    const lease = {
      type: 'position-row', activationID: 'a1', inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision, operationID: 'history:a1:1',
      viewID: 'c0:all', epoch: 'c0:4', presentationRevision: 12,
      messageID: 'm80', viewportOffset: -394,
    };
    current = acceptPositionRowLease(current, lease);
    expect(positionRowLeaseCommand(current)).not.toBeNull();
    const wrong = { ...lease, presentationRevision: 13 };
    expect(revokePositionRowLease(current, wrong)).toBe(current);
    expect(positionRowLeaseCommand(current)).not.toBeNull();
    expect(consumePositionRowLease(current, wrong)).toBe(current);
    expect(consumePositionRowLease(current, lease).positionRowLease).toBeNull();
  });

  it('clears the matching history anchor only for a terminal lease revoke', () => {
    let current = takeReadingControl(session(), {
      direction: 'older',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    const lease = {
      type: 'position-row', activationID: 'a1', inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision, operationID: 'history:a1:revoke',
      viewID: 'c0:all', epoch: 'c0:4', presentationRevision: 12,
      messageID: 'm80', viewportOffset: -394,
    };
    current = acceptPositionRowLease(current, lease);
    expect(revokePositionRowLease(current, lease).historyAnchor).not.toBeNull();
    expect(revokePositionRowLease(current, lease, { clearHistoryAnchor: true }).historyAnchor).toBeNull();
  });

  it('records the new first-row anchor only after the accepted lease is consumed', () => {
    let current = takeReadingControl(session(), {
      direction: 'older',
      historyAnchor: { messageID: 'm80', viewportOffset: -394 },
    });
    const lease = {
      type: 'position-row', activationID: 'a1', inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision, operationID: 'history:a1:anchor',
      viewID: 'c0:all', epoch: 'c0:4', presentationRevision: 12,
      messageID: 'm80', viewportOffset: -394,
    };
    current = acceptPositionRowLease(current, lease);
    expect(updateHistoryAnchor(current, { messageID: 'm72', viewportOffset: -391.5 })).toBe(current);
    const consumed = consumePositionRowLease(current, lease);
    const updated = updateHistoryAnchor(consumed, {
      messageID: 'm72', viewportOffset: -391.5,
    });
    expect(updated.historyAnchor).toMatchObject({
      messageID: 'm72', viewportOffset: -391.5,
      inputEpoch: current.inputEpoch, intentRevision: current.intentRevision,
    });
    expect(updateHistoryAnchor(updated, null)).toBe(updated);
  });

  it('does not arm content restoration in following and native input revokes browsing capture', () => {
    const following = session();
    expect(captureContentAnchor(following, {
      anchorID: 'tail:body', viewportOffset: 20, beforeScrollHeight: 400,
    })).toBe(following);
    let browsing = takeReadingControl(following, { direction: 'older', gestureID: 'fold' });
    browsing = captureContentAnchor(browsing, {
      anchorID: 'turn:body', viewportOffset: 20, beforeScrollHeight: 400,
    });
    browsing = takeReadingControl(browsing, { direction: 'older', gestureID: 'wheel' });
    expect(browsing.contentAnchor).toBeNull();
    expect(contentAnchorCommand(browsing)).toBeNull();

    browsing = takeReadingControl(following, {
      direction: 'newer', gestureID: 'tail', geometryRevision: 3,
    });
    browsing = captureContentAnchor(browsing, {
      anchorID: 'turn:body', viewportOffset: 20, beforeScrollHeight: 400,
    });
    browsing = observeReading(browsing, {
      activationID: browsing.activationID,
      atTail: true,
      source: 'user',
      inputEpoch: browsing.inputEpoch,
      geometryRevision: 3,
    });
    expect(browsing.mode).toBe(READING_MODE.following);
    expect(browsing.contentAnchor).toBeNull();
  });

  it('consumes the one bottom intent only in its activation and input epoch', () => {
    const requested = requestLatest(session(), 'latest', {
      afterPresentationRevision: 41,
      baselineTailID: 'm41',
    });
    expect(requested.bottomIntent).toMatchObject({
      afterPresentationRevision: 41,
      baselineTailID: 'm41',
    });
    expect(consumeLatestIntent(requested, {
      ...requested.bottomIntent,
      activationID: 'stale',
    })).toBe(requested);
    const consumed = consumeLatestIntent(requested, {
      ...requested.bottomIntent,
      activationID: 'a1',
    });
    expect(consumed.bottomIntent.id).toBe('');
    expect(consumed.mode).toBe(READING_MODE.following);
  });

  it('binds durable message identities without issuing a second bottom intent', () => {
    const requested = requestLatest(session(), 'composer:send-start:one', {
      afterPresentationRevision: 8,
    });
    const correlated = bindLatestIntentTargets(requested, {
      activationID: requested.activationID,
      inputEpoch: requested.inputEpoch,
      intentRevision: requested.intentRevision,
    }, ['message-1']);
    expect(correlated.intentRevision).toBe(requested.intentRevision);
    expect(correlated.bottomIntent).toMatchObject({
      id: requested.bottomIntent.id,
      targetMessageIDs: ['message-1'],
    });
  });

  it('only current downward user evidence can resume following', () => {
    let current = takeReadingControl(session(), { direction: 'older', gestureID: 'up' });
    current = observeReading(current, {
      activationID: 'a1', atTail: true, source: 'user', inputEpoch: current.inputEpoch,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
    current = takeReadingControl(current, { direction: 'newer', gestureID: 'down' });
    current = observeReading(current, {
      activationID: 'a1', atTail: true, source: 'user', inputEpoch: current.inputEpoch,
    });
    expect(current.mode).toBe(READING_MODE.following);
  });

  it('updates direction evidence inside one input epoch and cancellation revokes it', () => {
    const started = takeReadingControl(session(), {
      direction: 'older', gestureID: 'gesture:one', geometryRevision: 3,
    });
    const reversed = updateReadingControl(started, {
      inputEpoch: started.inputEpoch,
      direction: 'newer',
      gestureID: 'gesture:one',
      geometryRevision: 4,
    });
    expect(reversed.inputEpoch).toBe(started.inputEpoch);
    expect(reversed.tailEvidence).toMatchObject({
      direction: 'newer', gestureID: 'gesture:one', geometryRevision: 4,
    });
    const olderAgain = updateReadingControl(reversed, {
      inputEpoch: started.inputEpoch,
      direction: 'older',
      gestureID: 'gesture:one',
      geometryRevision: 4,
    });
    expect(olderAgain.inputEpoch).toBe(started.inputEpoch);
    expect(olderAgain.tailEvidence).toBeNull();

    const downward = updateReadingControl(olderAgain, {
      inputEpoch: started.inputEpoch,
      direction: 'newer',
      gestureID: 'gesture:one',
      geometryRevision: 5,
    });
    const cancelled = cancelReadingControl(downward, {
      inputEpoch: started.inputEpoch,
      gestureID: 'gesture:one',
    });
    expect(cancelled.tailEvidence).toBeNull();
    const staleObservation = observeReading(cancelled, {
      activationID: 'a1', atTail: true, source: 'user',
      inputEpoch: started.inputEpoch, geometryRevision: 5,
    });
    expect(staleObservation.mode).toBe(READING_MODE.browsing);
  });

  it('does not reinterpret a later layout clamp as downward user evidence', () => {
    let current = takeReadingControl(session(), {
      direction: 'newer', gestureID: 'down', geometryRevision: 4,
    });
    current = observeReading(current, {
      activationID: 'a1', atTail: true, source: 'layout',
      inputEpoch: current.inputEpoch, geometryRevision: 5,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
    current = observeReading(current, {
      activationID: 'a1', atTail: true, source: 'user',
      inputEpoch: current.inputEpoch, geometryRevision: 5,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
  });

  it('records the actually visible row at lifecycle handoff without granting following', () => {
    const current = session({ mode: READING_MODE.browsing, bookmark: { messageID: 'm4', rowViewportOffset: -40 } });
    const handedOff = observeReading(current, {
      activationID: 'a1', atTail: true, source: 'lifecycle',
      bookmark: { messageID: 'm7', rowViewportOffset: -12 },
      inputEpoch: current.inputEpoch, geometryRevision: 5,
    });
    expect(handedOff.mode).toBe(READING_MODE.browsing);
    expect(handedOff.bookmark).toMatchObject({ messageID: 'm7', rowViewportOffset: -12 });
  });
});
