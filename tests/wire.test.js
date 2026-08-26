import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWire, WireError } from '../src/net/wire.js';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  emit(type, value = {}) {
    for (const handler of this.listeners.get(type) || []) handler(value);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  message(value) {
    this.emit('message', { data: JSON.stringify(value) });
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }
}

function receipt(socket, sent, payload = {}) {
  socket.message({ v: 3, frame_type: 'receipt', ref: sent.ref, payload });
}

describe('wire client', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  it('sends attach as the first and only attach frame', async () => {
    const states = [];
    const wire = createWire({ WebSocketImpl: FakeWebSocket, since: () => ({ c0: 7 }), onState: (...args) => states.push(args) });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    expect(socket.sent).toEqual([{
      v: 3,
      frame_type: 'attach',
      ref: 'attach-1',
      payload: { since: { c0: 7 }, focus: '', history_protocol: 3 },
    }]);
    receipt(socket, socket.sent[0], {
      contract_version: 'v4',
      memberships: [{ channel_id: 'c0', actor_id: 'root' }],
      memberships_complete: true,
    });
    await Promise.resolve();
    expect(socket.sent.filter((item) => item.frame_type === 'attach')).toHaveLength(1);
    // attach 回执携带的成员清单原样透传给 onState 消费方。
    expect(states).toContainEqual(['attached', {
      contract_version: 'v4',
      memberships: [{ channel_id: 'c0', actor_id: 'root' }],
      memberships_complete: true,
      history: [],
      attach_ref: 'attach-1',
      boot: undefined,
      generation: 1,
    }]);
    wire.close();
  });

  it('rejects feed before the v3 attach receipt instead of emulating the old wire', () => {
    const events = [];
    const wire = createWire({
      WebSocketImpl: FakeWebSocket,
      onFeed: (_channelId, seq) => events.push(`feed:${seq}`),
      onError: (error) => events.push(`error:${error.detail}`),
      onState: (state) => events.push(`state:${state}`),
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.message({ v: 3, frame_type: 'feed', payload: { channel_id: 'c0', seq: 10, envelope: { id: 'm10' } } });
    expect(events).toEqual(['state:open', 'error:feed arrived before attach receipt']);
    receipt(socket, socket.sent[0]);
    socket.message({ v: 3, frame_type: 'feed', payload: { channel_id: 'c0', seq: 11, envelope: { id: 'm11' } } });
    expect(events).toEqual(['state:open', 'error:feed arrived before attach receipt', 'state:attached', 'feed:11']);
    wire.close();
  });

  it('delivers attach rows and their correlated page_end after the receipt', () => {
    const events = [];
    const wire = createWire({
      WebSocketImpl: FakeWebSocket,
      onFeed: (_channelId, seq) => events.push(`feed:${seq}`),
      onPageEnd: (payload) => events.push(`end:${payload.ref}:${payload.generation}`),
      onState: (state) => events.push(`state:${state}`),
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const attach = socket.sent[0];
    receipt(socket, attach, { history: [{ channel_id: 'c0', oldest_seq: 10 }] });
    socket.message({ v: 3, frame_type: 'feed', payload: { channel_id: 'c0', seq: 10, envelope: { id: 'm10' } } });
    socket.message({ v: 3, frame_type: 'page_end', ref: attach.ref, payload: { source: 'attach', channel_id: 'c0', oldest_seq: 10 } });
    expect(events).toEqual(['state:open', 'state:attached', 'feed:10', `end:${attach.ref}:1`]);
    wire.close();
  });

  it('reads an older page over the attached websocket', async () => {
    const wire = createWire({ WebSocketImpl: FakeWebSocket });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    receipt(socket, socket.sent[0]);

    const pagePromise = wire.historyBefore('c0', 42, 50);
    const request = socket.sent.at(-1);
    expect(request).toMatchObject({
      frame_type: 'history_before',
      payload: { channel_id: 'c0', before_seq: 42, limit: 50 },
    });
    receipt(socket, request, { channel_id: 'c0', oldest_seq: 10, has_older: true, rows: [] });
    await expect(pagePromise).resolves.toMatchObject({ channel_id: 'c0', oldest_seq: 10, has_older: true });
    wire.close();
  });

  it('correlates receipts and errors by ref', async () => {
    const wire = createWire({ WebSocketImpl: FakeWebSocket });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    receipt(socket, socket.sent[0], { contract_version: 'v4' });

    const accepted = wire.submit({ channel_id: 'c0', msg_type: 'agent.ask' });
    const submit = socket.sent.at(-1);
    receipt(socket, submit, { message_id: 'm1' });
    await expect(accepted).resolves.toEqual({ message_id: 'm1' });

    const refused = wire.resolve({ channel_id: 'c0', req_id: 'r1', decision: 'approved' });
    const resolve = socket.sent.at(-1);
    socket.message({
      v: 3,
      frame_type: 'error',
      ref: resolve.ref,
      payload: { frame: 'resolve', code: 'already_closed', detail: 'done' },
    });
    await expect(refused).rejects.toMatchObject({ code: 'already_closed', frame: 'resolve' });
    wire.close();
  });

  it('uses a fresh cursor snapshot after reconnect', () => {
    let cursor = 2;
    const wire = createWire({ WebSocketImpl: FakeWebSocket, since: () => ({ c0: cursor }) });
    const first = FakeWebSocket.instances[0];
    first.open();
    receipt(first, first.sent[0]);
    cursor = 9;
    first.close();
    vi.advanceTimersByTime(500);
    const second = FakeWebSocket.instances[1];
    second.open();
    expect(second.sent[0].payload.since).toEqual({ c0: 9 });
    wire.close();
  });

  it('rejects every pending request on close', async () => {
    const wire = createWire({ WebSocketImpl: FakeWebSocket });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    receipt(socket, socket.sent[0]);
    const request = wire.submit({ channel_id: 'c0', msg_type: 'agent.ask' });
    socket.close();
    await expect(request).rejects.toEqual(expect.objectContaining({ code: 'closed' }));
    await expect(Promise.reject(new WireError({ code: 'closed' }))).rejects.toBeInstanceOf(WireError);
    wire.close();
  });

  it('fails closed when a pre-v3 downstream frame arrives', () => {
    const errors = [];
    const wire = createWire({ WebSocketImpl: FakeWebSocket, onError: (error) => errors.push(error) });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.message({ v: 2, frame_type: 'receipt', ref: socket.sent[0].ref, payload: {} });
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(errors.at(-1)).toMatchObject({ code: 'bad_payload', detail: 'invalid downstream frame' });
    wire.close();
  });
});
