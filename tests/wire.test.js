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
  socket.message({ v: 5, frame_type: 'receipt', ref: sent.ref, payload });
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
	  v: 5,
      frame_type: 'attach',
      ref: 'attach-1',
	  payload: { since: { c0: 7 }, focus: '', history_protocol: 5, generation: 1 },
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
      // 这条连接自己的名字。一个人的手机和网页同时连着,任何冲着"这个人的屏幕"
      // 来的东西都得说清是哪一块,而这块屏得知道自己叫什么才认得出被点到的是它。
      session: '',
      session_label: '',
      contract_version: 'v4',
      memberships: [{ channel_id: 'c0', actor_id: 'root' }],
      memberships_complete: true,
	  history_meta: [],
      attach_ref: 'attach-1',
      boot: undefined,
      generation: 1,
    }]);
    wire.close();
  });

	it('rejects feed before the v5 attach receipt instead of emulating the old wire', () => {
    const events = [];
    const wire = createWire({
      WebSocketImpl: FakeWebSocket,
	  onFeed: (_channelId, seq) => events.push(`feed:${seq}`),
      onError: (error) => events.push(`error:${error.detail}`),
      onState: (state) => events.push(`state:${state}`),
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
	socket.message({ v: 5, frame_type: 'feed', payload: { source: 'live', generation: 1, channel_id: 'c0', seq: 10, envelope: { id: 'm10' } } });
    expect(events).toEqual(['state:open', 'error:feed arrived before attach receipt']);
    receipt(socket, socket.sent[0]);
	socket.message({ v: 5, frame_type: 'feed', payload: { source: 'live', generation: 1, channel_id: 'c0', seq: 11, envelope: { id: 'm11' } } });
    expect(events).toEqual(['state:open', 'error:feed arrived before attach receipt', 'state:attached', 'feed:11']);
    wire.close();
  });

	it('delivers explicitly correlated history rows after a metadata-only attach', () => {
    const events = [];
    const wire = createWire({
      WebSocketImpl: FakeWebSocket,
	  onFeed: (_channelId, seq, _envelope, payload) => events.push(`feed:${payload.ref}:${seq}`),
      onPageEnd: (payload) => events.push(`end:${payload.ref}:${payload.generation}`),
      onState: (state) => events.push(`state:${state}`),
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const attach = socket.sent[0];
	receipt(socket, attach, { history_meta: [{ channel_id: 'c0', head_seq: 10, has_rows: true }] });
	socket.message({ v: 5, frame_type: 'feed', ref: 'history-2', payload: { source: 'history', generation: 1, channel_id: 'c0', seq: 10, envelope: { id: 'm10' } } });
	socket.message({ v: 5, frame_type: 'page_end', ref: 'history-2', payload: { source: 'history', generation: 1, channel_id: 'c0', oldest_seq: 10 } });
	expect(events).toEqual(['state:open', 'state:attached', 'feed:history-2:10', 'end:history-2:1']);
    wire.close();
  });

  it('delivers only current-generation live scan checkpoints after attach', () => {
    const checkpoints = [];
    const wire = createWire({ WebSocketImpl: FakeWebSocket, onCheckpoint: (payload) => checkpoints.push(payload) });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    receipt(socket, socket.sent[0]);
    socket.message({ v: 5, frame_type: 'checkpoint', payload: { generation: 1, channel_id: 'c0', scan_low_seq: 11, scanned_seq: 20 } });
    socket.message({ v: 5, frame_type: 'checkpoint', payload: { generation: 0, channel_id: 'c0', scan_low_seq: 1, scanned_seq: 10 } });
    expect(checkpoints).toEqual([{ generation: 1, channel_id: 'c0', scan_low_seq: 11, scanned_seq: 20 }]);
    wire.close();
  });

  it('reads an older page over the attached websocket', async () => {
    const wire = createWire({ WebSocketImpl: FakeWebSocket });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    receipt(socket, socket.sent[0]);

	const pagePromise = wire.historyBefore('c0', 42, 50, { purpose: 'user-demand', priority: 'foreground' });
    const request = socket.sent.at(-1);
    expect(request).toMatchObject({
      frame_type: 'history_before',
	  payload: { channel_id: 'c0', before_seq: 42, limit: 50, byte_limit: 4 * 1024 * 1024, generation: 1, purpose: 'user-demand', priority: 'foreground' },
    });
    receipt(socket, request, { channel_id: 'c0', oldest_seq: 10, has_older: true, rows: [] });
    await expect(pagePromise).resolves.toMatchObject({ channel_id: 'c0', oldest_seq: 10, has_older: true });
    wire.close();
  });

  it('cancels a correlated history batch without overloading request cancel', async () => {
    const wire = createWire({ WebSocketImpl: FakeWebSocket });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    receipt(socket, socket.sent[0]);
    const cancellation = wire.cancelHistory('c0', 'history_before-9', 1);
    const sent = socket.sent.at(-1);
    expect(sent).toMatchObject({
      frame_type: 'history_cancel',
      payload: { channel_id: 'c0', target_ref: 'history_before-9', generation: 1 },
    });
    receipt(socket, sent, sent.payload);
    await expect(cancellation).resolves.toMatchObject({ target_ref: 'history_before-9' });
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
	  v: 5,
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

	it('fails closed when a pre-v5 downstream frame arrives', () => {
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

