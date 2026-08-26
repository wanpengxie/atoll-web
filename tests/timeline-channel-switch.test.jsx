// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

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

describe('退场残影的回收', () => {
  const originals = {};
  let finished;

  beforeEach(() => {
    finished = 0;
    originals.ro = globalThis.ResizeObserver;
    originals.io = globalThis.IntersectionObserver;
    originals.animate = Element.prototype.animate;
    originals.getAnimations = Element.prototype.getAnimations;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    Element.prototype.animate = function animate() {
      return { addEventListener() {}, cancel() {}, finish() {}, play() {}, pause() {} };
    };
    // 一条还没播完的退场动画：卸载时必须被强制结束，才会走 auto-animate 自己的
    // finish 回调把残影摘掉。
    Element.prototype.getAnimations = () => [{ finish() { finished += 1; } }];
  });

  afterEach(() => {
    globalThis.ResizeObserver = originals.ro;
    globalThis.IntersectionObserver = originals.io;
    Element.prototype.animate = originals.animate;
    if (originals.getAnimations) Element.prototype.getAnimations = originals.getAnimations;
    else delete Element.prototype.getAnimations;
  });

  it('卸载消息区时强制结束未播完的退场动画', () => {
    const state = { channelId: 'c0', rows: new Map(), turns: new Map(), standalone: [], orphans: [], narration: [], lastSeq: 0 };
    const view = render(<Timeline state={state} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    expect(document.querySelector('.timeline-inner')?.dataset.layoutMotion).toBe('ready');
    expect(finished).toBe(0);
    view.unmount();
    expect(finished).toBe(1);
  });
});

describe('历史自动懒加载', () => {
  function historyState(count = 160) {
    const standalone = Array.from({ length: count }, (_, index) => ({
      seq: index + 1,
      envelope: { id: `history-${index + 1}`, kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'me', kind: 'human' }, payload: { text: `历史 ${index + 1}` } },
    }));
    return { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: count };
  }

  function timelineGeometry({ clientHeight, scrollHeight }) {
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList?.contains('timeline') ? clientHeight : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.classList?.contains('timeline') ? scrollHeight : 0; } });
    return () => {
      if (client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', client);
      else delete HTMLElement.prototype.clientHeight;
      if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scroll);
      else delete HTMLElement.prototype.scrollHeight;
    };
  }

  it('首屏不足一屏也保持最新位置，后台蓄水池增长不推动 DOM', async () => {
    const restore = timelineGeometry({ clientHeight: 600, scrollHeight: 400 });
    const onRevealHistory = vi.fn();
    try {
      const view = render(<Timeline state={historyState(120)} history={{ hasOlder: true, buffered: 0 }} onRevealHistory={onRevealHistory} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
      view.rerender(<Timeline state={historyState(120)} history={{ hasOlder: true, buffered: 5_000 }} onRevealHistory={onRevealHistory} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(view.container.querySelectorAll('.standalone-row')).toHaveLength(120);
      expect(onRevealHistory).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('查看更早动态');
    } finally {
      restore();
    }
  });

  it('首屏已经溢出时停在最新处且不由 Timeline 发起历史 I/O', async () => {
    const restore = timelineGeometry({ clientHeight: 600, scrollHeight: 1_200 });
    const onRevealHistory = vi.fn();
    try {
      render(<Timeline state={historyState(120)} history={{ hasOlder: true, buffered: 40 }} onRevealHistory={onRevealHistory} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
      const timeline = document.querySelector('.timeline');
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(onRevealHistory).not.toHaveBeenCalled();
      expect(timeline.scrollTop).toBe(600);
      timeline.scrollTop = 0;
      fireEvent.scroll(timeline);
      expect(onRevealHistory).toHaveBeenCalledWith(32);
    } finally {
      restore();
    }
  });

  it('用户先到顶、历史后到达时自动兑现已经发生的读取意图', async () => {
    const restore = timelineGeometry({ clientHeight: 600, scrollHeight: 1_200 });
    let available = false;
    const onRevealHistory = vi.fn(() => available ? 32 : 0);
    try {
      const view = render(<Timeline state={historyState(120)} history={{ hasOlder: true, buffered: 0 }} onRevealHistory={onRevealHistory} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
      const timeline = document.querySelector('.timeline');
      await new Promise((resolve) => setTimeout(resolve, 120));
      timeline.scrollTop = 0;
      fireEvent.scroll(timeline);
      expect(onRevealHistory).toHaveBeenCalledTimes(1);
      expect(onRevealHistory).toHaveLastReturnedWith(0);

      available = true;
      view.rerender(<Timeline state={historyState(120)} history={{ hasOlder: true, buffered: 32 }} onRevealHistory={onRevealHistory} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
      await vi.waitFor(() => expect(onRevealHistory).toHaveBeenCalledTimes(2));
      expect(onRevealHistory).toHaveLastReturnedWith(32);
    } finally {
      restore();
    }
  });
});
