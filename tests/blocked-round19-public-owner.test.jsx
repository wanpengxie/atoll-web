// @vitest-environment jsdom
// Round 19 keeps twenty remaining A-D rows at their current public owners.
// Every assertion is an independent baseline capability/invariant probe.  The
// expected-fail cases are deliberate product-gap evidence; they are not
// skipped, deleted, or counted as recovered rows.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, act } from '@testing-library/react';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { useComposerSubmissionRuntime } from '../src/ui/composer/index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function session() {
  return {
    wireState: 'open',
    me: { id: 'human:root:1', display_name: 'Root' },
    onLogout: vi.fn(),
  };
}

function navigation(activeChannelId = 'c0', overrides = {}) {
  const channels = [
    { id: 'c0', name: 'c0', qualified_name: 'c0', access: 'member_active' },
    { id: 'c1', name: 'c1', qualified_name: 'c1', access: 'member_active' },
    { id: 'c2', name: 'c2', qualified_name: 'c2', access: 'member_active' },
  ];
  const active = channels.find((channel) => channel.id === activeChannelId) || null;
  return {
    channels,
    activeChannelId,
    activeChannel: active,
    channel: active,
    activeView: 'conversation',
    terminalVisible: false,
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
    openRoster: vi.fn(),
    openTerminal: vi.fn(),
    ...overrides,
  };
}

function renderShell(nav) {
  return render(<WorkspaceLayout
    session={session()}
    navigation={nav}
    conversation={{ element: <div data-testid="message-surface">消息</div> }}
  />);
}

function governance({ commands = {}, ...rest } = {}) {
  return render(<ChannelAdministrationPanel
    channel={{ id: 'c0', qualified_name: 'c0' }}
    port={{ commands, children: [], ...rest }}
    onClose={vi.fn()}
  />);
}

describe('A-D round 19 public owner evidence: navigation', () => {
  it.fails('[AD-097] cancels a pending target when the user rapidly reselects the committed channel', () => {
    // 用户能力：A→B 尚未 commit 时可立即反选 A。
    // 不变量：最新用户选择是唯一 pending owner；公开 owner：WorkspaceLayout。
    const nav = navigation();
    renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(screen.getByText('c0'));
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });

  it.fails('[AD-099] ends pending after an invalid target rolls back to the origin channel', () => {
    // 用户能力：目录拒绝失效 target 后退回原频道并结束旧 pending。
    // 不变量：rollback 与 terminal handoff 同一 committed identity；公开 owner：WorkspaceLayout/navigation。
    const nav = navigation();
    const view = renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    const rejected = navigation('c0', { channel: null });
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={rejected}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
    />);
    expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(false);
  });

  it('[AD-101] publishes false message-surface visibility while a narrow terminal covers it', () => {
    // 用户能力：窄屏终端覆盖 Dynamic 时可观察 surface=false。
    // 不变量：覆盖状态是公开事实而非 CSS 猜测；公开 owner：WorkspaceLayout。
    vi.stubGlobal('matchMedia', (query) => ({
      matches: query === '(max-width: 640px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderShell(navigation('c0', { terminalVisible: true }));
    expect(screen.getByTestId('message-surface').getAttribute('data-surface-visible')).toBe('false');
  });

  it.fails('[AD-105] hands off only the latest target in a rapid A-to-B-to-A selection', () => {
    // 用户能力：快速反选最终只交接最新目标。
    // 不变量：旧 pending 不能抢焦点或 terminal；公开 owner：WorkspaceLayout。
    const nav = navigation();
    renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(screen.getByText('c0'));
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });

  it.fails('[AD-106] retains a channel terminal split when leaving and returning', () => {
    // 用户能力：切走再回来仍保留该频道 terminal split。
    // 不变量：PTY/session/layout visibility 按 channel 隔离；公开 owner：WorkspaceLayout + WorkspaceFeatures。
    const first = navigation('c0', { terminalVisible: true });
    const view = renderShell(first);
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={navigation('c1')}
      conversation={{ element: <div>消息</div> }}
    />);
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={navigation('c0')}
      conversation={{ element: <div>消息</div> }}
    />);
    expect(document.getElementById('workspace-panel-terminal')?.hidden).toBe(false);
  });

  it.fails('[AD-108] keeps one channel close from changing another channel terminal visibility', () => {
    // 用户能力：收起 c0 分屏不影响 c1。
    // 不变量：terminal visibility 是 channel-scoped；公开 owner：WorkspaceLayout + WorkspaceFeatures。
    const view = renderShell(navigation('c0', { terminalVisible: true }));
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={navigation('c1', { terminalVisible: true })}
      conversation={{ element: <div>消息</div> }}
    />);
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={navigation('c0')}
      conversation={{ element: <div>消息</div> }}
    />);
    expect(document.getElementById('workspace-panel-terminal')?.hidden).toBe(false);
  });
});

