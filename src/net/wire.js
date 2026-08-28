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
  onCheckpoint = () => {},
  onPageEnd = () => {},
  onError = () => {},
  onObserveEnded = () => {},
  onState = () => {},
  // label 是这条连接的自称,给人看的,由调用方给——wire 是传输,"这块屏叫什么"
  // 是应用层的决定,而且在这里嗅探 navigator 会让传输层的测试跟着运行环境走。
  label = '',
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
  // 这条连接自己的名字,attach 回执给的。它留在这里,是因为"这条消息从哪块屏
  // 发出来的"要在**咽喉处**盖章才可靠——发送者那条线之所以从不漏,正是因为它
  // 在一个谁也绕不过去的点上盖,而不是在每个调用点各盖一次。
  let sessionID = '';
  let sessionLabel = '';
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
          session: payload.session,
          boot: payload.boot,
          memberships: payload.memberships?.length || 0,
          historyChannels: payload.history_meta?.length || 0,
        });
        sessionID = payload.session || '';
        sessionLabel = payload.label || '';
        onState('attached', {
          // 这条连接自己的名字。一个人的手机和网页同时连着,两条都在,所以任何
          // 冲着"这个人的屏幕"来的东西都得说清是哪一块——而这块屏得知道自己
          // 叫什么,才认得出被点到的是不是自己。
          session: payload.session || '',
          session_label: payload.label || '',
          contract_version: payload.contract_version,
          boot: payload.boot,
          // attach 回执自带成员清单（网关资格账快照）：连上即知道"我在哪些频道、
          // 以什么 actor 身份"，恒不再靠 feed 副作用反推。
          memberships: payload.memberships,
          memberships_complete: payload.memberships_complete,
          history_meta: payload.history_meta || [],
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
	  if (Number(payload.generation) !== generation) {
		diagnostic('warn', 'wire.stale_feed_ignored', { wireGeneration: generation, frameGeneration: payload.generation, ref: incoming.ref || '' });
		return;
	  }
	  const detail = { ...payload, seq: Number(payload.seq), ref: incoming.ref || '' };
	  onFeed(payload.channel_id, detail.seq, payload.envelope, detail);
      return;
    }
    if (parsed.kind === DOWN.checkpoint) {
      if (!attached || Number(payload.generation) !== generation) {
        diagnostic('warn', 'wire.stale_checkpoint_ignored', { wireGeneration: generation, frameGeneration: payload.generation });
        return;
      }
      onCheckpoint({
        ...payload,
        scan_low_seq: Number(payload.scan_low_seq),
        scanned_seq: Number(payload.scanned_seq),
      });
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
	  if (Number(payload.generation) !== generation) {
		diagnostic('warn', 'wire.stale_page_end_ignored', { wireGeneration: generation, frameGeneration: payload.generation, ref: incoming.ref || '' });
		return;
	  }
      onPageEnd({ ...payload, ref: incoming.ref || '' });
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
      // 空标签不占位:这条帧的形状是契约,不该为了一个没人填的字段多一个键。
      sessionID = '';
      sessionLabel = '';
      const attachPayload = { since: attachSince, focus: attachFocus, history_protocol: FRAME_VERSION, generation };
      if (label) attachPayload.label = label;
      const attachPromise = transmit(UP.attach, attachPayload, { allowBeforeAttach: true });
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

  // stampOrigin 给这条连接发出的每一条消息盖上"从哪块屏来的"。
  //
  // 盖在词的 body 里,不在 _context 里:_context 是底座读的,而 msg.go 会把它剥
  // 成 caller,actor 那边根本收不到——放进去等于让底座扛一个只有别人读、而别人
  // 又读不到的载荷。
  //
  // 盖在这里而不是各个调用点:这是这条连接唯一的出口,所以它盖不漏。发送者那条
  // 线可靠也是同一个道理。
  function stampOrigin(payload) {
    if (!sessionID || !payload || typeof payload !== 'object') return payload;
    const body = payload.payload;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return payload;
    if (body.origin !== undefined) return payload; // 已经说了从哪来,不覆盖
    return {
      ...payload,
      payload: { ...body, origin: { session: sessionID, ...(sessionLabel ? { label: sessionLabel } : {}) } },
    };
  }

  connect();

  return {
    submit(payload) {
      return transmit(UP.submit, stampOrigin(payload));
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
    historyBefore(channelId, beforeSeq = 0, limit = 200, { purpose = 'hydrate', priority = 'background', generation: requestedGeneration = generation, byteLimit = 4 * 1024 * 1024 } = {}) {
      return transmit(UP.history_before, {
		channel_id: channelId,
		before_seq: beforeSeq,
		limit,
		byte_limit: byteLimit,
		generation: requestedGeneration,
		purpose,
		priority,
	  });
    },
    cancelHistory(channelId, targetRef, requestedGeneration = generation) {
      return transmit(UP.history_cancel, {
		channel_id: channelId,
		target_ref: targetRef,
		generation: requestedGeneration,
	  });
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

