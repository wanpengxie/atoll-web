// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import {
  bindLatestIntentTargets,
  consumeLatestIntent,
  createReadingSession,
  observeReading,
  READING_MODE,
  requestLatest,
  resolveReadingBookmark,
  takeReadingControl,
  updateReadingControl,
} from '../src/model/reading-session.js';
import { createConversationPresentation } from '../src/model/conversation-presentation.js';
import { createHistoryPresentationAdmission } from '../src/model/history-presentation-admission.js';
import { createReadingNavigationCoordinator } from '../src/ui/timeline/reading-navigation-coordinator.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function message(id, seq, text = id) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      kind: 'event',
      type: 'human.note',
      sender: { id: 'human:root:1', kind: 'human' },
      payload: { body: { text } },
    },
  };
}

function publish(owner, entries, options) {
  const candidate = owner.evaluate(entries, options);
  expect(owner.commitCandidate(candidate)).toBe(true);
  return candidate.snapshot;
}

function reading(saved = {}, activationID = 'activation:a') {
  return createReadingSession({ key: 'c0:all', activationID, saved });
}

function item(id, seq) {
  return message(id, seq);
}

function admissionToken(overrides = {}) {
  return {
    activationID: 'activation:a',
    inputEpoch: 2,
    operationID: 'history:activation:a:1',
    viewID: 'c0:all',
    epoch: 'replica:7',
    baselineIDs: ['b'],
    demandUnits: 1,
    ...overrides,
  };
}

function admissionMeta(sourceRevision, overrides = {}) {
  return {
    operationID: 'history:activation:a:1',
    viewID: 'c0:all',
    epoch: 'replica:7',
    sourceRevision,
    ...overrides,
  };
}

function commitAdmission(owner, channelID, entries, meta) {
  const candidate = owner.evaluate(channelID, entries, meta);
  expect(owner.commitCandidate(channelID, candidate)).toBe(true);
  return candidate.items;
}

