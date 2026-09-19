// @vitest-environment jsdom
// Round-12 exact-path recovery for the five I-M baseline files that the
// global static ledger still reports as `absent target path`. These tests are
// deliberately public-owner contracts: no deleted adapter, private helper, or
// production state map is imported.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createChannelReplicaStore,
} from '../src/model/channel-replica.js';
import {
  createConversationPresentation,
} from '../src/model/conversation-presentation.js';
import {
  SYSTEM_ACTOR_ID,
  TYPES,
} from '../src/protocol/vocab.js';
import {
  buildComposerModel,
  createComposerCommandRequest,
  parseComposerCommand,
} from '../src/ui/composer/composer-model.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';
import { projectAgentParameters } from '../src/ui/composer/agent-parameters.js';

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
