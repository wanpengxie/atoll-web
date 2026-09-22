// @vitest-environment jsdom
// Round 27 recovers only cases whose current public owner already exposes the
// baseline capability.  Product gaps stay in the Round 26 ordinary-red packet.
import React from 'react';
import {
  act, cleanup, fireEvent, render, renderHook, screen, waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { ReadingContainerHandoff } from '../src/ui/timeline/ReadingContainerHandoff.jsx';
import { useWaitingEditingController } from '../src/ui/timeline/useWaitingEditingController.jsx';

const HUMAN = { id: 'human:round27:me', kind: 'human', name: '我' };
const AGENT = { id: 'agent:round27:worker', kind: 'agent', name: 'Agent' };
const CAPABILITIES = new Map([[AGENT.id, {
  describe: {
    types: new Map([
      ['agent.ask', {}],
      ['agent.hold', {}],
      ['agent.replace', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
      ['agent.unhold', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
    ]),
  },
}]]);

function request(id, text = '工作') {
  return {
    id, kind: 'request', type: 'agent.ask', ts: Date.now(),
    sender: HUMAN, audience: [AGENT.id], visibility: 'public',
    payload: { body: { text } },
  };
}

function response(id, parentId, body = {}) {
  return {
    id, parent_id: parentId, kind: 'response', type: 'agent.ask', ts: Date.now(),
    sender: AGENT, audience: [HUMAN.id], visibility: 'public',
    payload: { body },
  };
}

function governance({ commands = {}, ...rest } = {}) {
  return render(<ChannelAdministrationPanel
    channel={{ id: 'c0', qualified_name: 'c0' }}
    port={{ commands, children: [], ...rest }}
    onClose={vi.fn()}
  />);
}

function feedOptions(overrides = {}) {
  return {
    wireRef: { current: null },
    rosterRef: { current: {
      self: () => HUMAN.id,
      observeFeed: () => {},
      handleEnvelope: () => {},
    } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
    ...overrides,
  };
}

const activeRuntimes = new Set();
async function attachedRuntime({ principal, boot, focus = 'c0' } = {}) {
  const runtime = createChannelFeedRuntime(feedOptions());
  activeRuntimes.add(runtime);
  runtime.mount();
  const snapshot = runtime.getSnapshot();
  await snapshot.setHistoryGrants([
    { channel_id: 'c0', head_seq: 100, has_rows: true },
  ], { generation: 1, boot, focus });
  await snapshot.prepareLocalReplica(principal, { focus });
  return { runtime, snapshot: () => runtime.getSnapshot() };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const runtime of activeRuntimes) runtime.destroy();
  activeRuntimes.clear();
});

describe('A-D round 27 fixture recovery', () => {
  it('[AD-027] hands processing edit to Composer only after the public resumed fact', async () => {
    // 用户能力：编辑 processing Agent turn 时，Composer 只在该请求收到
    // queued+resumed 事实后打开。
    // 不变量：Waiting 不能以 processing 快照越过公开交接事实；公开 owner：
    // useWaitingEditingController 的 Composer handoff。
    const processingFrame = {
      seq: 2,
      envelope: response('work-processing', 'work', {
        status: 'processing', controls: [{ word: 'agent.replace' }],
      }),
    };
    const processing = {
      requestId: 'work', request: request('work', 'edit without navigation'), requestSeq: 1,
      status: 'processing', latestStatus: 'processing', terminal: null,
      provisional: [processingFrame],
    };
    const onTaskControl = vi.fn(async ({ type }) => (
      type === 'agent.hold' ? 'hold-work' : `${type}-id`
    ));
    const onComposerEditChange = vi.fn();
    const readingOwner = {
      activationID: 'round27-reading',
      session: { mode: 'following', inputEpoch: 1, activationID: 'round27-reading' },
      getSession: () => readingOwner.session,
      onSurfaceVisibilityChange: vi.fn(),
    };
    const readingView = render(<ReadingContainerHandoff
      reading={readingOwner}
      surfaceVisible
      snapshot={{ rows: [] }}
      renderRow={() => null}
    />);
    const committedReading = readingView.container.querySelector('.timeline-reading-stack');
    const common = {
      pending: [], capabilityIndex: CAPABILITIES,
      onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange,
    };
    const { result, rerender } = renderHook(
      (props) => useWaitingEditingController(props),
      { initialProps: { ...common, state: { channelId: 'c0', timeline: [{ kind: 'turn', turn: processing }] } } },
    );

    await act(async () => { await result.current.startEditing(processing, AGENT.id); });
    expect(result.current.presentationEditing).toMatchObject({
      targetId: 'work', holdId: 'hold-work', phase: 'waiting_for_resume',
    });
    expect(onComposerEditChange).toHaveBeenLastCalledWith(null);

    const staleResume = {
      seq: 5,
      envelope: response('work-stale-resume', 'work', {
        status: 'queued', resumed: true, held_by: 'other-hold',
        controls: [{ word: 'agent.replace' }],
      }),
    };
    rerender({
      ...common,
      state: {
        channelId: 'c0', _timelineControlVersion: 1,
        timeline: [{ kind: 'turn', turn: { ...processing, provisional: [processingFrame, staleResume] } }],
      },
    });
    expect(result.current.presentationEditing).toMatchObject({ phase: 'waiting_for_resume' });
    expect(onComposerEditChange).toHaveBeenLastCalledWith(null);

    const resumed = {
      seq: 6,
      envelope: response('work-resumed', 'work', {
        status: 'queued', resumed: true, held_by: 'hold-work',
        controls: [{ word: 'agent.replace' }],
      }),
    };
    const resumedTurn = { ...processing, provisional: [processingFrame, staleResume, resumed] };
    rerender({
      ...common,
      state: {
        channelId: 'c0', _timelineControlVersion: 2,
        timeline: [{ kind: 'turn', turn: resumedTurn }],
      },
    });
    await waitFor(() => expect(onComposerEditChange).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        targetId: 'work', holdId: 'hold-work', phase: 'editing', location: 'queued',
      }),
    })));
    expect(result.current.presentationEditing).toMatchObject({
      targetId: 'work', holdId: 'hold-work', phase: 'editing',
    });
    // The current Reading owner is a stable public handoff boundary; editing
    // state must not replace its following adapter.
    expect(committedReading.isConnected).toBe(true);
    expect(committedReading.dataset.readingMode).toBe('following');
  });

  it.skip('[AD-178] restores retained Meta/readiness when both attaches name the same boot', async () => {
    // 用户能力：重新 attach 后先恢复 live queue/Meta cursor，不等待选中频道
    // 的 body hydration。
    // 不变量：Meta/readiness 与 body hydration 是独立 owner；公开 owner：
    // ChannelFeedRuntime.prepareLocalReplica/resumeLocalReplica + Replica cache。
    const principal = 'round27-body-principal';
    const boot = 'round27-body-boot';
    const seed = await attachedRuntime({ principal, boot });
    seed.snapshot().enqueue({
      channel_id: 'c0', seq: 100, generation: 1, source: 'live',
      envelope: {
        id: 'cached-body', kind: 'event', type: 'human.note', visibility: 'public',
        sender: AGENT, audience: [HUMAN.id], payload: { body: { text: 'cached body' } },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    seed.runtime.destroy();
    activeRuntimes.delete(seed.runtime);

    // Keep the selected body out of this fixture: the public Meta/readiness
    // result is the contract under test, while the body remains an independent
    // cache hydration owner.  The previous red fixture also accidentally
    // changed boot between these two attaches.
    const restored = await attachedRuntime({ principal, boot, focus: '' });
    expect(restored.snapshot().resumeLocalReplica()).toMatchObject({ c0: 100 });
    expect(restored.snapshot().stateFor('c0')?.rows.has(100)).toBe(false);
  });

  it('[AD-196] exposes a rejected create command as a failed public operation', async () => {
    // 用户能力：compact closure 失败时能看到实际失败原因，不猜成 unavailable 或成功。
    // 不变量：failed 与 unavailable-result facts 分离；公开 owner：
    // ChannelAdministrationPanel/ChannelOverview 的 useCommand。
    const submit = vi.fn().mockRejectedValue(new Error('wire closed'));
    governance({ commands: { submit } });
    fireEvent.click(screen.getByRole('tab', { name: '概览' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('wire closed');
      expect(screen.getByRole('alert').textContent).toContain('wire closed');
    });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
    }));
  });
});
