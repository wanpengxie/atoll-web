// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// xterm 在 jsdom 里 open() 不了（要真 canvas）。这里替掉它——本组测的是
// **我们这一侧**的逻辑：连接、会话持久化、可见性、配色。而 options 仍由
// 我们的代码构造，所以 monoStack()/terminalTheme() 照样会被真调用，
// 那正是漏掉的那类错误的发生点。
const terminals = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) { this.options = options; this.cols = 80; this.rows = 24; this.selection = ''; this.addons = []; terminals.push(this); }
    loadAddon(addon) { this.addons.push(addon); }
    open() {}
    write() {}
    focus() {}
    dispose() {}
    hasSelection() { return Boolean(this.selection); }
    getSelection() { return this.selection; }
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class WebglAddon { onContextLoss() {} dispose() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalView } from '../src/ui/TerminalView.jsx';
import { resetPtyClient } from '../src/net/pty.js';

// 这组测试存在的理由：TerminalView 从头到尾没有被渲染过一次，于是一个
// "monoStack is not defined" 级别的错误可以同时通过 vite build 和全部
// 264 个用例，只在浏览器里炸。构建恒不检查这个，只有真渲染才检查。

const sockets = [];

class FakeWebSocket {
  static OPEN = 1;
  constructor(url) {
    this.url = url;
    // 真浏览器里 new 之后是 CONNECTING(0)，恒不是 OPEN。这个差别有意义：
    // 假成 OPEN 会让"连接已就绪就直接发"和"onopen 统一补发"两条路都触发。
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' }); }
  // 客户端发出的控制消息（JSON 文本帧）。
  get control() { return this.sent.filter((d) => typeof d === 'string').map((d) => JSON.parse(d)); }
  opens() { return this.control.filter((m) => m.type === 'open'); }
  reply(v) { this.onmessage?.({ data: JSON.stringify(v) }); }
}

beforeEach(() => {
  sockets.length = 0;
  terminals.length = 0;
  window.sessionStorage?.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  resetPtyClient();
  // jsdom 没有 canvas，xterm 的渲染器会走它自己的兜底；这里只关心组件挂载
  // 与副作用不抛错。
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('终端视图', () => {
  it('挂载不抛错，并在共享连接上按频道开一条流', async () => {
    render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    expect(new URL(sockets[0].url.replace(/^ws/, 'http')).pathname).toBe('/pty');
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(1));
    const open = sockets[0].opens()[0];
    expect(open.channel_id).toBe('c0');
    expect(open.id).toBeGreaterThan(0);
    expect(open.cols).toBeGreaterThan(0);
  });

  // 这条是这一版的核心承诺：开十个频道恒不是十条 WS。
  it('多块终端共用一条 WebSocket', async () => {
    const a = render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    render(<TerminalView channelId="c1" />);
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(2));
    expect(sockets.length, '第二块终端又开了一条连接').toBe(1);
    const ids = sockets[0].opens().map((m) => m.id);
    expect(new Set(ids).size, '两条流用了同一个流 id').toBe(2);
    a.unmount();
  });

  it('旧连接关闭握手完成前不创建下一条连接', async () => {
    const first = render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    const old = sockets[0];
    // 模拟真浏览器的异步 close：调用 close() 后，close 事件稍后才到。
    old.close = function closeLater() { this.readyState = 2; };
    first.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    render(<TerminalView channelId="c1" />);
    expect(sockets, '旧 socket 尚未 close 就创建了下一条').toHaveLength(1);

    old.onclose?.({ code: 1000, reason: '' });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
  });

  it('隐藏时恒不断开连接——切页签不是断线', async () => {
    const { rerender } = render(<TerminalView channelId="c0" visible />);
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    rerender(<TerminalView channelId="c0" visible={false} />);
    expect(sockets.length).toBe(1);
    expect(sockets[0].readyState).toBe(FakeWebSocket.OPEN);
  });

  it('canWrite 变化恒不重建连接——权限抖动不该丢掉正在跑的 shell', async () => {
    const { rerender } = render(<TerminalView channelId="c0" canWrite />);
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(1));
    rerender(<TerminalView channelId="c0" canWrite={false} />);
    expect(sockets[0].opens()).toHaveLength(1);
  });

  it('卸载走 detach 恒不走 close——切走频道恒不杀 shell', async () => {
    const view = render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(1));
    const id = sockets[0].opens()[0].id;
    sockets[0].reply({ type: 'ready', id, session: 'pty-abc' });
    view.unmount();
    const verbs = sockets[0].control.filter((m) => m.type === 'detach' || m.type === 'close');
    expect(verbs.map((m) => m.type), '卸载把 shell 杀了').toEqual(['detach']);
  });