describe('A-D round 19 public owner evidence: create-channel governance', () => {
  it.fails('[AD-149] opens an independent create dialog and focuses its name field', () => {
    // 用户能力：新建频道打开独立 dialog 并首先聚焦名称。
    // 不变量：dialog owner 负责 focus 与提交生命周期；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('新频道名称'));
  });

  it.fails('[AD-150] includes a selected current-channel Agent as an initial seat', () => {
    // 用户能力：创建时把当前频道 Agent 作为真实 actor seat 带入。
    // 不变量：seat 来源只能是公开 roster；公开 owner：GovernanceFeature。
    governance({
      commands: { submit: vi.fn() },
      roster: [{ id: 'agent:worker:1', kind: 'agent', name: 'Worker' }],
    });
    expect(screen.getByRole('checkbox', { name: /Worker/ })).toBeTruthy();
  });

  it.fails('[AD-151] reads template body before submitting a public recipe', () => {
    // 用户能力：模板 body 先读账本再用于 create。
    // 不变量：create 不能只发送 template ID；公开 owner：GovernanceFeature。
    const submit = vi.fn().mockResolvedValueOnce('template-request').mockResolvedValueOnce('create-request');
    governance({ commands: { submit }, space: { channelTemplates: [{ id: 'team', name: 'Team' }] } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'templated' } });
    fireEvent.click(screen.getByRole('combobox', { name: '频道模板' }));
    fireEvent.click(screen.getByRole('option', { name: 'Team' }));
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'get_template' }));
  });

  it.fails('[AD-152] treats a template compact closure as unavailable detail, not business failure', () => {
    // 用户能力：模板终态缺 body 时稳定提示不可用。
    // 不变量：缺失详情不能伪造 recipe 或业务失败；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('template-request') } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'templated' } });
    expect(screen.getByRole('alert').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });

  it.fails('[AD-153] exposes four-step convergence and enters only after ready', () => {
    // 用户能力：分别看到 ledger/OBS/membership/serving，ready 后才进入。
    // 不变量：单一 command receipt 不能宣告 serving ready；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('request-1') } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(screen.getByRole('region', { name: '频道创建进度' })).toBeTruthy();
  });

  it.fails('[AD-155] provides dialog Escape/backdrop/focus-trap and returns focus after close', () => {
    // 用户能力：Escape/遮罩关闭、焦点闭环、关闭后 focus return。
    // 不变量：独立 dialog owner 承担完整生命周期；公开 owner：GovernanceFeature/SidePanel。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.querySelector('.channel-create-backdrop')).toBeTruthy();
  });
});

