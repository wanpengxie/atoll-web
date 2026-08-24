// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// xterm 在 jsdom 里 open() 不了（要真 canvas）。这里替掉它——本组测的是
// **我们这一侧**的逻辑：连接、会话持久化、可见性、配色。而 options 仍由
// 我们的代码构造，所以 monoStack()/terminalTheme() 照样会被真调用，
// 那正是漏掉的那类错误的发生点。
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) { this.options = options; this.cols = 80; this.rows = 24; }
    loadAddon() {}
    open() {}
    write() {}
    focus() {}
    dispose() {}
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalView } from '../src/ui/TerminalView.jsx';

// 这组测试存在的理由：TerminalView 从头到尾没有被渲染过一次，于是一个
// "monoStack is not defined" 级别的错误可以同时通过 vite build 和全部
// 264 个用例，只在浏览器里炸。构建恒不检查这个，只有真渲染才检查。

const sockets = [];

class FakeWebSocket {
  static OPEN = 1;
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.sent = [];
    sockets.push(this);
  }
  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' }); }
}

beforeEach(() => {
  sockets.length = 0;
  window.sessionStorage?.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  // jsdom 没有 canvas，xterm 的渲染器会走它自己的兜底；这里只关心组件挂载
  // 与副作用不抛错。
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('终端视图', () => {
  it('挂载不抛错，并按频道发起 /pty 连接', () => {
    render(<TerminalView channelId="c0" />);
    expect(sockets.length).toBe(1);
    const url = new URL(sockets[0].url.replace(/^ws/, 'http'));
    expect(url.pathname).toBe('/pty');
    expect(url.searchParams.get('channel_id')).toBe('c0');
    expect(Number(url.searchParams.get('cols'))).toBeGreaterThan(0);
  });

  it('隐藏时恒不断开连接——切页签不是断线', () => {
    const { rerender } = render(<TerminalView channelId="c0" visible />);
    const opened = sockets.length;
    rerender(<TerminalView channelId="c0" visible={false} />);
    expect(sockets.length).toBe(opened);
    expect(sockets[0].readyState).toBe(FakeWebSocket.OPEN);
  });

  it('canWrite 变化恒不重建连接——权限抖动不该丢掉正在跑的 shell', () => {
    const { rerender } = render(<TerminalView channelId="c0" canWrite />);
    const opened = sockets.length;
    rerender(<TerminalView channelId="c0" canWrite={false} />);
    expect(sockets.length).toBe(opened);
  });

  it('拿到 ready 后把 session 记下来，重连时带上它', () => {
    const { unmount } = render(<TerminalView channelId="c0" />);
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready', session: 'pty-abc' }) });
    unmount();
    render(<TerminalView channelId="c0" />);
    const url = new URL(sockets[sockets.length - 1].url.replace(/^ws/, 'http'));
    expect(url.searchParams.get('session')).toBe('pty-abc');
  });

  it('提供配色切换', () => {
    render(<TerminalView channelId="c0" />);
    expect(screen.getByRole('button', { name: /切到/ })).toBeTruthy();
  });
});

describe('会话已不在时的恢复', () => {
  it('拿着失效的 session 连不上 → 丢掉它重开，恒不无限重试同一个死 id', async () => {
    // 宽限期过了、或节点重启过，sessionStorage 里的 id 就指向一个不存在的
    // 会话。浏览器的 WebSocket API 恒拿不到握手的 HTTP 状态码，唯一能分辨
    // 的事实是「这次有没有拿到 ready」。
    window.sessionStorage.setItem('atoll.terminal.session.c0', 'dead-session');
    render(<TerminalView channelId="c0" />);

    const first = new URL(sockets[0].url.replace(/^ws/, 'http'));
    expect(first.searchParams.get('session')).toBe('dead-session');

    // 握手失败（没有 ready），且 code 不是 1000
    sockets[0].onclose?.({ code: 1006, reason: '' });
    await vi.waitFor(() => expect(sockets.length).toBe(2));

    const second = new URL(sockets[1].url.replace(/^ws/, 'http'));
    expect(second.searchParams.get('session'), '仍在用那个死 id 重试').toBeNull();
    expect(window.sessionStorage.getItem('atoll.terminal.session.c0')).toBeNull();
  });

  it('全新会话也连不上时恒不空转，给出可重试的终止态', async () => {
    render(<TerminalView channelId="c0" />);
    // 一路失败：每次失败后把退避定时器推完，直到组件放弃。
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
});
