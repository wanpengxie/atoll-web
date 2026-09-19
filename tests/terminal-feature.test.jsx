// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyClient, resetPtyClient } from '../src/net/pty.js';
import { TerminalFeature } from '../src/ui/features/terminal/TerminalFeature.jsx';

const terminals = [];

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      this.addons = [];
      terminals.push(this);
    }
    loadAddon(addon) { this.addons.push(addon); }
    open() {}
    write() {}
    focus() {}
    dispose() {}
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
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const sockets = [];
class FakeWebSocket {
  static OPEN = 1;

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(data) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  control() { return this.sent.filter((entry) => typeof entry === 'string').map((entry) => JSON.parse(entry)); }
  reply(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

const DEVICE = { id: 'local-device', name: 'Local device', online: true };

beforeEach(() => {
  terminals.length = 0;
  sockets.length = 0;
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
});
