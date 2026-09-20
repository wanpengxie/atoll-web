// @vitest-environment jsdom
// Round-12–14 exact-path recovery for the five I-M baseline files that the
// global static ledger still reports as `absent target path`. These tests are
// deliberately public-owner contracts: no deleted adapter, private helper, or
// production state map is imported.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createChannelReplicaStore,
} from '../src/model/channel-replica.js';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import {
  CONVERSATION_SCOPE,
  createConversationPresentation,
  selectTimelineItems,
} from '../src/model/conversation-presentation.js';
import { isStandardActorIdentity, isVisibleActor } from '../src/model/actor-visibility.js';
import { acknowledgeLivePresentationArrivals } from '../src/model/live-arrivals.js';
import { isRailNotifiableDisposition, notificationDisposition } from '../src/model/notification-policy.js';
import {
  bindLatestIntentTargets,
  consumeLatestIntent,
  createReadingSession,
  observeReading,
  READING_MODE,
  requestLatest,
  resolveReadingBookmark,
  takeReadingControl,
} from '../src/model/reading-session.js';
import {
  SYSTEM_ACTOR_ID,
  SYSTEM_DECL_IDS,
  TYPES,
} from '../src/protocol/vocab.js';
import { createReadingNavigationCoordinator } from '../src/ui/timeline/reading-navigation-coordinator.js';
import { MarkdownContent } from '../src/ui/MarkdownContent.jsx';
import {
  buildComposerModel,
  createComposerCommandRequest,
  parseComposerCommand,
} from '../src/ui/composer/composer-model.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';
import { projectAgentParameters } from '../src/ui/composer/agent-parameters.js';
import { normalizeMathMarkdown } from '../src/model/math-markdown.js';
import { validatePayload } from '../mock/protocol.mjs';

afterEach(cleanup);

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = 'agent:steward:1';

function envelope(seq, {
  id = `event-${seq}`,
  kind = 'event',
  type = 'human.note',
  sender = SELF,
  audience = [],
  parentId = '',
  body = { text: String(seq) },
} = {}) {
  return {
    channel_id: CHANNEL,
    seq,
    envelope: {
      id,
      kind,
      type,
      sender: { id: sender, kind: sender.startsWith('human:') ? 'human' : 'agent' },
      audience,
      ...(parentId ? { parent_id: parentId, correlation_id: parentId } : {}),
      payload: { body },
    },
  };
}

function flatEnvelope(seq, options = {}) {
  const row = envelope(seq, options);
  return {
    ...row,
    envelope: { ...row.envelope, payload: options.body },
  };
}

function request(seq, id) {
  return envelope(seq, {
    id,
    kind: 'request',
    type: 'agent.ask',
    audience: [AGENT],
    body: { text: id },
  });
}

function terminal(seq, id, status = 'completed', text = 'done') {
  return envelope(seq, {
    id: `${id}-terminal-${seq}`,
    kind: 'response',
    type: 'agent.ask',
    sender: AGENT,
    audience: [SELF],
    parentId: id,
    body: { status, text },
  });
}

function note(seq) {
  return envelope(seq, { id: `note-${seq}` });
}

function progress(seq, requestId, text = 'still working') {
  return envelope(seq, {
    id: `${requestId}-progress-${seq}`,
    kind: 'response',
    type: 'agent.ask',
    sender: AGENT,
    audience: [SELF],
    parentId: requestId,
    body: { status: 'processing', text },
  });
}

function completedTurn({ requestId, actorId, type, value }) {
  return {
    kind: 'turn',
    turn: {
      requestId,
      request: { id: requestId, type, audience: [actorId] },
      terminal: {
        kind: 'response',
        type,
        parent_id: requestId,
        sender: { id: actorId },
        payload: { body: { status: 'completed', value } },
      },
    },
  };
}

const OPTIONS_VALUE = {
  models: [
    { value: 'gpt-5.6-sol', label: '5.6 Sol', efforts: [{ value: 'medium', label: '中等' }] },
    { value: 'gpt-5.4', label: '5.4', efforts: [{ value: 'light', label: '轻量' }] },
  ],
};

function optionsState(actorId = 'steward') {
  return { timeline: [completedTurn({
    requestId: 'options', actorId, type: 'agent.options', value: OPTIONS_VALUE,
  })] };
}

function currentAgentSelection(actorId = 'steward') {
  const { view } = projectAgentParameters({
    state: optionsState(actorId),
    actorId,
    requestKeys: { options: 'options' },
  });
  const agent = { id: actorId, kind: 'agent', name: actorId === 'steward' ? 'Steward' : 'Other' };
  return { target: { kind: 'single', agent }, view };
}

function currentAgentSelectionWithUsage(actorId = 'steward') {
  const { view } = projectAgentParameters({
    state: {
      timeline: [
        ...optionsState(actorId).timeline,
        completedTurn({
          requestId: 'context', actorId, type: 'agent.context',
          value: { model: 'gpt-5.6-sol', effort: 'medium', context_tokens: 42_000, context_window: 200_000 },
        }),
      ],
    },
    actorId,
    requestKeys: { options: 'options', context: 'context' },
  });
  const agent = { id: actorId, kind: 'agent', name: actorId === 'steward' ? 'Steward' : 'Other' };
  return { target: { kind: 'single', agent }, view };
}

