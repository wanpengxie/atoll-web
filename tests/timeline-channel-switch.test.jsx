// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

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

describe('历史懒加载滚动门槛', () => {
  it('首屏临时位于顶部不读取历史，离开顶部再返回才读取', async () => {
    const state = { channelId: 'c0', rows: new Map(), turns: new Map(), standalone: [], orphans: [], narration: [], lastSeq: 0 };
    const onLoadOlder = vi.fn(() => Promise.resolve());
    render(<Timeline state={state} history={{ hasOlder: true }} onLoadOlder={onLoadOlder} roster={[]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
    const timeline = document.querySelector('.timeline');

    timeline.scrollTop = 0;
    fireEvent.scroll(timeline);
    expect(onLoadOlder).not.toHaveBeenCalled();

    timeline.scrollTop = 300;
    fireEvent.scroll(timeline);
    timeline.scrollTop = 0;
    fireEvent.scroll(timeline);
    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledTimes(1));
  });
});
