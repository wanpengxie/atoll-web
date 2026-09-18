// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// 频道是物理虚拟列表与其高度测量的边界。切频道必须换一棵树，阅读位置则由
// ViewSession 的语义 anchor 恢复；绝不把上一频道的 DOM 几何解释成当前频道。

let mounts = [];
vi.mock('../src/ui/ChannelList.jsx', () => ({ ChannelList: () => null }));
vi.mock('../src/ui/ArtifactsView.jsx', () => ({ ArtifactsView: () => null }));
vi.mock('../src/ui/TasksView.jsx', () => ({ TasksView: () => null }));
vi.mock('../src/ui/Composer.jsx', () => ({ Composer: () => null }));
vi.mock('../src/app/RightPanelHost.jsx', () => ({ RightPanelHost: () => null }));
vi.mock('../src/ui/Timeline.jsx', () => ({
  Timeline: () => {
    React.useEffect(() => { mounts.push('mount'); return () => mounts.push('unmount'); }, []);
    return <section id="workspace-panel-dynamic" role="tabpanel" aria-labelledby="workspace-tab-dynamic">消息</section>;
  },
}));
vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => {
  const { PresentationMessageList } = await import('./helpers/PresentationMessageList.jsx');
  return {
    MessageList(props) {
      const { reading, snapshot } = props;
      const lastDemandKey = React.useRef('');
      const status = reading.status || {};
      const demandKey = JSON.stringify([
        reading.activationID,
        snapshot.revision,
        status.attached === true,
        Number(status.generation || 0),
        status.hasOlder === true,
        status.loading === true,
        String(status.error || ''),
        Number(status.completedPages || 0),
        Number(status.revealVersion || 0),
      ]);
      React.useLayoutEffect(() => {
        if (snapshot.rows.length > 8 || status.attached !== true || status.hasOlder !== true) return;
        if (lastDemandKey.current === demandKey) return;
        lastDemandKey.current = demandKey;
        void reading.onUnderfill?.();
      }, [demandKey, reading, snapshot.rows.length, status.attached, status.hasOlder]);
      return <PresentationMessageList {...props} />;
    },
  };
});

const { AppShell } = await import('../src/app/AppShell.jsx');
const { Timeline } = await vi.importActual('../src/ui/Timeline.jsx');
const { createViewSessionStore } = await import('../src/model/view-session.js');

function shellProps(channelId) {
  return {
    session: { wireState: 'open', me: { id: 'root' }, onLogout: vi.fn() },
    navigation: {
      channels: [{ id: 'c0', access: 'member_active' }, { id: 'c1', access: 'member_active' }],
      activeChannelId: channelId, unread: {}, onSelect: vi.fn(), onCreate: vi.fn(),
      onSearch: vi.fn(), onActivity: vi.fn(), onSpaceManage: vi.fn(),
    },
    workspace: {
      channel: { id: channelId, name: channelId }, view: 'dynamic', onViewChange: vi.fn(), access: 'member_active',
      state: { channelId, turns: new Map(), lastSeq: 0 }, roster: [], selfId: 'root', pending: [],
      approvalStates: {}, controlStates: {}, capabilityIndex: new Map(), attachments: [],
      resources: {}, tasks: { items: [] }, agentSelection: {},
    },
    notices: {},
    panel: { value: '', open: vi.fn(), host: {} },
  };
}

afterEach(cleanup);

describe('切频道的消息区', () => {
  it('换频道就换一棵消息树，恒不复用同一个 DOM 容器', () => {
    mounts = [];
    const view = render(<AppShell {...shellProps('c0')} />);
    expect(mounts).toEqual(['mount']);
    view.rerender(<AppShell {...shellProps('c1')} />);
    // 没有按频道 key 时 React 只做一次 props 更新，挂载次数会停在 1。
    expect(mounts.filter((event) => event === 'mount')).toHaveLength(2);
  });

  // 上一版把 Timeline 的 key 写成了 activeChannelId——和它同一个父节点里的
  // Composer 撞了。React 明说重复 key「可能导致子节点被复制或被省略」，实测
  // 就是每切一次频道多出一整列消息区。只数挂载次数看不出来，必须数活着的棵数。
  it('反复切频道后，消息区恒只有一棵', () => {
    mounts = [];
    const view = render(<AppShell {...shellProps('c0')} />);
    for (let i = 0; i < 6; i += 1) {
      view.rerender(<AppShell {...shellProps(i % 2 ? 'c1' : 'c0')} />);
    }
    expect(document.querySelectorAll('#workspace-panel-dynamic')).toHaveLength(1);
  });

  // React 对重复 key 只发 console.error，恒不抛错——所以它可以在全绿的测试里
  // 一路滑到线上。这条把那声警告变成硬失败。
  it('消息区这一层恒不出现重复 key 警告', () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    try {
      const view = render(<AppShell {...shellProps('c0')} />);
      view.rerender(<AppShell {...shellProps('c1')} />);
      view.rerender(<AppShell {...shellProps('c0')} />);
    } finally {
      spy.mockRestore();
    }
    expect(errors.filter((line) => line.includes('same key')), errors.join(' | ')).toHaveLength(0);
  });
});

