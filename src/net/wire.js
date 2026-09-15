import {
  DOWN,
  FRAME_VERSION,
  frame,
  MAX_FRAME_BYTES,
  parseDownstream,
  UP,
} from '../protocol/frame.js';
import { diagnostic } from '../model/diagnostics.js';
import { TYPES } from '../protocol/vocab.js';

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
  // Attach metadata is a fast control-plane fact. The callback must install
  // its in-memory epoch synchronously; any returned persistence work is
  // deliberately detached from transport and cannot delay live delivery.
  onAttach = () => null,
  // label 是这条连接的自称,给人看的,由调用方给——wire 是传输,"这块屏叫什么"
  // 是应用层的决定,而且在这里嗅探 navigator 会让传输层的测试跟着运行环境走。
  label = '',
  WebSocketImpl = globalThis.WebSocket,
  pendingTimeoutMs = 30_000,
  // 退避上限。手机上压到几秒:那里断线是常态(锁屏、切基站、wifi 换 4G),而
  // 30 秒的干等就是"掉线"的全部体感。
  maxReconnectDelayMs = 30_000,
  // (fire) => unsubscribe。谁算"醒过来"由调用方定(见 net/wake.js),传输层恒不
  // 嗅探运行环境。
  wake = null,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  if (!WebSocketImpl) throw new TypeError('WebSocket is unavailable');

  let socket = null;
  let releaseWake = null;
  let stopped = false;
  let attached = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let foregroundResyncReason = '';
  let counter = 0;
  let attachRef = '';
  // 这条连接自己的名字,attach 回执给的。人发给 agent 的消息盖上它:总有一个端
  // 发出了这条消息,那个端有身份,而 agent 要操作某块屏时必须能点名它。
  //
  // 留在这一层,是因为"从哪块屏发出的"要在**咽喉处**盖才可靠——盖在各个调用点
  // 就一定会漏,而读的人分不清"这条没有来源"和"那条路径忘了盖"。
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
        // The receipt itself is the history/live seam. Install its lightweight
        // Meta synchronously, then publish attached immediately. IndexedDB
        // epoch selection continues independently behind the application's
        // persistence fence; Wire never buffers live behind storage work.
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
        const detail = {
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
        };
        try {
          const persistence = onAttach(detail);
          if (persistence && typeof persistence.then === 'function') {
            void Promise.resolve(persistence).catch((error) => {
              diagnostic('error', 'wire.attach_persistence_failed', { generation: detail.generation, error });
              onError(error);
            });
          }
        } catch (error) {
          diagnostic('error', 'wire.attach_meta_failed', { generation: detail.generation, error });
          onError(error);
        }
        if (!stopped && attached && Number(detail.generation) === generation) onState('attached', detail);
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
    const delay = Math.min(maxReconnectDelayMs, 500 * 2 ** Math.min(reconnectAttempt, 6));
    reconnectAttempt += 1;
    diagnostic('warn', 'wire.reconnect_scheduled', { generation, attempt: reconnectAttempt, delay });
    onState('reconnecting', { delay });
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // 被叫醒:退避表上还剩多久已经不重要了——刚才那段等待的前提(网络还是坏的、
  // 屏幕没人看)已经不成立。取消定时器、把次数清零、立刻重连。
  //
  // 手机上“仍是 OPEN/attached”不是新鲜性的证明：页面被冻结时 socket close、
  // ping 和 feed 都可能尚未被 JS 消费。回到前台必须重新经过 attach Meta seam，
  // 让当前 head 与本地 Replica 比较并主动补齐；否则会一直等旧连接自行超时。
  function wakeNow(reason) {
    if (stopped) return;
    const state = socket?.readyState;
    if (attached && state === WebSocketImpl.OPEN) {
      foregroundResyncReason = reason || 'foreground';
      reconnectAttempt = 0;
      diagnostic('info', 'wire.foreground_resync', { generation, reason: foregroundResyncReason });
      socket.close(4000, 'foreground resync');
      return;
    }
    if (state === WebSocketImpl.CONNECTING || state === WebSocketImpl.OPEN) return;
    if (reconnectTimer != null) {
      clearTimeoutImpl(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempt = 0;
    diagnostic('info', 'wire.wake', { generation, reason });
    connect();
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
      let attachSince = {};
      let attachFocus = '';
      try {
        attachSince = since() || {};
        attachFocus = focus() || '';
      } catch (error) {
        // Local Meta is an optimization. A damaged/unavailable snapshot must
        // degrade to an empty resume, never prevent the Meta attach itself.
        diagnostic('warn', 'wire.resume_snapshot_failed', { generation, error });
        onError(error);
      }
      // Attach is the first control-plane operation and never waits for local
      // message storage. An empty safe resume is valid: the server snapshots
      // heads into history metadata and starts live strictly after that seam.
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
      const resyncReason = foregroundResyncReason;
      foregroundResyncReason = '';
      attached = false;
      rejectPending('closed', 'connection closed');
      onState('disconnected', { generation });
      diagnostic(stopped ? 'info' : 'warn', 'wire.closed', { generation, stopped, pending: pending.size });
      if (stopped) {
        onState('closed');
      } else if (resyncReason) {
        reconnectAttempt = 0;
        onState('reconnecting', { delay: 0, reason: resyncReason });
        connect();
      } else {
        scheduleReconnect();
      }
    });
  }

  // stampOrigin 给**人说的那句话**盖上"从哪块屏说的"。
  //
  // 只盖 agent.ask,不盖别的:
  //
  // - 不盖 _context —— 那是每个 actor 都有的格子,而"我在哪块屏上"只有 human
  //   才有;放进去等于让每个 actor 都扛一个对它毫无意义的字段。
  // - 不盖控制词 —— agent 收到 interrupt 就停,你在哪块屏按的按钮不改变它做
  //   什么。需要来历的是**那句话**,因为那是 agent 要读、要据以推理的东西。
  //
  // 盖在这一层而不是各个调用点:这是这条连接唯一的出口,盖不漏。
  //
  // 这个词名必须和 drivers/agents/base/loop.go 里认它的那个 struct 对上——
  // 盖到一个不认它的词头上,接收方会以 unknown field 拒收,而那个错误跟这个
  // 功能看不出任何关系(2026-08-28 就这么炸过一次)。
  function stampOrigin(payload) {
    if (!sessionID || !payload || typeof payload !== 'object') return payload;
    if (payload.msg_type !== TYPES.agentAsk) return payload;
    const body = payload.payload;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return payload;
    if (body.origin !== undefined) return payload; // 已经说了从哪来,不覆盖
    return {
      ...payload,
      payload: { ...body, origin: { session: sessionID, ...(sessionLabel ? { label: sessionLabel } : {}) } },
    };
  }

  connect();
  releaseWake = wake ? wake(wakeNow) : null;

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
    channelMeta(channelId, requestedGeneration = generation) {
      return transmit(UP.channel_meta, {
        channel_id: channelId,
        generation: requestedGeneration,
      });
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
      releaseWake?.();
      releaseWake = null;
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
