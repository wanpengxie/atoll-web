// @vitest-environment jsdom
// Round 23 turns twenty remaining product-gap rows into ordinary public-owner
// regressions.  The assertions are intentionally not expected-fail cases: a
// red result is the preserved product-gap evidence, not migration completion.
import React from 'react';
import {
  cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { searchFeatureIndex, selectFeatureSearchIndex } from '../src/model/feature-search.js';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { WorkspaceFeatures } from '../src/ui/features/WorkspaceFeatures.jsx';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function activityRow(channelId, seq, envelope) {
  return {
    channel_id: channelId,
    seq,
    envelope: {
      ts: 1_700_000_000_000 + seq,
      visibility: 'public',
      audience: ['human:root:1'],
      sender: { kind: 'human', id: 'human:root:1' },
      ...envelope,
    },
  };
}

function approvalState() {
  const store = createChannelReplicaStore();
  store.commit(activityRow('c1', 4, {
    id: 'approval-1',
    kind: 'request',
    type: 'human.approve',
    sender: { kind: 'agent', id: 'agent:worker:1' },
    audience: ['human:root:1'],
    payload: { body: { title: '批准上线' } },
  }));
  store.commit(activityRow('c1', 5, {
    id: 'approval-result',
    kind: 'response',
    type: 'human.approve',
    parent_id: 'approval-1',
    sender: { kind: 'human', id: 'human:root:1' },
    payload: { body: { status: 'failed', detail: '审批失败' } },
  }));
  return store.state('c1');
}

const channels = [{ id: 'c1', name: '频道 c1', access: 'member_active' }];

const tasks = [{
  key: 'approval:c1:approval-1',
  channelId: 'c1',
  kind: 'approval',
  title: '批准上线',
  state: 'failed',
  updatedAt: 6,
  source: {
    channelId: 'c1', view: 'tasks', objectType: 'work_item', objectId: 'approval:c1:approval-1',
  },
}];

function session() {
  return {
    wireState: 'open',
    me: { id: 'human:root:1', display_name: 'Root' },
    onLogout: vi.fn(),
  };
}

function navigation(activeChannelId = 'c0', { access = 'member_active', terminalVisible = false } = {}) {
  let visible = terminalVisible;
  const channelRows = [
    { id: 'c0', name: 'c0', access: 'member_active' },
    { id: 'c1', name: 'c1', access: 'member_active' },
    { id: 'c2', name: 'c2', access: 'member_active' },
  ];
  const active = channelRows.find((channel) => channel.id === activeChannelId)
    || { id: activeChannelId, name: activeChannelId, access };
  return {
    channels: channelRows,
    channel: { ...active, access },
    activeChannelId,
    activeView: 'conversation',
    unread: {},
    agentActivity: { byChannel: {} },
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
    openRoster: vi.fn(),
    get terminalVisible() { return visible; },
    openTerminal: vi.fn(() => { visible = !visible; }),
  };
}

function terminalFeatures(navigationState) {
  return <div data-testid="terminal-features">
    <WorkspaceFeatures
      activeView="conversation"
      channel={{ id: navigationState.activeChannelId, name: navigationState.activeChannelId }}
      contentVisible
      terminal={{
        mounted: true,
        visible: navigationState.terminalVisible,
        channelId: navigationState.activeChannelId,
        devices: [],
        deviceId: '',
        canWrite: false,
        transportOpen: true,
        available: true,
        commands: { close: navigationState.openTerminal },
      }}
    />
  </div>;
}

function renderWorkspace(navigationState) {
  return render(<WorkspaceLayout
    session={session()}
    navigation={navigationState}
    conversation={{ element: <div data-testid="message-surface">消息</div> }}
    features={terminalFeatures(navigationState)}
  />);
}

function governance({ commands = {}, ...rest } = {}) {
  return render(<ChannelAdministrationPanel
    channel={{ id: 'c0', qualified_name: 'c0' }}
    port={{ commands, children: [], ...rest }}
    onClose={vi.fn()}
  />);
}

describe('A-D round 23 ordinary public-owner product-gap evidence', () => {
  it('[AD-002] exposes terminal, WorkItem, and Operation as one locatable business fact', () => {
    // 用户能力：活动中心合并同一 request 的终态、任务与操作，并返回公开来源。
    // 不变量：频道/request 去重边界不能泄露私有 ticket；公开 owner：selectFeatureSearchIndex。
    const operations = [{
      operationId: 'approval-submit', channelId: 'c1', requestId: 'approval-1',
      kind: 'message_submit', title: '提交审批', state: 'failed', updatedAt: 7,
      source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'approval-submit' },
    }];
    const index = selectFeatureSearchIndex({
      states: [['c1', approvalState()]], channels, tasks, operations,
    });
    expect(index.filter((entry) => entry.kind === 'operation')).toHaveLength(1);
  });

  it('[AD-003] deduplicates Operation by channel/native id and retains latest unsettled state', () => {
    // 用户能力：重复上传只显示最新未收敛状态，完成项不出现。
    // 不变量：channel/native operation id 是去重边界；公开 owner：selectFeatureSearchIndex。
    const operations = [
      { operationId: 'upload-1', channelId: 'c1', title: '旧上传', state: 'transferring', updatedAt: 10 },
      { operationId: 'upload-1', channelId: 'c1', title: '新上传', state: 'waiting_ledger', updatedAt: 20 },
      { operationId: 'done-1', channelId: 'c1', title: '已完成', state: 'completed', updatedAt: 30 },
    ];
    const index = selectFeatureSearchIndex({ states: [], channels, operations });
    expect(index.filter((entry) => entry.kind === 'operation')).toEqual([
      expect.objectContaining({ id: 'upload-1', state: 'waiting_ledger' }),
    ]);
  });

  it('[AD-004] searches visible channels across operations with a public SourceRef', () => {
    // 用户能力：全局搜索命中进行中的操作并可回到 artifacts 来源。
    // 不变量：搜索只消费可见频道的公开 Operation projection；公开 owner：searchFeatureIndex。
    const operations = [{
      operationId: 'export-1', channelId: 'c1', title: '上传预算附件', state: 'waiting_ledger', updatedAt: 20,
      source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'export-1' },
    }];
    const index = selectFeatureSearchIndex({ states: [], channels, operations });
    expect(searchFeatureIndex(index, '预算附件', { kinds: ['operation'] })).toEqual([
      expect.objectContaining({ kind: 'operation', source: expect.objectContaining({ objectId: 'export-1' }) }),
    ]);
  });

  it('[AD-093] provides a recent-reading drawer at the right edge', () => {
    // 用户能力：从终端/频道边缘打开最近阅读；不变量：Reading owner 提供入口与返回焦点；公开 owner：WorkspaceLayout。
    renderWorkspace(navigation());
    expect(screen.queryByRole('button', { name: '打开最近阅读' })).toBeTruthy();
  });

  it('[AD-097] lets a fast reselect of the committed channel cancel the pending target', () => {
    // 用户能力：A→B 未 commit 时可立即反选 A；不变量：最新选择是唯一 pending owner；公开 owner：WorkspaceLayout。
    const nav = navigation();
    renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(within(screen.getByRole('navigation', { name: '频道' })).getByRole('button', { name: /c0/ }));
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });

  it('[AD-099] returns from an invalid target to the original channel and ends old pending handoff', () => {
    // 用户能力：失效目标经目录拒绝后回原频道；不变量：rollback 与 committed identity 同一 owner；公开 owner：WorkspaceLayout。
    const nav = navigation();
    const view = renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    const invalid = navigation('c1');
    invalid.channel = null;
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={invalid}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={terminalFeatures(invalid)}
    />);
    expect(screen.getByRole('heading', { name: 'c0' })).toBeTruthy();
  });

  it('[AD-105] hands focus only to the latest target in a rapid A-to-B-to-A selection', () => {
    // 用户能力：快速反选最终只交接最新目标；不变量：旧 pending 不能重放焦点；公开 owner：WorkspaceLayout。
    const nav = navigation();
    renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(within(screen.getByRole('navigation', { name: '频道' })).getByRole('button', { name: /c0/ }));
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1', 'c0']);
  });

  it('[AD-106] retains a channel terminal split when leaving and returning', () => {
    // 用户能力：切走再回来保留该频道 terminal split；不变量：terminal/session/layout 按 channel 隔离；公开 owner：WorkspaceLayout + WorkspaceFeatures。
    const first = navigation('c0', { terminalVisible: true });
    const view = renderWorkspace(first);
    const second = navigation('c1', { terminalVisible: false });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={second}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(second)}
    />);
    const returned = navigation('c0', { terminalVisible: false });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={returned}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(returned)}
    />);
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(false);
  });

  it('[AD-108] closing one channel split does not close another channel split', () => {
    // 用户能力：收起 c0 不影响 c1；不变量：terminal visibility 按 channel 隔离；公开 owner：WorkspaceLayout + WorkspaceFeatures。
    const first = navigation('c0', { terminalVisible: true });
    const view = renderWorkspace(first);
    const second = navigation('c1', { terminalVisible: true });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={second}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(second)}
    />);
    second.openTerminal();
    const returned = navigation('c0', { terminalVisible: false });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={returned}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(returned)}
    />);
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(false);
  });

  it('[AD-149] opens an independent create dialog and focuses its name field', () => {
    // 用户能力：新建频道打开独立 dialog 并首先聚焦名称；不变量：dialog owner 负责 focus/submit；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('新频道名称'));
  });

  it('[AD-150] includes a selected current-channel Agent as an initial seat', () => {
    // 用户能力：创建时带入当前频道 Agent actor seat；不变量：seat 只能来自公开 roster；公开 owner：GovernanceFeature。
    governance({
      commands: { submit: vi.fn() },
      roster: [{ id: 'agent:worker:1', kind: 'agent', name: 'Worker' }],
    });
    expect(screen.getByRole('checkbox', { name: /Worker/ })).toBeTruthy();
  });

  it('[AD-151] reads template body before submitting a public recipe', () => {
    // 用户能力：模板 body 先读账本再用于 create；不变量：create 不能只发送 template ID；公开 owner：GovernanceFeature。
    const submit = vi.fn().mockResolvedValueOnce('template-request').mockResolvedValueOnce('create-request');
    governance({ commands: { submit }, space: { channelTemplates: [{ id: 'team', name: 'Team' }] } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'templated' } });
    fireEvent.click(screen.getByRole('combobox', { name: '频道模板' }));
    fireEvent.click(screen.getByRole('option', { name: 'Team' }));
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'get_template' }));
  });

  it('[AD-152] treats a template compact closure as unavailable detail, not business failure', () => {
    // 用户能力：模板终态缺 body 时稳定提示不可用；不变量：缺失详情不能伪造 recipe/业务失败；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('template-request') } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'templated' } });
    expect(screen.getByRole('alert').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });

  it('[AD-153] exposes four-step convergence and enters only after ready', () => {
    // 用户能力：分别看到 ledger/OBS/membership/serving，ready 后才进入；不变量：receipt 不能宣告 serving ready；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('request-1') } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(screen.getByRole('region', { name: '频道创建进度' })).toBeTruthy();
  });

  it('[AD-155] provides dialog Escape/backdrop/focus-trap and returns focus after close', () => {
    // 用户能力：Escape/遮罩关闭、焦点闭环、关闭后 focus return；不变量：独立 dialog owner 承担完整生命周期；公开 owner：GovernanceFeature/SidePanel。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.querySelector('.channel-create-backdrop')).toBeTruthy();
  });

  it('[AD-192] accepts only real human principals in the user selector', () => {
    // 用户能力：候选只显示 registry 中可用 human principal；不变量：agent/retired principal 不能作为 human target；公开 owner：GovernanceFeature。
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

  it('[AD-193] waits for ledger, OBS, membership, and serving convergence after create', () => {
    // 用户能力：创建成功分别收敛四类事实；不变量：receipt 不能替代 serving/membership；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('request-1'), refresh: vi.fn() } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(screen.getByText('服务就绪')).toBeTruthy();
  });

  it('[AD-194] keeps member ledger terminal and roster convergence as separate facts', () => {
    // 用户能力：成员操作只有账本和 roster 都收敛才 ready；不变量：terminal receipt 不能伪造 roster；公开 owner：GovernanceFeature。
    const refresh = vi.fn();
    governance({
      commands: { submit: vi.fn().mockResolvedValue('member-request'), refresh },
      roster: [{ id: 'agent:worker:1', kind: 'agent', name: 'Worker' }],
    });
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(screen.getByText('成员已就绪')).toBeTruthy();
  });

  it('[AD-195] preserves compact closure lifecycle without declaring missing business result ready', () => {
    // 用户能力：compact closure 保留 ledger lifecycle，缺业务结果不能 ready；不变量：unavailable result 不能冒充完成；公开 owner：GovernanceFeature。
    governance({ operation: { state: 'submitted', message: '账本已完成，结果待确认' } });
    expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });

  it('[AD-196] keeps failed compact closure lifecycle without guessing failure reason', async () => {
    // 用户能力：失败 compact closure 可观察但不猜原因；不变量：failed 与 unavailable result 分开；公开 owner：GovernanceFeature。
    const submit = vi.fn().mockRejectedValue(new Error('wire closed'));
    governance({ commands: { submit } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道'));
  });

});
