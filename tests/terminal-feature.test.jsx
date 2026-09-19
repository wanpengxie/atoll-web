// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyClient, resetPtyClient, writeSession } from '../src/net/pty.js';
import { TerminalFeature } from '../src/ui/features/terminal/TerminalFeature.jsx';

const terminals = [];

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      this.addons = [];
      this.writes = [];
      terminals.push(this);
    }
    loadAddon(addon) { this.addons.push(addon); }
    open() {}
    write(value) { this.writes.push(value); }
    focus() {}
    dispose() { this.disposed = true; }
    hasSelection() { return false; }
    getSelection() { return ''; }
    onData(handler) {
      this.dataHandler = handler;
      return { dispose: () => { this.dataHandler = null; } };
    }
    emitData(data) { this.dataHandler?.(data); }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { constructor() { this.kind = 'webgl'; } onContextLoss() {} dispose() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const sockets = [];
class FakeWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.deferClose = false;
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data) { this.sent.push(data); }
  close() {
    this.readyState = FakeWebSocket.CLOSING;
    if (!this.deferClose) this.finishClose();
  }
  finishClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '' });
  }
  control() { return this.sent.filter((entry) => typeof entry === 'string').map((entry) => JSON.parse(entry)); }
  reply(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  replyBinary(value) { this.onmessage?.({ data: value.buffer }); }
}

const DEVICE = { id: 'local-device', name: 'Local device', online: true };

function terminalPort(extra = {}) {
  return {
    devices: [DEVICE],
    ...extra,
    commands: {
      connect: (options) => ptyClient().attach(options.channelId, options),
      ...(extra.commands || {}),
    },
  };
}

async function flushEffects() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function openFrames(socket) {
  return socket.control().filter((entry) => entry.type === 'open');
}

function binaryFrame(id, text) {
  const payload = new TextEncoder().encode(text);
  const frame = new Uint8Array(4 + payload.length);
  new DataView(frame.buffer).setUint32(0, id, false);
  frame.set(payload, 4);
  return frame;
}