function messageRow(type, body) {
  const envelopeValue = {
    id: 'message',
    kind: 'request',
    type,
    sender: { id: SELF, kind: 'human' },
    audience: [AGENT],
    payload: { body },
  };
  return {
    id: 'message',
    seqLow: 1,
    seqHigh: 1,
    contentRevision: 1,
    visualSlotID: 'message',
    body: { kind: 'standalone', envelope: envelopeValue },
  };
}

function MessageHarness({ row }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: CHANNEL, narration: [] },
    names: new Map([[SELF, 'Root'], [AGENT, 'Steward']]),
    selfId: SELF,
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow(row);
}

function presentationEntry(id, seq, text = id) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      kind: 'event',
      type: 'human.note',
      sender: { id: SELF, kind: 'human' },
      payload: { body: { text } },
    },
  };
}

function readingSession(saved = {}, activationID = 'activation:round-13') {
  return createReadingSession({ key: `${CHANNEL}:all`, activationID, saved });
}

function liveCheckpointOptions() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: CHANNEL },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
  };
}

describe('I-M exact-path public-owner recovery (round 12)', () => {
  it('management-actors: routes /members through the channel system actor', () => {
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '/members', recipients: [] },
      roster: [{ id: AGENT, kind: 'agent', name: 'Steward' }],
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent: { id: AGENT, kind: 'agent' } } },
    });
    const requestValue = createComposerCommandRequest(model, parseComposerCommand('/members'));
    expect(requestValue).toMatchObject({
      channelId: CHANNEL,
      msgType: TYPES.member.list,
      audience: [SYSTEM_ACTOR_ID],
      targetLabel: SYSTEM_ACTOR_ID,
    });
  });

  it('memory-window: clamps trim at the oldest open request and keeps its progress', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'open-work'), SELF);
    store.commit(envelope(2, {
      id: 'open-progress',
      kind: 'response',
      type: 'agent.ask',
      sender: AGENT,
      audience: [SELF],
      parentId: 'open-work',
      body: { status: 'processing', text: 'still working' },
    }), SELF);
    for (let seq = 3; seq <= 12; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBe(0);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'open-work')?.turn;
    expect(turn).toMatchObject({ requestId: 'open-work', status: 'pending', terminal: null });
    expect(turn.provisional.map((item) => item.envelope.id)).toEqual(['open-progress']);
  });

  it('memory-window: response-first terminal upgrades only after the exact full row returns', () => {
    const store = createChannelReplicaStore();
    const final = terminal(2, 'response-first');
    store.commit(final, SELF);
    for (let seq = 3; seq <= 10; seq += 1) store.commit(note(seq), SELF);
    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);

    store.commit(request(1, 'response-first'), SELF);
    const compactTurn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'response-first')?.turn;
    expect(compactTurn).toMatchObject({ status: 'completed', terminalClosureOnly: true });

    store.commit(final, SELF);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'response-first')?.turn;
    expect(turn).toMatchObject({ status: 'completed', terminalClosureOnly: false });
    expect(turn.terminal.id).toBe(final.envelope.id);
  });

  it('memory-window: identical request ids remain isolated between channel records', () => {
    const store = createChannelReplicaStore();
    expect(store.commit({ ...request(1, 'same-id'), channel_id: 'closed' }, SELF).accepted).toBe(true);
    expect(store.commit({ ...request(1, 'same-id'), channel_id: 'open' }, SELF).accepted).toBe(true);
    expect(store.state('closed').timeline[0].turn.requestId).toBe('same-id');
    expect(store.state('open').timeline[0].turn.requestId).toBe('same-id');
    expect(store.state('closed').rows).not.toBe(store.state('open').rows);
  });

  it('message-presentation: canonical body text wins over a system-operation label', () => {
    render(<MessageHarness row={messageRow(TYPES.member.create, {
      text: '用户正文', decl_id: 'demo:agent',
    })} />);
    expect(screen.getByText('用户正文')).toBeTruthy();
    expect(screen.queryByText('添加参与者：demo:agent')).toBeNull();
  });

  it('model-selector: canonical options project a null ledger current without inventing a choice', () => {
    const { view } = projectAgentParameters({
      state: optionsState(),
      actorId: 'steward',
      requestKeys: { options: 'options' },
    });
    expect(view.models.map((model) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-5.4']);
    expect(view.current).toBeNull();
  });

  it('model-selector: changing target closes the public Composer selector', async () => {
    const user = userEvent.setup();
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const steward = currentAgentSelection('steward');
    const other = currentAgentSelection('other');
    const roster = [steward.target.agent, other.target.agent];
    const model = (agentSelection, draft = { text: '', recipients: [] }) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft,
      roster,
      access: 'member_active',
      agentSelection,
    });
    const { rerender } = render(<Composer model={model(steward)} commands={commands} />);
    await user.click(screen.getByRole('button', { name: 'Steward，模型未知' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    rerender(<Composer model={model(other, { text: '', recipients: [other.target.agent] })} commands={commands} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('message-list-lifecycle: immutable Presentation detaches visible rows from later source mutation', () => {
    const presentation = createConversationPresentation();
    const source = {
      kind: 'standalone',
      seq: 1,
      envelope: {
        id: 'detached',
        kind: 'event',
        type: 'human.note',
        sender: { id: SELF, kind: 'human' },
        payload: { body: { text: 'before' } },
      },
    };
    const candidate = presentation.evaluate([source], {
      nextViewID: `${CHANNEL}:all`, epoch: 'replica:1', sourceRevision: 1,
    });
    expect(presentation.commitCandidate(candidate)).toBe(true);
    source.envelope.payload.body.text = 'after';
    expect(candidate.snapshot.rows[0].body.envelope.payload.body.text).toBe('before');
  });
});

describe('I-M exact-path public-owner recovery (round 13)', () => {
  it('message-list-lifecycle TC-0976: prepending one committed row decrements the data origin once', () => {
    const presentation = createConversationPresentation();
    const baseCandidate = presentation.evaluate([
      presentationEntry('middle', 2),
      presentationEntry('tail', 3),
    ], {
      nextViewID: `${CHANNEL}:all`, epoch: 'replica:13', sourceRevision: 1,
    });
    expect(presentation.commitCandidate(baseCandidate)).toBe(true);
    const base = presentation.current();

    const nextCandidate = presentation.evaluate([
      presentationEntry('head', 1),
      presentationEntry('middle', 2),
      presentationEntry('tail', 3),
    ], {
      nextViewID: `${CHANNEL}:all`, epoch: 'replica:13', sourceRevision: 2,
    });
    expect(presentation.commitCandidate(nextCandidate)).toBe(true);
    const next = presentation.current();

    expect(next.firstItemIndex).toBe(base.firstItemIndex - 1);
    expect(next.changes).toMatchObject({ kind: 'prepend', prefixCount: 1 });
  });

  it('message-list-lifecycle TC-0976: exact restore resolves against the data-relative row index', () => {
    const rows = [
      { id: 'head', seqLow: 1 },
      { id: 'target', seqLow: 2 },
      { id: 'tail', seqLow: 3 },
    ];

    expect(resolveReadingBookmark(rows, {
      messageID: 'target', rowViewportOffset: -24,
    })).toEqual({
      index: 1, messageID: 'target', rowViewportOffset: -24, exact: true,
    });
  });

  it('message-list-lifecycle TC-0980: stale activation observations cannot settle a late bookmark', () => {
    const current = readingSession({
      mode: READING_MODE.browsing,
      bookmark: { messageID: 'late-target', rowViewportOffset: -36 },
    }, 'activation:current');

    const stale = observeReading(current, {
      activationID: 'activation:old',
      atTail: true,
      source: 'user',
      inputEpoch: current.inputEpoch,
      geometryRevision: 1,
    });

    expect(stale).toBe(current);
    expect(stale.bookmark).toMatchObject({ messageID: 'late-target', rowViewportOffset: -36 });
  });

  it('message-list-lifecycle TC-0981: a provisional successor never inherits the exact row offset', () => {
    expect(resolveReadingBookmark([
      { id: 'successor', seqLow: 11 },
    ], {
      messageID: 'late-target',
      successorID: 'successor',
      rowViewportOffset: -36,
    })).toEqual({
      index: 0, messageID: 'successor', rowViewportOffset: null, exact: false,
    });
  });

  it('message-list-lifecycle TC-0981: a materialized exact target is the only row allowed to reuse its offset', () => {
    expect(resolveReadingBookmark([
      { id: 'late-target', seqLow: 12 },
    ], {
      messageID: 'late-target', rowViewportOffset: -36,
    })).toEqual({
      index: 0, messageID: 'late-target', rowViewportOffset: -36, exact: true,
    });
  });

  it('message-list-lifecycle TC-0996: a tail observation without current newer evidence keeps following', () => {
    const current = readingSession();
    const observed = observeReading(current, {
      activationID: current.activationID,
      atTail: true,
      source: 'user',
      inputEpoch: current.inputEpoch,
      geometryRevision: current.geometryRevision,
    });

    expect(observed.mode).toBe(READING_MODE.following);
    expect(observed).toBe(current);
  });

  it('message-list-lifecycle TC-0996: older input takes control of the following session', () => {
    const current = readingSession();
    const browsing = takeReadingControl(current, {
      direction: 'older', gestureID: 'up', geometryRevision: 2,
    });

    expect(browsing.mode).toBe(READING_MODE.browsing);
    expect(browsing.inputEpoch).toBe(current.inputEpoch + 1);
  });

  it('message-list-lifecycle TC-0997: selection-at-tail evidence never grants following authority', () => {
    const browsing = takeReadingControl(readingSession(), {
      direction: 'older', gestureID: 'selection-owner', geometryRevision: 2,
    });
    const observed = observeReading(browsing, {
      activationID: browsing.activationID,
      atTail: true,
      source: 'selection',
      inputEpoch: browsing.inputEpoch,
      geometryRevision: 2,
    });

    expect(observed.mode).toBe(READING_MODE.browsing);
  });

  it('message-list-lifecycle TC-0998: an explicit latest intent survives zero-geometry layout evidence', () => {
    const current = requestLatest(readingSession(), 'latest:zero-geometry', {
      afterPresentationRevision: 4,
      baselineTailID: 'tail:4',
    });
    const observed = observeReading(current, {
      activationID: current.activationID,
      atTail: false,
      source: 'layout',
      inputEpoch: current.inputEpoch,
      geometryRevision: 0,
    });

    expect(observed.bottomIntent).toMatchObject({
      id: 'latest:zero-geometry', afterPresentationRevision: 4, baselineTailID: 'tail:4',
    });
  });

  it('message-list-lifecycle TC-0999: a later layout revision does not consume explicit latest', () => {
    const current = requestLatest(readingSession(), 'latest:later-height', {
      afterPresentationRevision: 5,
      baselineTailID: 'tail:5',
    });
    const observed = observeReading(current, {
      activationID: current.activationID,
      atTail: false,
      source: 'layout',
      inputEpoch: current.inputEpoch,
      geometryRevision: 7,
    });

    expect(observed.geometryRevision).toBe(7);
    expect(observed.bottomIntent.id).toBe('latest:later-height');
  });

  it('message-list-lifecycle TC-1002: exact latest consumption clears the intent and rejects a second consume', () => {
    const current = requestLatest(readingSession(), 'latest:once');
    const consumed = consumeLatestIntent(current, {
      id: 'latest:once',
      inputEpoch: current.inputEpoch,
      activationID: current.activationID,
    });

    expect(consumed.bottomIntent.id).toBe('');
    expect(consumeLatestIntent(consumed, {
      id: 'latest:once',
      inputEpoch: current.inputEpoch,
      activationID: current.activationID,
    })).toBe(consumed);
  });

  it('message-list-lifecycle TC-1005: native input cancels a pending following intent before a height write', () => {
    const current = requestLatest(readingSession(), 'latest:cancelled');
    const browsing = takeReadingControl(current, {
      direction: 'older', gestureID: 'up-after-latest', geometryRevision: 8,
    });

    expect(browsing.mode).toBe(READING_MODE.browsing);
    expect(browsing.bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1009: consuming explicit latest leaves the session following at the real tail', () => {
    const browsing = takeReadingControl(readingSession(), {
      direction: 'older', gestureID: 'before-latest', geometryRevision: 3,
    });
    const current = requestLatest(browsing, 'latest:real-tail');
    const consumed = consumeLatestIntent(current, {
      id: 'latest:real-tail',
      inputEpoch: current.inputEpoch,
      activationID: current.activationID,
    });

    expect(consumed.mode).toBe(READING_MODE.following);
    expect(consumed.bottomIntent.id).toBe('');
  });

  it('message-list-lifecycle TC-1017: latest target binding de-duplicates durable echo identities', () => {
    const current = requestLatest(readingSession(), 'latest:target-bind');
    const bound = bindLatestIntentTargets(current, {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
    }, ['echo:one', 'echo:one', 'echo:two']);

    expect(bound.bottomIntent.targetMessageIDs).toEqual(['echo:one', 'echo:two']);
  });

  it('message-list-lifecycle TC-1017: stale activation cannot mutate a bound latest target set', () => {
    const current = requestLatest(readingSession(), 'latest:target-bind-stale');
    const bound = bindLatestIntentTargets(current, {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
    }, ['echo:one']);

    expect(bindLatestIntentTargets(bound, {
      activationID: 'activation:stale',
      inputEpoch: bound.inputEpoch,
      intentRevision: bound.intentRevision,
    }, ['echo:stale'])).toBe(bound);
  });

  it('message-list-lifecycle TC-1026: one wheel transaction settles once through the public scrollend owner', () => {
    vi.useFakeTimers();
    const events = [];
    const coordinator = createReadingNavigationCoordinator({
      activationID: 'activation:round-13',
      onBegin: () => ({ inputGeneration: 13 }),
      onEnd: (_transaction, reason) => events.push(reason),
    });

    coordinator.recordInput({
      source: 'wheel', hostRole: 'browsing', hostToken: 'host-13', direction: 'older',
    });
    coordinator.recordScroll({
      hostRole: 'browsing', hostToken: 'host-13', direction: 'older',
    });
    expect(coordinator.recordScrollEnd({
      hostRole: 'browsing', hostToken: 'host-13',
    })).toBe(true);
    vi.advanceTimersByTime(200);

    expect(events).toEqual(['native-scrollend']);
  });
});

describe('I-M exact-path public-owner recovery (round 14)', () => {
  it('memory-window TC-0936: trim removes only the oldest materialized rows and rebuilds public coverage', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 8; seq += 1) {
      expect(store.commit(note(seq), SELF).accepted).toBe(true);
    }

    expect(store.trim(CHANNEL, 4)).toBe(4);
    const state = store.state(CHANNEL);
    expect([...state.rows.keys()]).toEqual([5, 6, 7, 8]);
    expect(state.timeline.map((entry) => entry.envelope.id)).toEqual([
      'note-5', 'note-6', 'note-7', 'note-8',
    ]);
    expect(store.record(CHANNEL).materializedCoverage).toEqual([{ lowSeq: 5, highSeq: 8 }]);
  });

  it('memory-window TC-0937: a trim at or below the row limit is a no-op', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 4; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 8)).toBe(0);
    expect(store.trim(CHANNEL, 4)).toBe(0);
    expect([...store.state(CHANNEL).rows.keys()]).toEqual([1, 2, 3, 4]);
  });

  it('memory-window TC-0940: response-first closure chooses the earliest terminal by sequence', () => {
    const store = createChannelReplicaStore();
    store.commit(terminal(3, 'out-of-order'), SELF);
    store.commit(terminal(2, 'out-of-order', 'completed', 'earlier'), SELF);
    for (let seq = 4; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    store.commit(request(1, 'out-of-order'), SELF);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'out-of-order')?.turn;

    expect(turn).toMatchObject({
      requestId: 'out-of-order', status: 'completed', terminalSeq: 2, terminalClosureOnly: true,
    });
    expect(turn.terminal.id).toBe('out-of-order-terminal-2');
  });

  it('memory-window TC-0941: a retained matched closure keeps a stale queued row completed', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'closed-request'), SELF);
    store.commit(progress(2, 'closed-request'), SELF);
    store.commit(terminal(3, 'closed-request'), SELF);
    for (let seq = 4; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    store.commit(request(1, 'closed-request'), SELF);
    store.commit(progress(2, 'closed-request', 'stale queued work'), SELF);
    const turn = store.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'closed-request')?.turn;

    expect(turn).toMatchObject({
      requestId: 'closed-request', status: 'completed', terminalClosureOnly: true,
    });
    expect(turn.provisional.map((item) => item.envelope.id)).toContain('closed-request-progress-2');
  });

  it('memory-window TC-0946: unmatched provisional progress is evicted without creating a turn', () => {
    const store = createChannelReplicaStore();
    store.commit(progress(1, 'missing-request'), SELF);
    for (let seq = 2; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    expect(store.state(CHANNEL).rows.has(1)).toBe(false);
    expect(store.state(CHANNEL).timeline.some((entry) => entry.turn?.requestId === 'missing-request')).toBe(false);
  });

  it('memory-window TC-0947: a closed turn outside the window leaves no conversation row', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'old-request'), SELF);
    store.commit(terminal(2, 'old-request'), SELF);
    for (let seq = 3; seq <= 8; seq += 1) store.commit(note(seq), SELF);

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    const state = store.state(CHANNEL);
    expect(state.timeline.some((entry) => entry.turn?.requestId === 'old-request')).toBe(false);
    expect(selectTimelineItems(state, {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    }).items.some((entry) => entry.turn?.requestId === 'old-request')).toBe(false);
  });

  it('memory-window TC-0948: mine projection contains only the surviving public turns after trim', () => {
    const store = createChannelReplicaStore();
    store.commit(request(1, 'old-request'), SELF);
    store.commit(terminal(2, 'old-request'), SELF);
    store.commit(note(3), SELF);
    store.commit(note(4), SELF);
    store.commit(request(5, 'new-request'), SELF);
    store.commit(terminal(6, 'new-request'), SELF);
    store.commit(note(7), SELF);
    store.commit(note(8), SELF);

    store.trim(CHANNEL, 4);
    const state = store.state(CHANNEL);
    const mine = selectTimelineItems(state, {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });

    expect(mine.items.map((entry) => entry.turn?.requestId).filter(Boolean)).toEqual(['new-request']);
    expect(mine.items.some((entry) => entry.turn?.requestId === 'old-request')).toBe(false);
  });

  it('memory-window TC-0949: backfilled rows re-enter the public mine projection', () => {
    const store = createChannelReplicaStore();
    for (let index = 0; index < 6; index += 1) {
      const requestID = `q-${index}`;
      store.commit(request(index * 2 + 1, requestID), SELF);
      store.commit(terminal(index * 2 + 2, requestID), SELF);
    }

    store.trim(CHANNEL, 8);
    const before = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });
    expect(before.items.some((entry) => entry.turn?.requestId === 'q-0')).toBe(false);

    store.commit(request(1, 'q-0'), SELF);
    store.commit(terminal(2, 'q-0'), SELF);
    const after = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });
    expect(after.items.some((entry) => entry.turn?.requestId === 'q-0')).toBe(true);
  });

  it('management-actors TC-0924: genesis system declarations remain standard identities', () => {
    expect(SYSTEM_DECL_IDS).toEqual(['registrar', 'svcactor']);
    expect(isStandardActorIdentity({ id: 'registrar' })).toBe(true);
    expect(isStandardActorIdentity({ id: 'svcactor' })).toBe(true);
  });

  it('message-presentation TC-1031: the canonical body wrapper is read without surfacing context metadata', () => {
    const row = messageRow(TYPES.member.create, { decl_id: 'reviewer' });
    row.body.envelope.payload = {
      _context: { caller: { channel: CHANNEL, actor: SELF } },
      body: { decl_id: 'reviewer' },
    };
    render(<MessageHarness row={row} />);

    expect(screen.getByText('添加参与者：reviewer')).toBeTruthy();
    expect(screen.queryByText('human:root:1')).toBeNull();
  });

  it('model-selector TC-1060: canonical context truth overrides the available model catalog', () => {
    const selection = currentAgentSelectionWithUsage();
    expect(selection.view.models.map((model) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-5.4']);
    expect(selection.view.current).toEqual({ model: 'gpt-5.6-sol', effort: 'medium' });
  });

  it('model-selector TC-1062: the public projection accepts a capability oneOf catalog', () => {
    const capability = {
      describe: {
        types: new Map([[TYPES.agentSelect, {
          inputSchema: {
            oneOf: [
              { properties: {
                model: { const: 'gpt-5.6-sol', title: '5.6 Sol' },
                effort: { const: 'medium', title: '中等' },
              } },
              { properties: {
                model: { const: 'gpt-5.4', title: '5.4' },
                effort: { const: 'light', title: '轻量' },
              } },
            ],
          },
        }]]),
      },
    };
    const { view } = projectAgentParameters({
      state: { timeline: [] }, actorId: 'steward', requestKeys: {}, capability,
    });

    expect(view.selections.map((row) => `${row.model}:${row.effort}`)).toEqual([
      'gpt-5.6-sol:medium', 'gpt-5.4:light',
    ]);
  });

  it('model-selector TC-1063: changing model chooses its first legal effort when the old effort is absent', () => {
    const commands = { openAgentSelector: vi.fn(), setModelParameters: vi.fn() };
    const selection = currentAgentSelectionWithUsage();
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={commands} />);

    fireEvent.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '5.4' }));

    expect(commands.setModelParameters).toHaveBeenCalledWith({
      actorId: 'steward', model: 'gpt-5.4', effort: 'light',
    });
  });

  it('model-selector TC-1064: the public menu exposes only model and effort levels', () => {
    const selection = currentAgentSelectionWithUsage();
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    fireEvent.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    expect(screen.getByRole('menuitem', { name: /^模型/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^推理强度/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Provider' })).toBeNull();
  });

  it('model-selector TC-1065: pending model changes show the target and disable the selector entry', () => {
    const selection = {
      ...currentAgentSelectionWithUsage(),
      pending: {
        actorId: 'steward', state: 'pending',
        value: { model: 'gpt-5.4', effort: 'light' },
      },
    };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    const trigger = screen.getByRole('button', { name: /Steward，模型 5.4，推理强度 轻量，切换中/ });
    expect(trigger.disabled).toBe(true);
    expect(screen.getByText('切换中')).toBeTruthy();
  });

  it('model-selector TC-1066: current context usage is visible in the trigger and expanded panel', () => {
    const selection = currentAgentSelectionWithUsage();
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [selection.target.agent],
      access: 'member_active',
      agentSelection: selection,
    });
    render(<Composer model={model} commands={{ openAgentSelector: vi.fn() }} />);

    expect(screen.getByText('21%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Steward，模型 5.6 Sol/ }));
    expect(screen.getByLabelText('上下文用量 21%')).toBeTruthy();
    expect(screen.getByText('42K / 200K')).toBeTruthy();
  });

  it('model-selector TC-1067: multiple recipients expose a count without a single-agent settings entry', () => {
    const other = { id: 'other', kind: 'agent', name: 'Other' };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [
        { ...currentAgentSelection().target.agent }, other,
      ] },
      roster: [currentAgentSelection().target.agent, other],
      access: 'member_active',
    });
    render(<Composer model={model} commands={{}} />);

    expect(screen.getByLabelText('2 个目标')).toBeTruthy();
    expect(document.querySelector('.model-selector button')).toBeNull();
  });

  it('model-selector TC-1068: no-target delivery offers an explicit public Agent picker', () => {
    const other = { id: 'other', kind: 'agent', name: 'Other' };
    const commands = { selectAgent: vi.fn() };
    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [currentAgentSelection().target.agent, other],
      access: 'member_active',
    });
    render(<Composer model={model} commands={commands} />);

    fireEvent.click(screen.getByRole('button', { name: '选择 Agent' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other' }));
    expect(commands.selectAgent).toHaveBeenCalledWith('other');
  });

  it('model-selector TC-1069: a cold selector requests options first and opens when the same target becomes ready', () => {
    const commands = { openAgentSelector: vi.fn(), changeDraft: vi.fn() };
    const agent = currentAgentSelection().target.agent;
    const build = (agentSelection) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [agent],
      access: 'member_active',
      agentSelection,
    });
    const { rerender } = render(<Composer model={build({ target: { kind: 'single', agent }, view: null })} commands={commands} />);

    fireEvent.click(screen.getByRole('button', { name: 'Steward，点击读取可用模型' }));
    expect(commands.openAgentSelector).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();

    rerender(<Composer model={build(currentAgentSelection())} commands={commands} />);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('model-selector TC-1072: options arriving without a user open action do not open the menu', () => {
    const commands = { openAgentSelector: vi.fn() };
    const agent = currentAgentSelection().target.agent;
    const build = (agentSelection) => buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '', recipients: [] },
      roster: [agent],
      access: 'member_active',
      agentSelection,
    });
    const { rerender } = render(<Composer model={build({ target: { kind: 'single', agent }, view: null })} commands={commands} />);
    rerender(<Composer model={build(currentAgentSelection())} commands={commands} />);

    expect(screen.queryByRole('menu')).toBeNull();
    expect(commands.openAgentSelector).not.toHaveBeenCalled();
  });
});