  it('拿到 ready 后把 session 记下来，重新挂载时带上它', async () => {
    const view = render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(1));
    sockets[0].reply({ type: 'ready', id: sockets[0].opens()[0].id, session: 'pty-abc' });
    view.unmount();
    render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets[sockets.length - 1].opens().length).toBeGreaterThan(0));
    const last = sockets[sockets.length - 1].opens().at(-1);
    expect(last.session).toBe('pty-abc');
  });

  it('提供配色切换', () => {
    render(<TerminalView channelId="c0" />);
    expect(screen.getByRole('button', { name: /切到/ })).toBeTruthy();
  });
});

describe('会话已不在时的恢复', () => {
  it('死掉的 session 被拒 → 丢掉它重开，恒不无限重试同一个死 id', async () => {
    // 宽限期过了、或节点重启过，sessionStorage 里的 id 就指向一个不存在的会话。
    // 现在门会明说一条 error，恒不再需要靠"这次有没有拿到 ready"去猜。
    window.sessionStorage.setItem('atoll.terminal.session.c0', 'dead-session');
    render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(1));
    const first = sockets[0].opens()[0];
    expect(first.session).toBe('dead-session');

    sockets[0].reply({ type: 'error', id: first.id, code: 'not_found', detail: 'no such session' });
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(2));
    expect(sockets[0].opens()[1].session, '仍在用那个死 id 重试').toBeUndefined();
    expect(window.sessionStorage.getItem('atoll.terminal.session.c0')).toBeNull();
  });

  it('全新会话也连不上时恒不空转，给出可重试的终止态', async () => {
    render(<TerminalView channelId="c0" />);
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    for (let i = 0; i < 10; i += 1) {
      if (screen.queryByRole('button', { name: '重开' })) break;
      const ws = sockets[sockets.length - 1];
      await act(async () => {
        ws.onclose?.({ code: 1006, reason: '' });
        await vi.advanceTimersByTimeAsync(6000);
      });
    }
    expect(screen.getByRole('button', { name: '重开' }), '一直在空转重连，恒不给人一个出口').toBeTruthy();
  });

  it('shell 退出时只结束这一条流，恒不关整条连接', async () => {
    render(<TerminalView channelId="c0" />);
    render(<TerminalView channelId="c1" />);
    await vi.waitFor(() => expect(sockets[0].opens()).toHaveLength(2));
    const [first] = sockets[0].opens();
    sockets[0].reply({ type: 'exit', id: first.id, reason: 'shell exited' });
    expect(sockets[0].readyState, 'shell 退出把整条连接也关了').toBe(FakeWebSocket.OPEN);
  });
});

describe('WebGL 渲染器的分代', () => {
  it('卸载后到达的 WebGL 续体恒不再往死掉的终端上装载', async () => {
    const { unmount } = render(<TerminalView channelId="c0" />);
    const dead = terminals[terminals.length - 1];
    unmount();
    // 把动态 import 的微任务跑完。
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    const loadedWebgl = dead.addons.some((a) => a?.constructor?.name === 'WebglAddon');
    expect(loadedWebgl, '往已经 dispose 的终端装了 WebGL').toBe(false);
  });

  it('活着的终端照常装上 WebGL', async () => {
    render(<TerminalView channelId="c0" />);
    const live = terminals[terminals.length - 1];
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(live.addons.some((a) => a?.constructor?.name === 'WebglAddon')).toBe(true);
    expect(screen.queryByText(/GPU 渲染不可用/)).toBeNull();
  });
});