beforeEach(() => {
  terminals.length = 0;
  sockets.length = 0;
  resetPtyClient();
  window.sessionStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TerminalFeature terminal-session owner', () => {
  it('buffers input before the terminal-session handle and delivers it once after stream ready', async () => {
    let handle;
    const connect = vi.fn(() => new Promise((resolve) => {
      // The real pty client is synchronous at attach time, but a port may
      // install its handle asynchronously. Keep the same shared stream so
      // the test covers both owner handoff and the server ready frame.
      queueMicrotask(() => resolve(handle));
    }));
    // Install through the public pty owner while still returning its handle
    // asynchronously from the terminal-session port.
    resetPtyClient();
    const port = {
      devices: [DEVICE],
      commands: {
        connect: (options) => {
          handle = ptyClient().attach(options.channelId, options);
          return connect();
        },
      },
    };
    render(<TerminalFeature channelId="c0" port={port} />);
    terminals[0].emitData('echo buffered\r');

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const open = sockets[0].control().find((entry) => entry.type === 'open');
    expect(open).toBeTruthy();
    expect(sockets[0].sent.filter((entry) => entry instanceof Uint8Array)).toHaveLength(0);

    sockets[0].reply({ type: 'ready', id: open.id, session: 'pty-buffered' });
    const binary = sockets[0].sent.filter((entry) => entry instanceof Uint8Array);
    expect(binary).toHaveLength(1);
    expect(new TextDecoder().decode(binary[0].subarray(4))).toBe('echo buffered\r');
  });

  it('keeps the shared terminal stream attached when the view is hidden', async () => {
    resetPtyClient();
    const port = {
      devices: [DEVICE],
      commands: {
        connect: (options) => ptyClient().attach(options.channelId, options),
      },
    };
    const { rerender } = render(<TerminalFeature channelId="c0" port={port} visible />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const socket = sockets[0];
    const open = socket.control().find((entry) => entry.type === 'open');
    expect(open).toBeTruthy();
    socket.reply({ type: 'ready', id: open.id, session: 'pty-visible' });

    await act(async () => {
      rerender(<TerminalFeature channelId="c0" port={port} visible={false} />);
    });

    expect(terminals).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(socket.control().filter((entry) => entry.type === 'detach' || entry.type === 'close')).toEqual([]);
  });

  it('mounts one public terminal stream on the shared PTY owner', async () => {
    render(<TerminalFeature channelId="c0" port={terminalPort()} />);
    await flushEffects();

    expect(terminals).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    expect(openFrames(sockets[0])).toEqual([
      expect.objectContaining({ channel_id: 'c0', device: 'local-device' }),
    ]);
  });

  it('shares one WebSocket across terminal streams for multiple channels', async () => {
    const port = terminalPort();
    render(<>
      <TerminalFeature channelId="c0" port={port} />
      <TerminalFeature channelId="c1" port={port} />
    </>);
    await flushEffects();

    expect(terminals).toHaveLength(2);
    expect(sockets).toHaveLength(1);
    expect(openFrames(sockets[0]).map((entry) => entry.channel_id)).toEqual(['c0', 'c1']);
  });

  it('waits for the old WebSocket close handshake before opening its replacement', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let replacement;
    try {
      const first = ptyClient().attach('c0', { deviceId: DEVICE.id, cols: 80, rows: 24 });
      await act(async () => { await Promise.resolve(); });
      const oldSocket = sockets[0];
      oldSocket.deferClose = true;
      first.detach();

      await act(async () => { vi.advanceTimersByTime(250); });
      expect(oldSocket.readyState).toBe(FakeWebSocket.CLOSING);

      replacement = ptyClient().attach('c1', { deviceId: DEVICE.id, cols: 80, rows: 24 });
      expect(sockets).toHaveLength(1);

      oldSocket.finishClose();
      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
      });
      expect(sockets).toHaveLength(2);
    } finally {
      replacement?.detach();
      vi.advanceTimersByTime(250);
      vi.useRealTimers();
    }
  });

  it('does not rebuild the shell when canWrite permission changes', async () => {
    const { rerender } = render(<TerminalFeature channelId="c0" port={terminalPort({ canWrite: true })} />);
    await flushEffects();
    const socket = sockets[0];
    const [open] = openFrames(socket);
    socket.reply({ type: 'ready', id: open.id, session: 'pty-write' });

    rerender(<TerminalFeature channelId="c0" port={terminalPort({ canWrite: false })} />);
    expect(terminals).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    expect(socket.control().filter((entry) => entry.type === 'detach' || entry.type === 'close')).toEqual([]);
    terminals[0].emitData('blocked\r');
    expect(socket.sent.filter((entry) => entry instanceof Uint8Array)).toHaveLength(0);

    rerender(<TerminalFeature channelId="c0" port={terminalPort({ canWrite: true })} />);
    terminals[0].emitData('allowed\r');
    expect(socket.sent.filter((entry) => entry instanceof Uint8Array)).toHaveLength(1);
  });

  it('detaches an unmounted viewer without closing the shell', async () => {
    const view = render(<TerminalFeature channelId="c0" port={terminalPort()} />);
    await flushEffects();
    const socket = sockets[0];
    const [open] = openFrames(socket);
    socket.reply({ type: 'ready', id: open.id, session: 'pty-detach' });

    view.unmount();

    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(socket.control()).toContainEqual(expect.objectContaining({ type: 'detach', id: open.id }));
    expect(socket.control().some((entry) => entry.type === 'close')).toBe(false);
  });

  it('reuses the remembered session when a terminal viewer remounts', async () => {
    const port = terminalPort();
    const first = render(<TerminalFeature channelId="c0" port={port} />);
    await flushEffects();
    const socket = sockets[0];
    const [open] = openFrames(socket);
    socket.reply({ type: 'ready', id: open.id, session: 'session-remount' });
    first.unmount();

    render(<TerminalFeature channelId="c0" port={port} />);
    await flushEffects();

    expect(sockets).toHaveLength(1);
    expect(openFrames(socket)).toHaveLength(2);
    expect(openFrames(socket)[1]).toMatchObject({ channel_id: 'c0', session: 'session-remount' });
  });

  it('switches terminal themes without rebuilding the terminal stream', async () => {
    const user = userEvent.setup();
    const view = render(<TerminalFeature channelId="c0" port={terminalPort()} />);
    await flushEffects();
    const terminal = terminals[0];

    expect(view.container.querySelector('[data-terminal-theme="dark"]')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '切到浅色' }));

    expect(view.container.querySelector('[data-terminal-theme="light"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '切到暗色' })).toBeTruthy();
    expect(terminal.options.theme.background).toBe('#ffffff');
    expect(terminals).toHaveLength(1);
  });

  it('drops a rejected remembered session and retries once without repeating its dead id', async () => {
    writeSession('c0', 'dead-session', DEVICE.id);
    render(<TerminalFeature channelId="c0" port={terminalPort()} />);
    await flushEffects();
    const socket = sockets[0];
    const [firstOpen] = openFrames(socket);
    expect(firstOpen.session).toBe('dead-session');

    await act(async () => {
      socket.reply({ type: 'error', id: firstOpen.id, code: 'session_not_found', detail: '会话不存在' });
      await Promise.resolve();
    });
    expect(openFrames(socket)).toHaveLength(2);
    expect(openFrames(socket)[1]).not.toHaveProperty('session');
    expect(window.sessionStorage.getItem('atoll.terminal.session.c0.local-device')).toBeNull();

    await act(async () => {
      socket.reply({ type: 'error', id: firstOpen.id, code: 'session_not_found', detail: '会话不存在' });
      await Promise.resolve();
    });
    expect(openFrames(socket)).toHaveLength(2);
    expect(screen.getByRole('button', { name: '重开' })).toBeTruthy();
  });

  it('ends a new-session failure without spinning and exposes an explicit retry', async () => {
    const user = userEvent.setup();
    render(<TerminalFeature channelId="c0" port={terminalPort()} />);
    await flushEffects();
    const socket = sockets[0];
    const [open] = openFrames(socket);

    await act(async () => {
      socket.reply({ type: 'error', id: open.id, code: 'session_unavailable', detail: '设备拒绝了新会话' });
      await Promise.resolve();
    });
    expect(openFrames(socket)).toHaveLength(1);
    expect(screen.getByRole('button', { name: '重开' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('设备拒绝了新会话');

    await user.click(screen.getByRole('button', { name: '重开' }));
    await flushEffects();
    expect(openFrames(socket)).toHaveLength(2);
  });

  it('ends only the exited stream and keeps the shared WebSocket for its sibling', async () => {
    const port = terminalPort();
    render(<>
      <TerminalFeature channelId="c0" port={port} />
      <TerminalFeature channelId="c1" port={port} />
    </>);
    await flushEffects();
    const socket = sockets[0];
    const streams = openFrames(socket);
    expect(streams).toHaveLength(2);
    for (const stream of streams) socket.reply({ type: 'ready', id: stream.id, session: `session-${stream.id}` });

    await act(async () => {
      socket.reply({ type: 'exit', id: streams[0].id, reason: 'shell exited' });
      await Promise.resolve();
    });
    socket.replyBinary(binaryFrame(streams[1].id, 'still alive'));

    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(socket.control().some((entry) => entry.type === 'close')).toBe(false);
    expect(terminals[0].writes).toHaveLength(0);
    expect(new TextDecoder().decode(terminals[1].writes[0])).toBe('still alive');
  });

  it('does not attach WebGL to a terminal after its viewer unmounts', async () => {
    const view = render(<TerminalFeature channelId="c0" port={terminalPort()} />);
    const terminal = terminals[0];
    view.unmount();
    await flushEffects();

    expect(terminal.addons.some((addon) => addon.kind === 'webgl')).toBe(false);
  });

  it('attaches WebGL to a live terminal', async () => {
    render(<TerminalFeature channelId="c0" port={terminalPort()} />);
    await flushEffects();

    expect(terminals[0].addons.some((addon) => addon.kind === 'webgl')).toBe(true);
  });
});