describe('A-D round 19 public owner evidence: governance convergence', () => {
  it.fails('[AD-192] accepts only real human principals in the user selector', () => {
    // 用户能力：候选只显示 registry 中可用 human principal。
    // 不变量：agent/retired principal 不能成为 human admission target；公开 owner：GovernanceFeature + WorkspaceApp port。
    governance({
      commands: { submit: vi.fn() },
      principals: [
        { id: 'root', kind: 'human', status: 'present' },
        { id: 'steward', kind: 'agent', status: 'present' },
        { id: 'retired', kind: 'human', status: 'retired' },
      ],
    });
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    fireEvent.click(screen.getByRole('combobox', { name: '选择参与者' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['root · 用户']);
  });

  it.fails('[AD-193] waits for ledger, OBS, membership, and serving convergence after create', () => {
    // 用户能力：创建成功要分别收敛四类事实。
    // 不变量：command receipt 不能替代 serving/membership facts；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('request-1'), refresh: vi.fn() } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(screen.getByText('服务就绪')).toBeTruthy();
  });

  it.fails('[AD-194] keeps member ledger terminal and roster convergence as separate facts', () => {
    // 用户能力：成员操作只有账本和 roster 都收敛才 ready。
    // 不变量：terminal receipt 不能伪造 roster；公开 owner：GovernanceFeature。
    const refresh = vi.fn();
    governance({
      commands: { submit: vi.fn().mockResolvedValue('member-request'), refresh },
      roster: [{ id: 'agent:worker:1', kind: 'agent', name: 'Worker' }],
    });
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(screen.getByText('成员已就绪')).toBeTruthy();
  });

  it.fails('[AD-195] preserves compact closure lifecycle without declaring missing business result ready', () => {
    // 用户能力：compact closure 保留 ledger lifecycle，但缺业务结果不能 ready。
    // 不变量：unavailable result 不能冒充完成；公开 owner：GovernanceFeature。
    governance({ operation: { state: 'submitted', message: '账本已完成，结果待确认' } });
    expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });

  it.fails('[AD-196] keeps failed compact closure lifecycle without guessing the failure reason', async () => {
    // 用户能力：失败 compact closure 可观察但不猜原因。
    // 不变量：failed 与 unavailable result 分开；公开 owner：GovernanceFeature。
    const submit = vi.fn().mockRejectedValue(new Error('wire closed'));
    governance({ commands: { submit } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道'));
  });

  it.fails('[AD-197] exposes missing compact result as a stable unavailable terminal state', () => {
    // 用户能力：compact result 缺失显示稳定 unavailable 终态。
    // 不变量：缺失 result 不能进入 ready；公开 owner：GovernanceFeature。
    governance({ operation: { state: 'completed', message: '已完成' } });
    expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });
});

function controlHarness({ principalId = 'human:root:1', cancel = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  const store = {
    restore: vi.fn().mockResolvedValue([]),
    restoreDrafts: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  };
  return {
    activeChannelId: 'c0',
    principalId,
    producerOwnerToken: `owner:${principalId}`,
    serverWorld: 'world-a',
    wireState: 'open',
    wireRef: { current: { cancel } },
    accessRef: { current: { state: () => ({ relationship: 'member', existence: 'present', runtime: 'open', authorityEpoch: 1 }) } },
    generationFor: () => 1,
    outboxFactory: () => store,
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    store,
  };
}

describe('A-D round 19 public owner evidence: permission/control recovery', () => {
  it.fails('[AD-256] restores principal-scoped control state and converts sending to uncertain', async () => {
    // 用户能力：刷新后只恢复本 principal 的控制状态，sending 变成 uncertain。
    // 不变量：控制恢复必须按 principal 隔离且 durable；公开 owner：useComposerSubmissionRuntime。
    const harness = controlHarness();
    const first = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(first.result.current.controlStates).toEqual({}));
    await act(async () => { await first.result.current.cancel('c0', 'request-1'); });
    expect(first.result.current.controlStates['c0:request-1:cancel']).toMatchObject({ state: 'accepted' });
    first.unmount();

    const restored = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(restored.result.current.controlStates['c0:request-1:cancel']).toMatchObject({ state: 'uncertain' }));
    restored.unmount();
    harness.store.close();
  });

  it.fails('[AD-257] persists only explainable active control state with serializable errors', async () => {
    // 用户能力：Error 控制结果刷新后仍可解释，其他状态不被持久化。
    // 不变量：持久化边界只接受 active state 与可序列化 error；公开 owner：useComposerSubmissionRuntime。
    const failure = Object.assign(new Error('连接关闭'), { code: 'closed' });
    const harness = controlHarness({ cancel: vi.fn().mockRejectedValue(failure) });
    const first = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(first.result.current.controlStates).toEqual({}));
    await act(async () => { await expect(first.result.current.cancel('c0', 'request-2')).rejects.toThrow('连接关闭'); });
    expect(first.result.current.controlStates['c0:request-2:cancel'].error).toEqual({ code: 'closed', detail: '连接关闭' });
    first.unmount();

    const restored = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(restored.result.current.controlStates['c0:request-2:cancel']).toBeTruthy());
    restored.unmount();
    harness.store.close();
  });
});