describe('历史自动懒加载', () => {
  function managedHistory(status = {}, ports = {}) {
    return { ...ports, status: { ...status } };
  }

  function historyState(count = 160, startSeq = 1) {
    const standalone = Array.from({ length: count }, (_, index) => ({
      seq: startSeq + index,
      envelope: { id: `history-${startSeq + index}`, kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: `历史 ${startSeq + index}` } },
    }));
    return { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: startSeq + count - 1 };
  }

  it('后台蓄水池增长不推动可见列表，且不存在手动加载按钮', async () => {
    const view = render(<Timeline state={historyState(120)} history={managedHistory({ hasOlder: true, buffered: 0 })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    expect(await screen.findByText('历史 120')).toBeTruthy();
    const before = view.container.querySelectorAll('.standalone-row').length;
    view.rerender(<Timeline state={historyState(120)} history={managedHistory({ hasOlder: true, buffered: 5_000 })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    expect(view.container.querySelectorAll('.standalone-row').length).toBe(before);
    expect(document.body.textContent).not.toContain('查看更早动态');
  });

  it('测试端口把调度事实放在 status，动作保留为顶层 port', () => {
    const loadOlder = vi.fn();
    const history = managedHistory({ attached: true, hasOlder: true }, { loadOlder });
    expect(history).not.toHaveProperty('attached');
    expect(history).not.toHaveProperty('hasOlder');
    expect(history.status).toEqual({ attached: true, hasOlder: true });
    expect(history.loadOlder).toBe(loadOlder);
  });

  it('短首屏已经触顶时自动释放一批 reservoir', async () => {
    const loadOlder = vi.fn(async () => ({ kind: 'exhausted' }));
    render(<Timeline state={historyState(4)} history={managedHistory({ attached: true, messageCurrent: true, hasOlder: true, buffered: 5_000 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledOnce());
    expect(loadOlder.mock.calls[0][0]).toMatchObject({ anchorSeq: 1 });
  });

  it('短视口只在 attach 明确公布 hasOlder 后建立欠供给 demand', async () => {
    let finish;
    const loadOlder = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const state = historyState(4, 100);
    const view = render(<Timeline state={state} history={managedHistory({ attached: false, hasOlder: false, buffered: 0 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadOlder).not.toHaveBeenCalled();

    // The scheduler's authoritative attach transition, rather than the
    // virtualizer's initial zero window, establishes the persistent duty.
    view.rerender(<Timeline state={state} history={managedHistory({ attached: true, messageCurrent: true, hasOlder: true, buffered: 5_000 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledOnce());
    finish({ kind: 'exhausted' });
  });

  it('attach 前的非权威 false 不会封死 attach 后的同一欠供给视口', async () => {
    const loadOlder = vi.fn().mockResolvedValue({ kind: 'satisfied', firstVisibleSeq: 68 });
    const state = historyState(4, 100);
    const view = render(<Timeline state={state} history={managedHistory({ attached: false, hasOlder: false, buffered: 0 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadOlder).not.toHaveBeenCalled();
    view.rerender(<Timeline state={state} history={managedHistory({ attached: true, messageCurrent: true, generation: 2, hasOlder: true, buffered: 16 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledOnce());
  });

  it('失败后的scheduler状态推进会重新兑现同一欠供给义务', async () => {
    const loadOlder = vi.fn()
      .mockResolvedValueOnce({ kind: 'failed', error: new Error('temporary') })
      .mockResolvedValueOnce({ kind: 'satisfied', firstVisibleSeq: 68 });
    const state = historyState(4, 100);
    const view = render(<Timeline state={state} history={managedHistory({ attached: true, messageCurrent: true, generation: 1, hasOlder: true, loading: false, error: '' }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1));
    // Let the failed operation release its in-flight ownership before the
    // scheduler publishes the next status revision. The old global observer
    // shim accidentally supplied this turn; the semantic contract requires it
    // explicitly and still demands exactly one retry from the new revision.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The scheduler owns retry timing. Its published loading/error transition,
    // not a viewport poller, re-drives the persistent coverage obligation.
    view.rerender(<Timeline state={state} history={managedHistory({ attached: true, messageCurrent: true, generation: 1, hasOlder: true, loading: true, error: 'temporary' }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(2));
  });

  it('scheduler 兑现 demand 且真正 prepend 可见项后不重复消费 reservoir', async () => {
    let finish;
    const loadOlder = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<Timeline state={historyState(4, 100)} history={managedHistory({ attached: true, messageCurrent: true, hasOlder: true, buffered: 0 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1));
    view.rerender(<Timeline state={historyState(36, 68)} history={managedHistory({ attached: true, messageCurrent: true, hasOlder: true, buffered: 16 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    finish({ kind: 'satisfied', firstVisibleSeq: 68 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('隐藏行导致 rerender 时仍由同一个顶部 operation 持有 continuation', async () => {
    let finish;
    const loadOlder = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const initial = historyState(4, 100);
    const view = render(<Timeline state={initial} history={managedHistory({ attached: true, messageCurrent: true, hasOlder: true, buffered: 0 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1));

    const hidden = {
      seq: 90,
      envelope: { id: 'hidden-session', kind: 'event', type: 'terminal.session', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { event: 'closed' } },
    };
    const next = {
      ...initial,
      rows: new Map([[hidden.seq, hidden.envelope], ...initial.rows]),
      standalone: [hidden, ...initial.standalone],
    };
    view.rerender(<Timeline state={next} history={managedHistory({ attached: true, messageCurrent: true, hasOlder: true, buffered: 16 }, { loadOlder })} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    finish({ kind: 'exhausted' });
  });

  it('频道 DOM 重挂后从 View Session 恢复阅读范围', async () => {
    const sessions = createViewSessionStore();
    const props = {
      state: historyState(4),
      history: managedHistory({ attached: true, hasOlder: false }),
      viewSessions: sessions,
      roster: [],
      selfId: 'me',
      pending: [],
      approvalStates: {},
      access: 'member_active',
    };
    const first = render(<Timeline {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '@我' }));
    expect(await screen.findByRole('button', { name: '全部' })).toBeTruthy();
    await vi.waitFor(() => expect(sessions.read('c0').scope).toBe('all'));
    first.unmount();

    render(<Timeline {...props} />);
    expect(await screen.findByRole('button', { name: '全部' })).toBeTruthy();
  });
});
