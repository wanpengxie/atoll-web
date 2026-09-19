// @vitest-environment jsdom
import React, { useMemo } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { useComposerCommands } from '../src/ui/composer/useComposerCommands.js';
import { ReadingIntentProvider } from '../src/ui/conversation/ReadingIntentContext.jsx';

afterEach(cleanup);

const HUMAN = { id: 'human:root:1', kind: 'human', name: 'Root' };
const AGENT = { id: 'agent:steward:1', kind: 'agent', name: 'Steward' };
const ROSTER = Object.freeze([HUMAN, AGENT]);
const ACCESS = Object.freeze({
  authorityEpoch: 1,
  relationship: 'member',
  existence: 'present',
  runtime: 'open',
  unavailable: false,
});

function createMemoryOutbox() {
  const drafts = new Map();
  const submissions = new Map();
  return {
    async restore() { return [...submissions.values()]; },
    async restoreDrafts() { return [...drafts.values()]; },
    async writeDraft(principalId, channelId, draft) {
      const previous = drafts.get(channelId);
      const record = {
        principalId,
        channelId,
        revision: Number(previous?.revision || 0) + 1,
        editorRevision: Number(draft.editorRevision || 0),
        draft,
      };
      drafts.set(channelId, record);
      return { conflict: false, record };
    },
    async acceptDraft({ principalId, channelId, submissions: rows, editorRevision }) {
      const current = drafts.get(channelId);
      const record = {
        ...current,
        principalId,
        channelId,
        revision: Number(current?.revision || 0) + 1,
        editorRevision: Number(editorRevision || current?.editorRevision || 0),
        draft: null,
      };
      rows.forEach((row) => submissions.set(row.messageId, { ...row, principalId }));
      drafts.set(channelId, record);
      return { accepted: true, consumed: true, record, submissions: rows.map((row) => ({ ...row, principalId })) };
    },
    async putMany(principalId, rows) {
      rows.forEach((row) => submissions.set(row.messageId, { ...row, principalId }));
      return rows.map((row) => ({ ...row, principalId }));
    },
    async patch(principalId, messageId, _expectedStates, change) {
      const current = submissions.get(messageId);
      if (!current) return null;
      const next = { ...current, ...change, principalId };
      submissions.set(messageId, next);
      return next;
    },
    async remove(_principalId, messageId) { return submissions.delete(messageId); },
    async acquireLease(_principalId, messageId, leaseOwner) {
      const current = submissions.get(messageId);
      return current ? { ...current, leaseOwner, leaseUntil: Date.now() + 1_000 } : null;
    },
    async releaseLease() { return true; },
    async mergeDraftAttachments() { return null; },
    close() {},
  };
}

function RestartSurface({ transport, access = ACCESS }) {
  const outbox = useMemo(() => createMemoryOutbox(), []);
  const outboxFactory = useMemo(() => () => outbox, [outbox]);
  const wireRef = useMemo(() => ({ current: transport }), [transport]);
  const accessRef = useMemo(() => ({ current: { state: () => access } }), [access]);
  const probes = useMemo(() => ({ requestKeys: () => ({}), targetChanged: vi.fn() }), []);
  const config = useMemo(() => ({
    activeChannelId: 'c0',
    principalId: 'root',
    wireState: 'open',
    wireRef,
    accessRef,
    producerOwnerToken: 'owner:root',
    generationFor: () => 1,
    serverWorld: 'world-a',
    outboxFactory,
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    roster: ROSTER,
    selfId: HUMAN.id,
    access,
    agentSelection: { selectedAgentId: AGENT.id },
    capabilityIndex: new Map(),
    attachments: [],
    probes,
    onRequestCapability: vi.fn(),
    attachmentRef: { current: { attach: vi.fn(), upload: vi.fn(), mutate: vi.fn() } },
    channelState: { timeline: [] },
  }), [access, accessRef, outboxFactory, probes, wireRef]);
  const composer = useComposerCommands(config);
  return <ReadingIntentProvider value={null}>
    <Composer model={composer.model} commands={composer.commands} />
  </ReadingIntentProvider>;
}

async function chooseRestart(user) {
  const input = screen.getByRole('textbox', { name: '消息' });
  await user.type(input, '/restart');
  const option = await screen.findByRole('option', { name: /重启 Agent/ });
  await user.click(option);
  await waitFor(() => expect(input.textContent).toContain('/restart'));
  await user.keyboard('{Enter}');
}

describe('targeted restart through the public Composer UI owner', () => {
  it('selects /restart and submits the exact targeted system command frame', async () => {
    const user = userEvent.setup();
    const transport = {
      submit: vi.fn(async (frame) => ({ message_id: frame.id })),
    };
    render(<RestartSurface transport={transport} />);

    await chooseRestart(user);
    await waitFor(() => expect(transport.submit).toHaveBeenCalledTimes(1));
    expect(transport.submit.mock.calls[0][0]).toMatchObject({
      channel_id: 'c0',
      msg_type: 'system.member.restart',
      kind: 'request',
      audience: ['system'],
      payload: { member: AGENT.id },
    });
  });

  it('keeps the public command unavailable when the session cannot transmit', async () => {
    const transport = { submit: vi.fn() };
    render(<RestartSurface
      transport={transport}
      access={{ ...ACCESS, unavailable: true }}
    />);

    const input = screen.getByRole('textbox', { name: '消息' });
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('当前频道不可写；草稿仍保留在当前设备。')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /重启 Agent/ })).toBeNull();
    expect(transport.submit).not.toHaveBeenCalled();
  });

  it('keeps a rejected restart as a visible retryable failure', async () => {
    const user = userEvent.setup();
    const failure = Object.assign(new Error('protected actor'), { code: 'protected_actor' });
    const transport = { submit: vi.fn().mockRejectedValue(failure) };
    render(<RestartSurface transport={transport} />);

    await chooseRestart(user);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('protected actor'));
    expect(screen.getByRole('button', { name: '使用原编号重试' })).toBeTruthy();
  });
});