describe('I-M exact-path public-owner recovery (round 16)', () => {
  it('message-presentation TC-1031: flat ledger rows are transport-safe but absent from every public projection', () => {
    const store = createChannelReplicaStore();
    const flatRows = [
      flatEnvelope(1, {
        id: 'flat-request', kind: 'request', type: TYPES.agentAsk, audience: [AGENT],
        body: { text: '旧账本请求' },
      }),
      flatEnvelope(2, {
        id: 'flat-response', kind: 'response', type: TYPES.agentAsk, parentId: 'flat-request',
        sender: AGENT, audience: [SELF], body: { status: 'completed', text: '旧账本响应' },
      }),
      flatEnvelope(3, {
        id: 'flat-event', kind: 'event', type: 'human.note', sender: AGENT, audience: [SELF],
        body: { text: '旧账本事件' },
      }),
      flatEnvelope(4, {
        id: 'flat-orphan-response', kind: 'response', type: 'vendor.custom', sender: AGENT,
        audience: [SELF], body: { status: 'completed', text: '旧账本孤立响应' },
      }),
    ];
    const canonicalEvent = envelope(5, {
      id: 'canonical-event', kind: 'event', type: 'human.note', sender: AGENT, audience: [SELF],
      body: { text: '当前规范事件' },
    });
    const state = store.ensure(CHANNEL).state;
    const release = state.arrivalReceipts.attachPresentationConsumer(Symbol('flat-payload-contract'));
    for (const row of [...flatRows, canonicalEvent]) {
      expect(store.commit({ channel_id: CHANNEL, seq: row.seq, envelope: row.envelope }, SELF, (value) => value, { source: 'live' }).accepted).toBe(true);
    }

    const all = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.all, selfId: SELF,
    });
    const mine = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });
    const presentation = createConversationPresentation();
    const candidate = presentation.evaluate(all.items, {
      epoch: CHANNEL + ':flat-payload', nextViewID: CHANNEL + ':conversation', sourceRevision: 5,
    });

    expect([...store.state(CHANNEL).rows.keys()]).toEqual([1, 2, 3, 4, 5]);
    expect(all.items.map((entry) => entry.envelope?.id || entry.turn?.requestId)).toEqual(['canonical-event']);
    expect(mine.items.map((entry) => entry.envelope?.id || entry.turn?.requestId)).toEqual(['canonical-event']);
    expect(candidate.snapshot.rows.map((row) => row.body.envelope?.id)).toEqual(['canonical-event']);
    expect(store.state(CHANNEL).arrivalReceipts.presentation().events.map((event) => event.rowIDs)).toEqual([['canonical-event']]);
    for (const row of flatRows) {
      expect(notificationDisposition(store.state(CHANNEL), row.envelope, SELF)).toBe('not_presented');
      expect(isRailNotifiableDisposition(notificationDisposition(store.state(CHANNEL), row.envelope, SELF))).toBe(false);
    }
    release();
  });
});