describe('current reading/presentation lifecycle ownership', () => {
  it('starts a fresh following activation without restoring an old browsing position', () => {
    const saved = reading({ mode: READING_MODE.browsing, bookmark: { messageID: 'old', rowViewportOffset: -20 } });
    expect(saved.mode).toBe(READING_MODE.browsing);
    const fresh = reading({}, 'activation:fresh');
    expect(fresh.mode).toBe(READING_MODE.following);
    expect(fresh.bookmark).toBeNull();
    expect(fresh).not.toHaveProperty('navigation');
  });

  it('resolves exact bookmarks first and drops row-local offsets after replacement', () => {
    const rows = [item('older', 8), item('current', 9), item('newer', 10)].map((entry) => ({
      id: entry.envelope.id,
      seqLow: entry.seq,
    }));
    expect(resolveReadingBookmark(rows, {
      messageID: 'current', rowViewportOffset: -32, textOffset: 4,
    })).toEqual({ index: 1, messageID: 'current', rowViewportOffset: -32, exact: true });
    expect(resolveReadingBookmark(rows, {
      messageID: 'removed', successorID: 'newer', rowViewportOffset: -32,
    })).toEqual({ index: 2, messageID: 'newer', rowViewportOffset: null, exact: false });
    expect(resolveReadingBookmark(rows, {
      messageID: 'removed', predecessorID: 'older', rowViewportOffset: -32,
    })).toEqual({ index: 0, messageID: 'older', rowViewportOffset: null, exact: false });
  });

  it('does not turn layout or lifecycle observations into following authority', () => {
    let current = takeReadingControl(reading(), { direction: 'older', gestureID: 'up', geometryRevision: 3 });
    current = observeReading(current, {
      activationID: current.activationID,
      atTail: true,
      source: 'layout',
      inputEpoch: current.inputEpoch,
      geometryRevision: 4,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
    current = observeReading(current, {
      activationID: current.activationID,
      atTail: true,
      source: 'lifecycle',
      inputEpoch: current.inputEpoch,
      geometryRevision: 4,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
  });

  it('requires the current downward user epoch and geometry before resuming following', () => {
    let current = takeReadingControl(reading(), { direction: 'newer', gestureID: 'down', geometryRevision: 4 });
    current = observeReading(current, {
      activationID: current.activationID,
      atTail: true,
      source: 'layout',
      inputEpoch: current.inputEpoch,
      geometryRevision: 5,
    });
    expect(current.mode).toBe(READING_MODE.browsing);
    current = observeReading(current, {
      activationID: current.activationID,
      atTail: true,
      source: 'user',
      inputEpoch: current.inputEpoch,
      geometryRevision: 5,
    });
    expect(current.mode).toBe(READING_MODE.browsing);

    current = updateReadingControl(current, {
      inputEpoch: current.inputEpoch,
      direction: 'newer',
      gestureID: 'down',
      geometryRevision: 5,
    });
    current = observeReading(current, {
      activationID: current.activationID,
      atTail: true,
      source: 'user',
      inputEpoch: current.inputEpoch,
      geometryRevision: 5,
    });
    expect(current.mode).toBe(READING_MODE.following);
  });

  it('binds one explicit latest intent to durable targets and consumes it once', () => {
    let current = requestLatest(reading(), 'send:one', {
      afterPresentationRevision: 12,
      baselineTailID: 'tail:12',
    });
    const intentRevision = current.intentRevision;
    current = bindLatestIntentTargets(current, {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision,
    }, ['echo:one', 'echo:one']);
    expect(current.bottomIntent.targetMessageIDs).toEqual(['echo:one']);
    expect(consumeLatestIntent(current, {
      id: 'send:one', inputEpoch: current.inputEpoch, activationID: 'stale',
    })).toBe(current);
    const consumed = consumeLatestIntent(current, {
      id: 'send:one', inputEpoch: current.inputEpoch, activationID: current.activationID,
    });
    expect(consumed.bottomIntent.id).toBe('');
    expect(consumed.mode).toBe(READING_MODE.following);
  });

  it('coalesces native navigation input and rejects a replacement host', () => {
    vi.useFakeTimers();
    const events = [];
    const coordinator = createReadingNavigationCoordinator({
      activationID: 'activation:a',
      onBegin: () => ({ inputGeneration: 4 }),
      onUpdate: (_transaction, reason) => events.push(['update', reason]),
      onEnd: (_transaction, reason) => events.push(['end', reason]),
    });
    coordinator.recordInput({ source: 'wheel', hostRole: 'browsing', hostToken: 1, direction: 'older' });
    expect(coordinator.recordScroll({ hostRole: 'browsing', hostToken: 2, direction: 'older' })).toBeNull();
    expect(coordinator.recordScroll({ hostRole: 'browsing', hostToken: 1, direction: 'older' })).toMatchObject({ inputGeneration: 4 });
    coordinator.recordScrollEnd({ hostRole: 'browsing', hostToken: 1 });
    expect(events).toContainEqual(['end', 'native-scrollend']);
  });

  it('keeps a navigation transaction from an old activation from publishing after replacement', () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const ended = vi.fn();
    const coordinator = createReadingNavigationCoordinator({
      activationID: 'activation:a',
      onCancel: cancelled,
      onEnd: ended,
    });
    coordinator.recordInput({ source: 'wheel', hostRole: 'following', direction: 'older' });
    expect(coordinator.replaceActivation('activation:b')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ activationID: 'activation:a' }), 'activation-replaced');
    expect(ended).not.toHaveBeenCalled();
  });

  it('publishes prepend coordinates atomically and retains unchanged row identity', () => {
    const presentation = createConversationPresentation();
    const base = publish(presentation, [item('b', 2), item('c', 3)], {
      nextViewID: 'c0:all', epoch: 'replica:7', sourceRevision: 1,
    });
    const next = publish(presentation, [item('a', 1), item('b', 2), item('c', 3)], {
      nextViewID: 'c0:all', epoch: 'replica:7', sourceRevision: 2,
    });
    expect(next.changes).toMatchObject({ kind: 'prepend', prefixCount: 1, frontInsertedIDs: ['a'] });
    expect(next.firstItemIndex).toBe(base.firstItemIndex - 1);
    expect(next.entities.get('b')).toBe(base.entities.get('b'));
  });

  it('keeps visual slots stable only for reciprocal replacements in the same view epoch', () => {
    const presentation = createConversationPresentation();
    const old = {
      kind: 'turn',
      seq: 2,
      turn: {
        requestId: 'old', requestSeq: 2, request: {
          id: 'old', type: 'project.task', ts: 2_000, sender: { id: 'human:root:1' }, audience: ['agent:a'], payload: { body: {} },
        },
        terminalSeq: 3, terminal: {
          id: 'old:terminal', seq: 3, parent_id: 'old', type: 'project.task', sender: { id: 'agent:a' }, payload: { body: { status: 'completed', replaced_by: 'new' } },
        },
      },
      thread: [],
    };
    publish(presentation, [message('before', 1), old, message('after', 4)], {
      nextViewID: 'c0:all', epoch: 'replica:7', sourceRevision: 4,
    });
    const replacement = {
      kind: 'turn',
      seq: 5,
      turn: {
        requestId: 'new', requestSeq: 5, request: {
          id: 'new', type: 'agent.replace', ts: 5_000, sender: { id: 'human:root:1' }, audience: ['agent:a'], payload: { body: { target: 'old' } },
        },
        terminal: null,
      },
      thread: [],
    };
    const next = publish(presentation, [message('before', 1), replacement, message('after', 4)], {
      nextViewID: 'c0:all', epoch: 'replica:7', sourceRevision: 5,
    });
    expect(next.entities.get('new')).toMatchObject({ visualSlotID: 'old' });
    const rebased = createConversationPresentation();
    expect(publish(rebased, [replacement], {
      nextViewID: 'c0:all', epoch: 'replica:8', sourceRevision: 6,
    }).entities.get('new').visualSlotID).toBe('new');
  });

  it('keeps presentation snapshots detached from mutable source entries', () => {
    const presentation = createConversationPresentation();
    const source = message('detached', 1, 'before');
    const snapshot = publish(presentation, [source], {
      nextViewID: 'c0:all', epoch: 'replica:7', sourceRevision: 1,
    });
    source.envelope.payload.body.text = 'after';
    expect(snapshot.entities.get('detached').body.envelope.payload.body.text).toBe('before');
    expect(Object.isFrozen(snapshot.entities.get('detached').body)).toBe(true);
  });

  it('releases a history prefix only after the exact presentation and viewport owner commit', () => {
    const admission = createHistoryPresentationAdmission();
    const presentation = createConversationPresentation();
    const baseline = [item('b', 20)];
    const older = [item('a', 10), ...baseline];
    admission.begin('channel', admissionToken());
    expect(commitAdmission(admission, 'channel', baseline, admissionMeta(11))).toEqual(baseline);
    publish(presentation, baseline, { nextViewID: 'c0:all', epoch: 'replica:7', sourceRevision: 11 });
    expect(admission.observe('channel', older, admissionMeta(12))).toMatchObject({ stagedIDs: ['a'], fulfilled: true });
    const committed = admission.settle('channel');
    expect(committed.stagedIDs).toEqual(['a']);
    expect(commitAdmission(admission, 'channel', older, admissionMeta(12))).toEqual(baseline);
    const baselineSnapshot = presentation.current();
    expect(admission.prepareCommit('channel', baselineSnapshot)).toBe(true);
    const candidate = admission.evaluate('channel', older, admissionMeta(12));
    expect(candidate.items.map((entry) => entry.envelope.id)).toEqual(['a', 'b']);
    expect(admission.validatePresentation('channel', candidate, {
      ...publish(presentation, older, { nextViewID: 'c0:all', epoch: 'replica:7', sourceRevision: 12 }),
      changes: { kind: 'prepend', frontInsertedIDs: ['a'], backInsertedIDs: [], updated: [], removed: [] },
    }, {
      activationID: 'activation:a', inputEpoch: 2, viewID: 'c0:all', epoch: 'replica:7',
    })).toMatchObject({ accepted: true });
  });

  it('rejects stale history callbacks after view or input ownership changes', () => {
    const admission = createHistoryPresentationAdmission();
    const baseline = [item('b', 20)];
    admission.begin('channel', admissionToken());
    commitAdmission(admission, 'channel', baseline, admissionMeta(11));
    admission.observe('channel', [item('a', 10), ...baseline], admissionMeta(12));
    admission.settle('channel');
    expect(admission.reconcileCurrent('channel', { viewID: 'c0:other', epoch: 'replica:7' })).toBe(true);
    expect(admission.snapshot('channel').phase).toBe('idle');

    admission.begin('channel', admissionToken({ operationID: 'history:activation:a:2' }));
    expect(admission.advanceInputEpoch('channel', {
      operationID: 'history:activation:a:2', activationID: 'activation:a', direction: 'newer', inputEpoch: 3, currentInputEpoch: 3,
    })).toBeNull();
    expect(admission.advanceInputEpoch('channel', {
      operationID: 'history:activation:a:2', activationID: 'activation:a', direction: 'older', inputEpoch: 3, currentInputEpoch: 3,
    })).toMatchObject({ fromInputEpoch: 2, toInputEpoch: 3 });
  });
});
