import {
  DOWN,
  FRAME_VERSION,
  frame,
  MAX_FRAME_BYTES,
  parseDownstream,
  UP,
} from '../protocol/frame.js';
import { diagnostic } from '../model/diagnostics.js';

export class WireError extends Error {
  constructor({ frame: frameType = '', code = 'unknown', detail = '', ref = '' } = {}) {
    super(detail || code);
    this.name = 'WireError';
    this.frame = frameType;
    this.code = code;
    this.detail = detail;
    this.ref = ref;
  }
}

function websocketURL(url) {
  if (/^wss?:\/\//.test(url)) return url;
  const locationValue = globalThis.location;
  if (!locationValue) return url;
  const protocol = locationValue.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${protocol}//${locationValue.host}${path}`;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function createWire({
  url = '/ws',
  since = () => ({}),
  focus = () => '',
  onFeed = () => {},
  onPageEnd = () => {},
  onError = () => {},
  onObserveEnded = () => {},
  onState = () => {},
  WebSocketImpl = globalThis.WebSocket,
  pendingTimeoutMs = 30_000,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  if (!WebSocketImpl) throw new TypeError('WebSocket is unavailable');

  let socket = null;
  let stopped = false;
  let attached = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let counter = 0;
  let attachRef = '';
  let generation = 0;
  const pending = new Map();

  function rejectPending(code = 'closed', detail = 'connection closed') {
    for (const [ref, entry] of pending) {
      clearTimeoutImpl(entry.timer);
      entry.reject(new WireError({ frame: entry.type, code, detail, ref }));
    }
    pending.clear();
  }

  function transmit(type, payload, { allowBeforeAttach = false } = {}) {
    if (!socket || socket.readyState !== WebSocketImpl.OPEN || (!attached && !allowBeforeAttach)) {
      return Promise.reject(new WireError({ frame: type, code: 'unavailable', detail: 'wire is not attached' }));
    }
    counter += 1;
    const ref = `${type}-${counter}`;
    let encoded;
    try {
      encoded = JSON.stringify(frame(type, ref, payload));
    } catch (error) {
      return Promise.reject(error);
    }
    if (byteLength(encoded) > MAX_FRAME_BYTES) {
      return Promise.reject(new WireError({ frame: type, code: 'bad_payload', detail: 'frame exceeds 512KB', ref }));
    }
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeoutImpl(() => {
        pending.delete(ref);
        const error = new WireError({ frame: type, code: 'timeout', detail: 'frame receipt timed out', ref });
        diagnostic('error', 'wire.receipt_timeout', { type, ref, pending: pending.size, generation });
        reject(error);
      }, pendingTimeoutMs);
      pending.set(ref, { resolve, reject, timer, type });
      try {
        socket.send(encoded);
      } catch (error) {
        clearTimeoutImpl(timer);
        pending.delete(ref);
        diagnostic('error', 'wire.send_failed', { type, ref, generation, error });
        reject(new WireError({ frame: type, code: 'closed', detail: error.message, ref }));
      }
    });
    promise.ref = ref;
    return promise;
  }

  function handleMessage(event) {
    const parsed = parseDownstream(event.data);
    if (parsed.kind === 'invalid' || parsed.kind === 'bad_version') {
      diagnostic('error', 'wire.protocol_rejected', { kind: parsed.kind, generation });
      onError(new WireError({ frame: 'downstream', code: 'bad_payload', detail: 'invalid downstream frame' }));
      socket?.close(1002, 'invalid downstream frame');
      return;
    }
    if (parsed.kind === 'unknown') {
      diagnostic('warn', 'wire.unknown_frame', { generation });
      return;
    }
    const { frame: incoming, payload } = parsed;
    if (parsed.kind === DOWN.receipt) {
      const entry = pending.get(incoming.ref);
      if (!entry) return;
      clearTimeoutImpl(entry.timer);
      pending.delete(incoming.ref);
      entry.resolve(payload);
      if (incoming.ref === attachRef) {
        attached = true;
        reconnectAttempt = 0;
        diagnostic('info', 'wire.attached', {
          generation,
          contractVersion: payload.contract_version,
          boot: payload.boot,
          memberships: payload.memberships?.length || 0,
          historyChannels: payload.history?.length || 0,
        });
        onState('attached', {
          contract_version: payload.contract_version,
          boot: payload.boot,
          // attach 回执自带成员清单（网关资格账快照）：连上即知道"我在哪些频道、
          // 以什么 actor 身份"，恒不再靠 feed 副作用反推。
          memberships: payload.memberships,
          memberships_complete: payload.memberships_complete,
          history: payload.history || [],
          attach_ref: incoming.ref,
          generation,
        });
      }
      return;
    }
    if (parsed.kind === DOWN.error) {
      const error = new WireError({ ...payload, ref: incoming.ref || '' });
      diagnostic('error', 'wire.server_error', {
        generation,
        frame: error.frame,
        code: error.code,
        detail: error.detail,
        ref: error.ref,
      });
      const entry = incoming.ref ? pending.get(incoming.ref) : null;
      if (entry) {
        clearTimeoutImpl(entry.timer);
        pending.delete(incoming.ref);
        entry.reject(error);
      } else {
        onError(error);
      }
      return;
    }
    if (parsed.kind === DOWN.feed) {
      if (!attached) {
        diagnostic('error', 'wire.feed_before_attach', { generation, channelId: payload.channel_id, seq: payload.seq });
        onError(new WireError({ frame: DOWN.feed, code: 'bad_payload', detail: 'feed arrived before attach receipt' }));
        return;
      }
      onFeed(payload.channel_id, Number(payload.seq), payload.envelope);
      return;
    }
    if (parsed.kind === DOWN.observe_ended) {
      onObserveEnded(payload.channel_id, payload.reason);
      return;
    }
    if (parsed.kind === DOWN.page_end) {
      diagnostic(payload.error_code ? 'error' : 'debug', 'wire.page_end', {
        generation,
        ref: incoming.ref || '',
        source: payload.source,
        channelId: payload.channel_id,
        oldestSeq: payload.oldest_seq,
        newestSeq: payload.newest_seq,
        hasOlder: payload.has_older,
        errorCode: payload.error_code || '',
      });
      onPageEnd({ ...payload, ref: incoming.ref || '', generation });
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer != null) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempt, 6));
    reconnectAttempt += 1;
    diagnostic('warn', 'wire.reconnect_scheduled', { generation, attempt: reconnectAttempt, delay });
    onState('reconnecting', { delay });
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (stopped) return;
    attached = false;
    attachRef = '';
    generation += 1;
    diagnostic('info', 'wire.connecting', { generation, url: websocketURL(url) });
    try {
      socket = new WebSocketImpl(websocketURL(url));
    } catch (error) {
      diagnostic('error', 'wire.construct_failed', { generation, error });
      onError(error);
      scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      if (stopped) return;
      onState('open');
      diagnostic('info', 'wire.open', { generation });
      const attachSince = since() || {};
      const attachFocus = focus() || '';
      const attachPromise = transmit(UP.attach, { since: attachSince, focus: attachFocus, history_protocol: FRAME_VERSION }, { allowBeforeAttach: true });
      attachRef = `${UP.attach}-${counter}`;
      diagnostic('info', 'wire.attach_sent', { generation, ref: attachRef, focus: attachFocus, cursorChannels: Object.keys(attachSince).length });
      attachPromise.catch((error) => {
        if (!stopped) onError(error);
      });
    });
    socket.addEventListener('message', (event) => {
      try {
        handleMessage(event);
      } catch (error) {
        diagnostic('error', 'wire.message_handler_failed', { generation, error });
        onError(error);
        socket?.close(1002, 'message handler failed');
      }
    });
    socket.addEventListener('error', () => {
      diagnostic('error', 'wire.socket_error', { generation, readyState: socket?.readyState });
      if (socket?.readyState !== WebSocketImpl.CLOSED) socket.close();
    });
    socket.addEventListener('close', () => {
      attached = false;
      rejectPending('closed', 'connection closed');
      onState('disconnected', { generation });
      diagnostic(stopped ? 'info' : 'warn', 'wire.closed', { generation, stopped, pending: pending.size });
      if (stopped) {
        onState('closed');
      } else {
        scheduleReconnect();
      }
    });
  }

  connect();

  return {
    submit(payload) {
      return transmit(UP.submit, payload);
    },
    resolve(payload) {
      return transmit(UP.resolve, payload);
    },
    cancel(payload) {
      return transmit(UP.cancel, payload);
    },
    after(payload) {
      return transmit(UP.after, payload);
    },
    cancelTimer(payload) {
      return transmit(UP.cancel_timer, payload);
    },
    resource(payload) {
      return transmit(UP.resource, payload);
    },
    observe(channelId) {
      return transmit(UP.observe, { channel_id: channelId });
    },
    unobserve(channelId) {
      return transmit(UP.unobserve, { channel_id: channelId });
    },
    historyBefore(channelId, beforeSeq = 0, limit = 200) {
      return transmit(UP.history_before, { channel_id: channelId, before_seq: beforeSeq, limit });
    },
    close() {
      if (stopped) return;
      stopped = true;
      if (reconnectTimer != null) {
        clearTimeoutImpl(reconnectTimer);
        reconnectTimer = null;
      }
      rejectPending('closed', 'wire closed by client');
      if (socket && socket.readyState !== WebSocketImpl.CLOSED) {
        socket.close();
      } else {
        onState('closed');
      }
    },
  };
}