describe('I-M exact-path public-owner recovery (round 27 live contracts)', () => {
  it('live-checkpoint-ordering TC-0918: landing precedes the accepted coverage checkpoint', async () => {
    const options = liveCheckpointOptions();
    const ownerToken = Object.freeze({ principalId: 'round27-live' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: CHANNEL, head_seq: 2, has_rows: true },
    ], { generation: 27, boot: 'round27-boot', focus: CHANNEL });

    const owner = runtime.getOwnerSnapshot(ownerToken);
    expect(owner.enqueue({
      source: 'live', generation: 27, channel_id: CHANNEL, seq: 1,
      envelope: { id: 'round27-live-1', kind: 'event', type: 'human.note', payload: { body: { text: 'one' } } },
    })).toBe(true);
    expect(owner.enqueue({
      source: 'live', generation: 27, channel_id: CHANNEL, seq: 2,
      envelope: { id: 'round27-live-2', kind: 'event', type: 'human.note', payload: { body: { text: 'two' } } },
    })).toBe(true);

    expect(owner.liveCheckpoint({
      generation: 27, channel_id: CHANNEL, scan_low_seq: 1, scanned_seq: 2,
    })).toBe(true);
    expect([...runtime.getSnapshot().stateFor(CHANNEL).rows.keys()]).toEqual([1, 2]);
    expect(runtime.getSnapshot().historyFor(CHANNEL).controlCoverage).toEqual([
      { lowSeq: 1, highSeq: 2 },
    ]);
    runtime.destroy();
  });

  it('live-checkpoint-ordering TC-0919: an empty checkpoint never fabricates a live row', async () => {
    const options = liveCheckpointOptions();
    const ownerToken = Object.freeze({ principalId: 'round27-empty' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: CHANNEL, head_seq: 0, has_rows: false },
    ], { generation: 27, boot: 'round27-empty-boot', focus: CHANNEL });

    const owner = runtime.getOwnerSnapshot(ownerToken);
    expect(owner.liveCheckpoint({
      generation: 27, channel_id: CHANNEL, scan_low_seq: 1, scanned_seq: 1,
    })).toBe(true);
    expect(runtime.getSnapshot().stateFor(CHANNEL).rows.size).toBe(0);
    expect(runtime.getSnapshot().stateFor(CHANNEL).timeline).toEqual([]);
    expect(runtime.getSnapshot().historyFor(CHANNEL).controlCoverage).toEqual([
      { lowSeq: 1, highSeq: 1 },
    ]);
    runtime.destroy();
  });

  it('live-presentation-arrivals TC-0920: only an attached consumer receives a live backlog', () => {
    const store = createChannelReplicaStore();
    const state = store.ensure(CHANNEL).state;
    store.commit(request(1, 'before-round27-mount'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation().events).toEqual([]);

    const release = state.arrivalReceipts.attachPresentationConsumer(Symbol('round27-timeline'));
    store.commit(request(2, 'during-round27-mount'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation().events).toEqual([
      expect.objectContaining({ rowIDs: ['during-round27-mount'], sourceRevision: 2 }),
    ]);

    release();
    expect(state.arrivalReceipts.presentation().events).toEqual([]);
    store.commit(request(3, 'after-round27-release'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation().events).toEqual([]);
  });

  it('live-presentation-arrivals TC-0921: acknowledging one source prefix leaves the later event', () => {
    const store = createChannelReplicaStore();
    const state = store.ensure(CHANNEL).state;
    state.arrivalReceipts.attachPresentationConsumer(Symbol('round27-prefix'));
    store.commit(request(1, 'round27-first'), SELF, (value) => value, { source: 'live' });
    store.commit(request(2, 'round27-second'), SELF, (value) => value, { source: 'live' });

    const first = state.arrivalReceipts.presentation(1);
    expect(first).toMatchObject({ revision: 1, headRevision: 2 });
    expect(first.events.map((event) => event.rowIDs[0])).toEqual(['round27-first']);
    expect(state.arrivalReceipts.dispatch(acknowledgeLivePresentationArrivals(first.revision))).toBe(1);
    expect(state.arrivalReceipts.presentation(2).events.map((event) => event.rowIDs[0])).toEqual([
      'round27-second',
    ]);
  });

  it('live-presentation-arrivals TC-0922: a response arrival keeps root and exact envelope identities', () => {
    const store = createChannelReplicaStore();
    const state = store.ensure(CHANNEL).state;
    state.arrivalReceipts.attachPresentationConsumer(Symbol('round27-response'));
    store.commit(request(1, 'round27-root'), SELF, (value) => value, { source: 'live' });
    state.arrivalReceipts.dispatch(acknowledgeLivePresentationArrivals(1));

    store.commit(progress(2, 'round27-root', 'round27-progress'), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation(2).events).toEqual([
      expect.objectContaining({ rowIDs: ['round27-root', 'round27-root-progress-2'], sourceRevision: 2 }),
    ]);
  });
});

describe('I-M exact-path public-owner recovery (round 28 projection contracts)', () => {
  it('management-actors TC-0923: business roster hides the system actor while governance keeps its route', () => {
    const rows = [
      { id: SYSTEM_ACTOR_ID, kind: 'system' },
      { id: AGENT, kind: 'agent', name: 'Steward' },
    ];
    expect(rows.filter(isVisibleActor).map((row) => row.id)).toEqual([AGENT]);

    const model = buildComposerModel({
      activeChannelId: CHANNEL,
      draft: { text: '/members', recipients: [] },
      roster: [rows[1]],
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent: rows[1] } },
    });
    expect(createComposerCommandRequest(model, parseComposerCommand('/members'))).toMatchObject({
      channelId: CHANNEL,
      msgType: TYPES.member.list,
      audience: [SYSTEM_ACTOR_ID],
    });
  });

  it('markdown-content TC-0925: math renders while fenced and inline code remain literal', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '行内 \\(M_t = \\operatorname{Fold}_R(H_t)\\) 与 $G_t$.',
      '',
      '\\[',
      '\\text{Problem}\\rightarrow\\text{Machine}',
      '\\]',
      '',
      tick + '\\(not math\\)' + tick,
      '',
      tick.repeat(3) + 'tex',
      '\\[not math\\]',
      tick.repeat(3),
    ].join('\n');
    const { container } = render(<MarkdownContent text={source} />);

    expect(container.querySelectorAll('.katex')).toHaveLength(3);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.querySelector('code').textContent).toBe('\\(not math\\)');
    expect(container.querySelector('pre code').textContent).toContain('\\[not math\\]');
  });

  it('markdown-content TC-0926: delimiter normalization is paired, unescaped, and code-scoped', () => {
    const tick = String.fromCharCode(96);
    const source = '\\(x\\) ' + tick + '\\(code\\)' + tick + ' \\\\(literal\\\\) \\[y\\] \\[unclosed';
    const expected = '$x$ ' + tick + '\\(code\\)' + tick + ' \\\\(literal\\\\) $$y$$ \\[unclosed';
    expect(normalizeMathMarkdown(source)).toBe(expected);
  });

  it('markdown-content TC-0927: the public renderer preserves GFM table/task/link semantics', () => {
    const source = [
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| 报告 | 完成 |',
      '',
      '- [x] 已核对',
      '',
      '~~旧结论~~ [来源](https://example.com)',
    ].join('\n');
    const { container } = render(<MarkdownContent text={source} />);

    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('input[type="checkbox"]')?.disabled).toBe(true);
    expect(container.querySelector('del')?.textContent).toBe('旧结论');
    expect(screen.getByRole('link', { name: '来源' }).getAttribute('target')).toBe('_blank');
  });

  it('markdown-content TC-0928: ledger HTML remains inert instead of becoming executable DOM', () => {
    const { container } = render(
      <MarkdownContent text={'<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>'} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('mock-protocol TC-1047: malformed or unknown upstream fields return explicit validation errors', () => {
    expect(validatePayload('submit', { channel_id: CHANNEL })).toContain('msg_type');
    expect(validatePayload('submit', {
      channel_id: CHANNEL, msg_type: TYPES.agentAsk, extra: true,
    })).toContain('unknown field: extra');
    expect(validatePayload('missing', {})).toContain('unknown upstream frame_type');
  });
});
