// @vitest-environment jsdom
// Round 18 keeps each remaining A-D row at its current public owner.  The
// green cases exercise only behavior already owned by the current shell or
// governance panel.  `it.fails` cases are deliberate product-gap evidence;
// they are not counted as recovered rows.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChannelAdministrationPanel, ChannelCreateModal } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function session() {
  return { wireState: 'open', me: { id: 'human:root:1', display_name: 'Root' }, onLogout: vi.fn() };
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

function clickChannel(channelId) {
  const rail = screen.getByRole('navigation', { name: '频道' });
  fireEvent.click(within(rail).getByRole('button', { name: new RegExp(channelId) }));
}

describe('A-D round 18 public owner evidence: target handoff', () => {
  it('[AD-096] disables the committed channel terminal entry while target selection is pending', () => {
    // 用户能力：目标 workspace 尚未 commit 时旧频道终端入口立即不可用。
    // 不变量：terminal command 绑定 committed channel；公共 owner：WorkspaceLayout。
    const nav = navigation();
    renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    expect(nav.select).toHaveBeenCalledWith('c1');
    expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(true);
  });

  it('[AD-097] cancels a pending target when the user rapidly reselects the committed channel', () => {
    // 用户能力：A→B 未 commit 时可反选 A；不变量：只保留最新选择，不能重放 A 的导航副作用。
    // 公共 owner：WorkspaceLayout presentation handoff + canonical navigation port。
    const nav = navigation();
    renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    clickChannel('c0');
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1']);
    expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(false);
  });

  it('[AD-098] clears an old pending target after a committed third-channel fallback', async () => {
    // 用户能力：目录/路由 commit 第三频道后旧 target 不再控制 terminal。
    // 不变量：最新 committed identity supersedes pending；公共 owner：WorkspaceLayout。
    const nav = navigation();
    const view = renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    const fallback = navigation('c2');
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={fallback}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
    />);
    await waitFor(() => expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(false));
  });

  it.fails('[AD-099] ends the pending target when navigation rejects an invalid target and returns to origin', () => {
    // 用户能力：失效 target 先拒绝再回到原频道；不变量：失效 commit 不留 pending。
    // 公共 owner：WorkspaceLayout + navigation；当前 navigation 没有公开 rollback/fallback 事实。
    const nav = navigation();
    const view = renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    const rejected = navigation('c1', { channel: null });
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={rejected}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
    />);
    expect(screen.getByRole('heading', { name: 'c0' })).toBeTruthy();
  });

  it('[AD-101] publishes false message-surface visibility when mobile terminal covers it', () => {
    // 用户能力：窄屏终端覆盖消息面时公开 surface=false。
    // 不变量：覆盖状态是可观察事实；公共 owner：WorkspaceLayout。
    vi.stubGlobal('matchMedia', (query) => ({
      matches: query === '(max-width: 640px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const nav = navigation('c0', { terminalVisible: true });
    renderShell(nav);
    expect(screen.getByTestId('message-surface').getAttribute('data-surface-visible')).toBe('false');
  });

  it('[AD-105] hands off only the latest target in rapid A-to-B-to-A navigation', () => {
    // 用户能力：快速反选最终只由最新 target 交接。
    // 不变量：旧 pending 不抢焦点且不重放已提交 A；公共 owner：WorkspaceLayout。
    const nav = navigation();
    renderShell(nav);
    fireEvent.click(screen.getByText('c1'));
    clickChannel('c0');
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1']);
    expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(false);
  });

  it.fails('[AD-106] retains a channel terminal split when leaving and returning', () => {
    // 用户能力：切频道返回后保留该频道的 terminal split。
    // 不变量：terminal session/layout 按 channel 隔离；公共 owner：WorkspaceLayout + WorkspaceFeatures。
    const first = navigation('c0', { terminalVisible: true });
    const view = renderShell(first);
    const second = navigation('c1');
    view.rerender(<WorkspaceLayout session={session()} navigation={second} conversation={{ element: <div>消息</div> }} />);
    const returned = navigation('c0');
    view.rerender(<WorkspaceLayout session={session()} navigation={returned} conversation={{ element: <div>消息</div> }} />);
    expect(document.getElementById('workspace-panel-terminal')?.hidden).toBe(false);
  });

  it.fails('[AD-108] keeps one channel close from changing another channel visibility', () => {
    // 用户能力：收起 c0 分屏不影响 c1；不变量：visibility 是 channel-scoped。
    // 公共 owner：WorkspaceLayout + WorkspaceFeatures；当前 shell 只有 committed visibility。
    const first = navigation('c0', { terminalVisible: true });
    const view = renderShell(first);
    const second = navigation('c1', { terminalVisible: true });
    view.rerender(<WorkspaceLayout session={session()} navigation={second} conversation={{ element: <div>消息</div> }} />);
    const returned = navigation('c0');
    view.rerender(<WorkspaceLayout session={session()} navigation={returned} conversation={{ element: <div>消息</div> }} />);
    expect(document.getElementById('workspace-panel-terminal')?.hidden).toBe(false);
  });
});

describe('A-D round 18 public owner evidence: create failure and governance', () => {
  function governance({ commands = {}, ...rest } = {}) {
    return render(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0' }}
      port={{ commands, children: [], ...rest }}
      onClose={vi.fn()}
    />);
  }

  it.fails('[AD-149] opens an independent create dialog and focuses its name field', () => {
    // 用户能力：独立创建对话框打开即聚焦名称。
    // 不变量：dialog owner 负责 focus；公共 owner：当前 GovernanceFeature。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('新频道名称'));
  });

  it.fails('[AD-153] exposes four-step convergence and enters only after ready', () => {
    // 用户能力：创建过程分别展示账本/OBS/membership/serving，ready 后进入。
    // 不变量：ready 不是单一 command receipt；公共 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('request-1') } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(screen.getByRole('region', { name: '频道创建进度' })).toBeTruthy();
  });

  it('[AD-154] preserves input and permits retry after submit and ledger failure facts', async () => {
    // 用户能力：提交失败/账本失败后仍可重试且保留输入。
    // 不变量：失败生命周期不清空用户输入；公共 owner：ChannelCreateModal（频道创建弹窗）。
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('网络不可用'))
      .mockResolvedValueOnce('request-2')
      .mockResolvedValueOnce('request-3');
    const port = { commands: { submit }, children: [], creation: null };
    const { rerender } = render(<ChannelCreateModal channel={{ id: 'c0', qualified_name: 'c0' }} port={port} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'backend' } });
    fireEvent.change(screen.getByLabelText('频道用途'), { target: { value: '后端协作' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络不可用'));
    expect(screen.getByLabelText('新频道名称').value).toBe('backend');
    expect(screen.getByLabelText('频道用途').value).toBe('后端协作');

    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    rerender(<ChannelCreateModal
      channel={{ id: 'c0', qualified_name: 'c0' }}
      port={{ ...port, creation: { requestId: 'request-2', accepted: true, failed: true, error: '账本失败：名称已存在' } }}
      onClose={vi.fn()}
    />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('账本失败：名称已存在'));
    expect(screen.getByLabelText('新频道名称').value).toBe('backend');
    const retry = screen.getByRole('button', { name: '重新创建' });
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    expect(screen.getByLabelText('频道用途').value).toBe('后端协作');
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    expect(submit.mock.calls[2][0].payload).toMatchObject({ name: 'backend', purpose: '后端协作', parentId: 'c0' });
  });

  it.fails('[AD-155] provides dialog Escape/backdrop/focus-trap and returns focus after close', () => {
    // 用户能力：Escape/遮罩关闭、焦点闭环、关闭后焦点归还。
    // 不变量：独立 dialog owner 承担完整生命周期；公共 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.querySelector('.channel-create-backdrop')).toBeTruthy();
  });

  it('[AD-191] filters standard/foundation actors from roster and actor description candidates', () => {
    // 用户能力：治理成员列表不暴露 system 和运行时生成的成员。
    // 不变量：运行时生成的成员（body = generated）与描述里的成员分离；候选只来自
    // Actor 描述；公共 owner：ChannelAdministrationPanel。
    governance({
      commands: { submit: vi.fn(), refresh: vi.fn() },
      roster: [
        { id: 'human:root:1', kind: 'human', name: 'Root' },
        { id: 'agent:worker:1', kind: 'agent', name: 'Worker', body: 'class codex' },
        { id: 'system', kind: 'system', name: 'System', body: 'generated' },
        { id: 'registrar', kind: 'system', name: 'Registrar', body: 'generated' },
      ],
      actorDescriptions: [
        { id: 'd-worker-desc', name: 'worker-desc', version: 1, class: 'codex', status: 'present' },
      ],
    });
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    expect(screen.getByText('Root')).toBeTruthy();
    expect(screen.getByText('Worker')).toBeTruthy();
    expect(screen.queryByText('System')).toBeNull();
    expect(screen.queryByText('Registrar')).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: '选择参与者' }));
    expect(screen.getByRole('option', { name: /worker-desc @1/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Registrar|registrar/ })).toBeNull();
  });

  it('[AD-192] accepts only real human principals in the user selector', () => {
    // 用户能力：用户选择器只显示 registry 中的 human principal。
    // 不变量：agent/retired principal 不能被当作用户；公共 owner：WorkspaceApp governance port。
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
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(expect.arrayContaining(['root · 用户']));
    expect(screen.queryByRole('option', { name: /steward|retired/ })).toBeNull();
  });

  it.fails('[AD-193] waits for ledger, OBS, membership, and serving convergence after create', () => {
    // 用户能力：创建成功必须四方分别收敛。
    // 不变量：command receipt 不能代替 serving/membership facts；公共 owner：GovernanceFeature。
    const submit = vi.fn().mockResolvedValue('request-1');
    governance({ commands: { submit, refresh: vi.fn() } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(screen.getByText('服务就绪')).toBeTruthy();
  });

  it.fails('[AD-194] keeps member ledger terminal and roster convergence as separate facts', () => {
    // 用户能力：成员操作只有账本和 roster 都收敛才 ready。
    // 不变量：ledger terminal 不伪造 roster；公共 owner：GovernanceFeature。
    const refresh = vi.fn();
    governance({ commands: { submit: vi.fn().mockResolvedValue('member-request'), refresh }, roster: [{ id: 'agent:worker:1', kind: 'agent', name: 'Worker' }] });
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    fireEvent.click(screen.getByRole('button', { name: 'Worker' }));
    expect(refresh).toHaveBeenCalledWith('members');
  });

  it('[AD-195] preserves compact closure lifecycle without declaring missing business result ready', () => {
    // 用户能力：compact closure 保留 lifecycle，但缺业务结果不 ready。
    // 不变量：缺详情不能伪造 channel/member result；公共 owner：GovernanceFeature。
    governance({ operation: { state: 'submitted', message: '命令已进入提交队列' } });
    expect(screen.getByText('终态详情不可用，请刷新或重新进入频道')).toBeTruthy();
  });
});
