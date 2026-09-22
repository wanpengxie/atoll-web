import { describe, expect, it } from 'vitest';
import {
  bindLatestIntentTargets,
  consumeLatestIntent,
  createReadingSession,
  requestLatest,
  takeReadingControl,
} from '../src/model/reading-session.js';

const activationID = 'activation:round28';

function reading() {
  return createReadingSession({ key: 'c0:all', activationID });
}

describe('round 28 current Submission/Reading owner contracts', () => {
  it('[SZ-001] creates one explicit latest intent before a destination write', () => {
    const current = requestLatest(reading(), 'send:one', {
      afterPresentationRevision: 12,
      baselineTailID: 'tail:12',
    });

    expect(current.mode).toBe('following');
    expect(current.bottomIntent).toMatchObject({
      id: 'send:one',
      inputEpoch: 0,
      afterPresentationRevision: 12,
      baselineTailID: 'tail:12',
      targetMessageIDs: [],
    });
  });

  it('[SZ-002] binds a committed queued destination to the already-issued intent', () => {
    const current = requestLatest(reading(), 'send:queued', { baselineTailID: 'tail:queued' });
    const bound = bindLatestIntentTargets(current, {
      activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
    }, ['queued:echo']);

    expect(bound.bottomIntent).toMatchObject({
      id: 'send:queued',
      baselineTailID: 'tail:queued',
      targetMessageIDs: ['queued:echo'],
    });
  });

  it('[SZ-003] preserves every distinct target in a mixed destination batch', () => {
    const current = requestLatest(reading(), 'send:mixed');
    const bound = bindLatestIntentTargets(current, {
      activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
    }, ['human:echo', 'agent:echo', 'human:echo']);

    expect(bound.bottomIntent.targetMessageIDs).toEqual(['human:echo', 'agent:echo']);
  });

  it('[SZ-004] does not suppress a later same-id stream behind an older intent', () => {
    const first = requestLatest(reading(), 'send:same-id');
    const second = requestLatest(first, 'send:same-id');

    expect(second.intentRevision).toBe(first.intentRevision + 1);
    expect(second.bottomIntent.id).toBe('send:same-id');
    expect(second.bottomIntent).not.toBe(first.bottomIntent);
  });

  it('[SZ-005] ignores a stale acknowledgement after a newer intent revision', () => {
    const first = requestLatest(reading(), 'send:old');
    const second = requestLatest(first, 'send:new');
    const stale = consumeLatestIntent(second, {
      id: 'send:old',
      activationID,
      inputEpoch: second.inputEpoch,
    });

    expect(stale).toBe(second);
    expect(stale.bottomIntent.id).toBe('send:new');
  });

  it('[SZ-006] retains presentation revision and target identity as separate intent facts', () => {
    const current = requestLatest(reading(), 'send:metadata', {
      afterPresentationRevision: 22,
      targetMessageIDs: ['target:row'],
    });

    expect(current.bottomIntent).toMatchObject({
      afterPresentationRevision: 22,
      targetMessageIDs: ['target:row'],
    });
  });

  it('[SZ-009] accepts a Waiting destination at the captured baseline revision', () => {
    const current = requestLatest(reading(), 'send:waiting', {
      afterPresentationRevision: 9,
      baselineTailID: 'tail:baseline',
      targetMessageIDs: ['waiting:echo'],
    });

    expect(current.bottomIntent).toMatchObject({
      afterPresentationRevision: 9,
      baselineTailID: 'tail:baseline',
      targetMessageIDs: ['waiting:echo'],
    });
  });

  it('[SZ-010] clears the explicit send intent when the user takes over', () => {
    const current = requestLatest(reading(), 'send:takeover', {
      targetMessageIDs: ['target:row'],
    });
    const takenOver = takeReadingControl(current, {
      direction: 'older',
      gestureID: 'user:takeover',
      geometryRevision: 4,
    });

    expect(takenOver.bottomIntent.id).toBe('');
    expect(takenOver.mode).toBe('browsing');
  });
});
