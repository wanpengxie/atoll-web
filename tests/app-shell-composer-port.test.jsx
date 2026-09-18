// @vitest-environment jsdom
import React, { StrictMode, Suspense, startTransition } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  blockChannel: '',
  promise: null,
  resolve: null,
  composerProps: new Map(),
}));

vi.mock('../src/ui/ChannelList.jsx', () => ({ ChannelList: () => null }));
vi.mock('../src/ui/ArtifactsView.jsx', () => ({ ArtifactsView: () => null }));
vi.mock('../src/ui/TasksView.jsx', () => ({ TasksView: () => null }));
vi.mock('../src/ui/TerminalView.jsx', () => ({ TerminalView: () => null }));
vi.mock('../src/app/RightPanelHost.jsx', () => ({ RightPanelHost: () => null }));
vi.mock('../src/ui/Composer.jsx', () => ({
  Composer: (props) => {
    harness.composerProps.set(props.channelId, props);
    return <button type="button" aria-label={`composer-${props.channelId}`} onClick={() => props.onDraftChange({ text: props.channelId })}>composer</button>;
  },
}));
vi.mock('../src/ui/Timeline.jsx', () => ({
  Timeline: ({ state, composer }) => {
    if (state.channelId === harness.blockChannel && harness.promise) throw harness.promise;
    return <section id="workspace-panel-dynamic" role="tabpanel" aria-labelledby="workspace-tab-dynamic">{composer}</section>;
  },
}));

import { AppShell } from '../src/app/AppShell.jsx';

function owner(channelId, principal = 'principal-a') {
  const actions = {
    onDraftChange: vi.fn(), onSend: vi.fn(() => Promise.resolve(`${channelId}-message`)), onRetry: vi.fn(),
    onPreviewAttachment: vi.fn(), onRemoveAttachment: vi.fn(), onClearAttachments: vi.fn(),
    onUploadAttachments: vi.fn(), onOpenChannelFiles: vi.fn(),
  };
  return {
    actions,
    props: {
      session: { wireState: 'open', me: { id: principal }, onLogout: vi.fn() },
      navigation: {
        channels: [{ id: 'c0', access: 'member_active' }, { id: 'c1', access: 'member_active' }],
        activeChannelId: channelId, unread: {}, onSelect: vi.fn(), onCreate: vi.fn(),
        onSearch: vi.fn(), onActivity: vi.fn(), onSpaceManage: vi.fn(),
      },
      workspace: {
        channel: { id: channelId, name: channelId }, view: 'dynamic', onViewChange: vi.fn(), access: 'member_active',
        state: { channelId, turns: new Map(), lastSeq: 0 }, history: {}, roster: [], selfId: principal, pending: [],
        approvalStates: {}, controlStates: {}, capabilityIndex: new Map(), attachments: [], draft: {}, draftRevision: 0,
        resources: {}, tasks: { items: [] }, agentSelection: {},
        ...actions,
      },
      notices: {},
      panel: { value: '', open: vi.fn(), host: {} },
    },
  };
}

afterEach(() => {
  cleanup();
  harness.blockChannel = '';
  harness.promise = null;
  harness.resolve = null;
  harness.composerProps.clear();
});

describe('AppShell committed Composer action port', () => {
  it('keeps the painted A editor bound to A while a B render suspends, then retires A on B commit', async () => {
    const a = owner('c0');
    const b = owner('c1');
    const view = render(<Suspense fallback={<p>suspended</p>}><AppShell {...a.props} /></Suspense>);
    await screen.findByRole('button', { name: 'composer-c0' });
    const aPort = harness.composerProps.get('c0');

    harness.blockChannel = 'c1';
    harness.promise = new Promise((resolve) => { harness.resolve = resolve; });
    await act(async () => {
      startTransition(() => view.rerender(<Suspense fallback={<p>suspended</p>}><AppShell {...b.props} /></Suspense>));
    });
    expect(screen.getByRole('button', { name: 'composer-c0' })).toBeTruthy();

    aPort.onDraftChange({ text: 'still-a' });
    await aPort.onSend({ text: 'still-a' });
    aPort.onRemoveAttachment('a-file');
    expect(a.actions.onDraftChange).toHaveBeenCalledWith({ text: 'still-a' });
    expect(a.actions.onSend).toHaveBeenCalledWith({ text: 'still-a' });
    expect(a.actions.onRemoveAttachment).toHaveBeenCalledWith('a-file');
    expect(b.actions.onDraftChange).not.toHaveBeenCalled();
    expect(b.actions.onSend).not.toHaveBeenCalled();
    expect(b.actions.onRemoveAttachment).not.toHaveBeenCalled();

    await act(async () => {
      harness.blockChannel = '';
      harness.resolve();
      await harness.promise;
    });
    await screen.findByRole('button', { name: 'composer-c1' });
    const bPort = harness.composerProps.get('c1');
    bPort.onDraftChange({ text: 'now-b' });
    expect(b.actions.onDraftChange).toHaveBeenCalledWith({ text: 'now-b' });

    // An idle callback captured by the unmounted A editor is retired, not
    // redirected into the newly committed B owner.
    aPort.onDraftChange({ text: 'late-a' });
    expect(a.actions.onDraftChange).toHaveBeenCalledTimes(1);
    expect(b.actions.onDraftChange).toHaveBeenCalledTimes(1);
  });

  it('keeps callback identity stable within one owner while committing the latest feed-render targets', async () => {
    const first = owner('c0');
    const second = owner('c0');
    const view = render(<AppShell {...first.props} />);
    await screen.findByRole('button', { name: 'composer-c0' });
    const before = harness.composerProps.get('c0').onDraftChange;

    view.rerender(<AppShell {...second.props} />);
    await waitFor(() => expect(harness.composerProps.get('c0').onDraftChange).toBe(before));
    before({ text: 'latest' });
    expect(first.actions.onDraftChange).not.toHaveBeenCalled();
    expect(second.actions.onDraftChange).toHaveBeenCalledWith({ text: 'latest' });
  });

  it('survives StrictMode setup/cleanup and a committed A→B→A handoff without stale cleanup', async () => {
    const a1 = owner('c0');
    const b = owner('c1');
    const a2 = owner('c0');
    const view = render(<StrictMode><AppShell {...a1.props} /></StrictMode>);
    await screen.findByRole('button', { name: 'composer-c0' });
    const retiredA = harness.composerProps.get('c0').onDraftChange;
    retiredA({ text: 'a1' });
    expect(a1.actions.onDraftChange).toHaveBeenCalledOnce();

    view.rerender(<StrictMode><AppShell {...b.props} /></StrictMode>);
    await screen.findByRole('button', { name: 'composer-c1' });
    const retiredB = harness.composerProps.get('c1').onDraftChange;
    retiredB({ text: 'b' });
    expect(b.actions.onDraftChange).toHaveBeenCalledOnce();

    view.rerender(<StrictMode><AppShell {...a2.props} /></StrictMode>);
    await screen.findByRole('button', { name: 'composer-c0' });
    const currentA = harness.composerProps.get('c0').onDraftChange;
    currentA({ text: 'a2' });
    retiredA({ text: 'late-a1' });
    retiredB({ text: 'late-b' });
    expect(a1.actions.onDraftChange).toHaveBeenCalledTimes(1);
    expect(b.actions.onDraftChange).toHaveBeenCalledTimes(1);
    expect(a2.actions.onDraftChange).toHaveBeenCalledWith({ text: 'a2' });
  });
});
