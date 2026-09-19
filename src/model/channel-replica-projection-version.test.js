import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from './channel-replica.js';
import { createChannelFeedRuntime } from './channel-feed-runtime.js';
import {
  CONVERSATION_SCOPE,
  createConversationPresentation,
  selectTimelineItems,
} from './conversation-presentation.js';

// Successor coverage for the old foldable-body revision oracle. The deleted
// fold store's separate `_timelineControlVersion` distinction is an
// implementation fingerprint, not a current public contract: a unique
// canonical processing frame changes visible content and must advance the
// current Presentation snapshot. The user-facing efficiency invariant is
// narrower and remains testable here: duplicate delivery and a historical
// flat payload must not advance the canonical projection clock.
function request(id = 'r1') {
  return {
    id,
    kind: 'request',
    type: 'agent.ask',
    sender: { id: 'me', kind: 'human' },
    audience: ['agent'],
    payload: { body: { text: 'x' } },
  };
}

function flatEvent(id = 'flat') {
  return {
    id,
    kind: 'event',
    type: 'message',
    sender: { id: 'agent', kind: 'agent' },
    audience: ['me'],
    payload: { text: 'historical flat row' },
  };
}

function project(presentation, state) {
  const selection = selectTimelineItems(state, {
    scope: CONVERSATION_SCOPE.all,
    selfId: 'me',
  });
  const candidate = presentation.evaluate(selection.items, {
    epoch: 'generation:1',
    nextViewID: 'c0:all',
    sourceRevision: state._timelineRevision,
    sourceChangeBase: state._timelineChangeBase,
    sourceChanges: state._timelineChangeLog,
  });
  expect(presentation.commitCandidate(candidate)).toBe(true);
  return candidate.snapshot;
}

function runtimeForTest() {
  const runtime = createChannelFeedRuntime();
  const ownerToken = Object.freeze({ test: 'projection-version' });
  runtime.bind({ ownerToken });
  runtime.mount();
  return { runtime, owner: runtime.getOwnerSnapshot(ownerToken) };
}

describe('channel-replica projection/control version granularity', () => {
  it('duplicate and non-canonical ingress do not advance canonical projection revision', () => {
    const { runtime, owner } = runtimeForTest();
    owner.enqueue({ channel_id: 'c0', seq: 1, source: 'live', envelope: request() });
    const state = runtime.getSnapshot().stateFor('c0');
    const presentation = createConversationPresentation();
    const before = project(presentation, state);
    const beforeDurableRevision = runtime.getSnapshot().revisionFor('c0');
    const beforePublicProjectionRevision = runtime.getSnapshot().historyFor('c0').presentationRevision;
    const beforeTimelineRevision = state._timelineRevision;
    const beforeProjectionVersion = state._timelineProjectionVersion;

    owner.enqueue({ channel_id: 'c0', seq: 2, source: 'live', envelope: flatEvent() });
    expect(runtime.getSnapshot().revisionFor('c0')).toBe(beforeDurableRevision + 1);
    expect(runtime.getSnapshot().historyFor('c0').presentationRevision).toBe(beforePublicProjectionRevision);
    expect(state._timelineRevision).toBe(beforeTimelineRevision);
    expect(state._timelineProjectionVersion).toBe(beforeProjectionVersion);
    expect(project(presentation, state).revision).toBe(before.revision);

    owner.enqueue({ channel_id: 'c0', seq: 2, source: 'live', envelope: flatEvent() });
    expect(runtime.getSnapshot().revisionFor('c0')).toBe(beforeDurableRevision + 1);
    expect(runtime.getSnapshot().historyFor('c0').presentationRevision).toBe(beforePublicProjectionRevision);
    expect(state._timelineRevision).toBe(beforeTimelineRevision);
    expect(state._timelineProjectionVersion).toBe(beforeProjectionVersion);
    runtime.destroy();
  });

  it('advances the canonical Presentation revision for a unique visible content fact', () => {
    const { runtime, owner } = runtimeForTest();
    owner.enqueue({ channel_id: 'c0', seq: 1, source: 'live', envelope: request() });
    const state = runtime.getSnapshot().stateFor('c0');
    const presentation = createConversationPresentation();
    const before = project(presentation, state);
    const beforeTimelineRevision = state._timelineRevision;
    owner.enqueue({ channel_id: 'c0', seq: 2, source: 'live', envelope: {
      id: 'p1', parent_id: 'r1', kind: 'response', type: 'agent.ask', sender: { id: 'agent' },
      payload: { body: { status: 'processing', process: { kind: 'stage', stage: 'text', text: 'first' } } },
    } });
    expect(state._timelineRevision).toBe(beforeTimelineRevision + 1);
    expect(project(presentation, state).revision).toBe(before.revision + 1);
    expect(runtime.getSnapshot().historyFor('c0').presentationRevision).toBe(beforeTimelineRevision + 1);
    runtime.destroy();
  });

  it('does not advance the canonical clock when trim only evicts flat transport rows', () => {
    const replica = createChannelReplicaStore();
    for (let seq = 1; seq <= 3; seq += 1) {
      expect(replica.commit({ channel_id: 'c0', seq, envelope: flatEvent(`flat-${seq}`) }).accepted).toBe(true);
    }
    const state = replica.state('c0');
    expect(state._timelineRevision).toBe(0);
    expect(replica.trim('c0', 1)).toBe(2);
    expect(replica.revision('c0')).toBe(4);
    expect(state._timelineRevision).toBe(0);
    expect(state._timelineProjectionVersion).toBe(0);
  });
});
