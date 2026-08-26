// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// 切频道时消息区必须换一棵新的树。auto-animate 的退场动画会把 React 已经删掉的
// 节点按 position:absolute / z-index:100 插回容器，只靠动画的 finish 事件回收；
// 整频道换血时那批动画一旦没走完，残影就永久压在新内容上（表现为文字重叠，且
// 此后切任何频道都是同一屏）。这两条测试锁住两道防线：按频道重挂、卸载时清残影。

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

const { AppShell } = await import('../src/app/AppShell.jsx');
const { Timeline } = await vi.importActual('../src/ui/Timeline.jsx');

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
  function historyState(count = 160, startSeq = 1) {
    const standalone = Array.from({ length: count }, (_, index) => ({
      seq: startSeq + index,
      envelope: { id: `history-${startSeq + index}`, kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: `历史 ${startSeq + index}` } },
    }));
    return { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: startSeq + count - 1 };
  }

  it('后台蓄水池增长不推动可见列表，且不存在手动加载按钮', async () => {
    const view = render(<Timeline state={historyState(120)} history={{ hasOlder: true, buffered: 0 }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    expect(await screen.findByText('历史 1')).toBeTruthy();
    const before = view.container.querySelectorAll('.standalone-row').length;
    view.rerender(<Timeline state={historyState(120)} history={{ hasOlder: true, buffered: 5_000 }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    expect(view.container.querySelectorAll('.standalone-row').length).toBe(before);
    expect(document.body.textContent).not.toContain('查看更早动态');
  });

  it('短首屏已经触顶时自动释放一批 reservoir', async () => {
    const loadOlder = vi.fn(async () => ({ kind: 'exhausted' }));
    render(<Timeline state={historyState(4)} history={{ hasOlder: true, buffered: 5_000, loadOlder }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledOnce());
    expect(loadOlder.mock.calls[0][0]).toMatchObject({ anchorSeq: 1 });
  });

  it('attach 前建立的顶部 demand 不会被挂载 effect 或短列表的 bottom 状态清掉', async () => {
    let finish;
    const loadOlder = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const state = historyState(4, 100);
    const view = render(<Timeline state={state} history={{ attached: false, hasOlder: false, buffered: 0, loadOlder }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1));

    // Meta/IDB settles after Virtuoso has already reported both top and bottom.
    // The original operation remains the sole owner; rerender cannot replace it.
    view.rerender(<Timeline state={state} history={{ attached: true, hasOlder: true, buffered: 5_000, loadOlder }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    finish({ kind: 'exhausted' });
  });

  it('scheduler 兑现 demand 且真正 prepend 可见项后不重复消费 reservoir', async () => {
    let finish;
    const loadOlder = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<Timeline state={historyState(4, 100)} history={{ attached: true, hasOlder: true, buffered: 0, loadOlder }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1));
    view.rerender(<Timeline state={historyState(36, 68)} history={{ attached: true, hasOlder: true, buffered: 16, loadOlder }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    finish({ kind: 'satisfied', firstVisibleSeq: 68 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('隐藏行导致 rerender 时仍由同一个顶部 operation 持有 continuation', async () => {
    let finish;
    const loadOlder = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const initial = historyState(4, 100);
    const view = render(<Timeline state={initial} history={{ attached: true, hasOlder: true, buffered: 0, loadOlder }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
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
    view.rerender(<Timeline state={next} history={{ attached: true, hasOlder: true, buffered: 16, loadOlder }} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    finish({ kind: 'exhausted' });
  });

  it('成员过滤按钮在 Virtuoso 时间线中可点击并收窄条目', async () => {
    const standalone = ['agent-a', 'agent-b'].map((agentId, index) => ({
      seq: index + 1,
      envelope: {
        id: `from-${agentId}`,
        kind: 'event',
        type: 'human.note',
        visibility: 'public',
        sender: { id: agentId, kind: 'agent' },
        audience: ['me'],
        payload: { text: `来自 ${agentId}` },
      },
    }));
    const state = {
      channelId: 'c0',
      rows: new Map(standalone.map((row) => [row.seq, row.envelope])),
      turns: new Map(),
      standalone,
      orphans: [],
      narration: [],
      lastSeq: 2,
    };
    render(<Timeline state={state} history={{ attached: true, hasOlder: false }} roster={[{ id: 'agent-a', kind: 'agent' }, { id: 'agent-b', kind: 'agent' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);

    fireEvent.click(await screen.findByTitle('只看我与 agent-a 的往来'));
    expect(screen.getByTitle('取消只看 agent-a').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('来自 agent-a')).toBeTruthy();
    expect(screen.queryByText('来自 agent-b')).toBeNull();
  });
});
