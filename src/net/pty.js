// 终端腿：**一条** WebSocket，承载所有频道的所有终端。
//
// 上一版是"一个终端一条 WS"——开十个频道就是十条连接、十份 ping/pong、十次握手。
// 设备腿之所以只要一条 carrier，是因为它有 yamux；浏览器腿没有多路复用器，那就
// 在这一条 WS 上自己做一个最小的。协议见 drivers/gateway/portal/pty.go 顶部。
//
// 它恒不与账本 feed 合并：/ws 是一条串行写泵，一次构建的滚屏会把 feed 拖住
//（"字节恒不进控制帧……为了背压与队头阻塞"）。所以全局恒为两条：feed + 终端。

const RECONNECT_DELAYS = [400, 800, 1600, 3000, 5000];
const STREAM_HEADER = 4;

function ptyURL() {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/pty`;
}

function encodeFrame(id, payload) {
  const frame = new Uint8Array(STREAM_HEADER + payload.length);
  new DataView(frame.buffer).setUint32(0, id, false);
  frame.set(payload, STREAM_HEADER);
  return frame;
}

// 会话 id 按频道存在 sessionStorage：刷新页面后还能接回同一个 shell。
// 恒不用 localStorage——会话恒不跨浏览器标签页共享，那会让两个标签抢同一个
// shell，谁也说不清屏幕该听谁的。
const sessionKey = (channelId) => `atoll.terminal.session.${channelId}`;
export function readSession(channelId) {
  try { return window.sessionStorage.getItem(sessionKey(channelId)) || ''; } catch { return ''; }
}
export function writeSession(channelId, id) {
  try {
    if (id) window.sessionStorage.setItem(sessionKey(channelId), id);
    else window.sessionStorage.removeItem(sessionKey(channelId));
  } catch { /* private mode */ }
}

class PtyClient {
  constructor() {
    this.ws = null;
    this.nextId = 1;
    // id → { channelId, cols, rows, session, ready, handlers }
    this.streams = new Map();
    this.attempt = 0;
    this.timer = 0;
    this.idleTimer = 0;
    this.opening = false;
  }

  // attach 恒是幂等地"要一块终端"：连接没起来就先记账，连上之后统一补发 open。
  attach(channelId, { cols, rows, onData, onReady, onExit, onStatus }) {
    const id = this.nextId++;
    const stream = {
      id, channelId, cols, rows,
      session: readSession(channelId),
      ready: false,
      onData, onReady, onExit, onStatus,
      closed: false,
    };
    this.streams.set(id, stream);
    window.clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    this.ensure();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.sendOpen(stream);
    return {
      id,
      write: (bytes) => this.writeBytes(id, bytes),
      resize: (c, r) => this.resize(id, c, r),
      // detach：viewer 走人，shell 恒不死（§4.4）。收起分屏、切走频道、卸载
      // 组件都走这条，恒不走 close。
      detach: () => this.drop(id, 'detach'),
      // close：真的不要这个 shell 了。
      close: () => this.drop(id, 'close'),
    };
  }

  drop(id, verb) {
    const stream = this.streams.get(id);
    if (!stream) return;
    stream.closed = true;
    this.streams.delete(id);
    if (verb === 'close') writeSession(stream.channelId, '');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: verb, id }));
    }
    // 没有终端了就把连接收掉，恒不留一条空转的 WS 在那里 ping——但要**缓一拍**。
    // React 的 StrictMode 会在开发期把每次挂载拆成"挂载→卸载→再挂载"，紧接着
    // 的那次重挂如果撞上立刻关闭，就会把一条还在 CONNECTING 的 socket 关掉，
    // 浏览器报 "closed before the connection is established"。缓一拍让重挂复用
    // 同一条连接；真的没人要了，一拍之后照样收。
    this.scheduleIdleShutdown();
  }

  scheduleIdleShutdown() {
    if (this.streams.size) return;
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (!this.streams.size) this.shutdown();
    }, 250);
  }

  shutdown() {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.idleTimer);
    this.timer = 0;
    this.idleTimer = 0;
    // opening 恒须一并清掉：漏了它，下一次 ensure() 会以为"正在连"而直接返回，
    // 于是永远连不上——而且症状只在"关掉又立刻要"时出现，恒难查。
    this.opening = false;
    const ws = this.ws;
    this.ws = null;
    this.attempt = 0;
    if (ws) {
      ws.onclose = null;
      try { ws.close(); } catch { /* already gone */ }
    }
  }

  // 同一条连接上恒只 open 一次。attach 时连接可能已经是 OPEN（于是这里直接
  // 发），也可能还在 CONNECTING（于是由 onopen 统一补发）——两条路都会走到
  // 这里，用"这条流在这条连接上开过没有"来判，恒不靠时序。
  sendOpen(stream) {
    if (stream.sentOn === this.ws) return;
    stream.sentOn = this.ws;
    this.ws.send(JSON.stringify({
      type: 'open',
      id: stream.id,
      channel_id: stream.channelId,
      session: stream.session || undefined,
      cols: stream.cols,
      rows: stream.rows,
    }));
  }

  writeBytes(id, bytes) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const stream = this.streams.get(id);
    if (!stream?.ready) return;
    this.ws.send(encodeFrame(id, bytes));
  }

  resize(id, cols, rows) {
    const stream = this.streams.get(id);
    if (!stream) return;
    stream.cols = cols;
    stream.rows = rows;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && stream.ready) {
      this.ws.send(JSON.stringify({ type: 'resize', id, cols, rows }));
    }
  }

  ensure() {
    if (this.ws || this.opening || !this.streams.size) return;
    this.opening = true;
    const ws = new WebSocket(ptyURL());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.opening = false;
      // 退避计数恒不在这里清零。"TCP 握上了"证明不了这条连接有用：门可能
      // 接下来就把它关掉（节点在重启、鉴权掉了、设备不在线）。在 onopen 清零
      // 等于永远退不到底，人看到的是永远"重连中"、永远等不到那个出口。
      // 清零的信号恒是 ready——真的开出一条流来了，才算这次连接成立。
      // 重连后把所有还活着的流一次补开回来。每条各带自己的 session id，
      // 于是各自接回各自那个 shell，屏幕由服务端回放。
      for (const stream of this.streams.values()) {
        stream.ready = false;
        stream.session = readSession(stream.channelId);
        stream.onStatus?.('connecting');
        this.sendOpen(stream);
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        const view = new Uint8Array(event.data);
        if (view.length < STREAM_HEADER) return;
        const id = new DataView(event.data).getUint32(0, false);
        this.streams.get(id)?.onData?.(view.subarray(STREAM_HEADER));
        return;
      }
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const stream = this.streams.get(msg.id);
      if (!stream) return;
      if (msg.type === 'ready') {
        this.attempt = 0;
        stream.ready = true;
        stream.session = msg.session || '';
        writeSession(stream.channelId, stream.session);
        stream.onReady?.(stream.session);
        stream.onStatus?.('open');
        return;
      }
      if (msg.type === 'exit') {
        // shell 真的退出了：清掉 session id，否则下次拿着一个死 id 去接。
        writeSession(stream.channelId, '');
        this.streams.delete(msg.id);
        stream.onExit?.(msg.reason || 'session ended');
        this.scheduleIdleShutdown();
        return;
      }
      if (msg.type === 'error') {
        // 带着一个 session id 却被拒：那个会话已经不在了（宽限期过了，或者节点
        // 重启过）。**必须把 id 丢掉重开一次**，否则就是拿着死 id 无限重试——
        // 人看到的就是永远"重连中"的黑屏。
        if (stream.session) {
          writeSession(stream.channelId, '');
          stream.session = '';
          stream.sentOn = null; // 这是**换一个请求**重开，恒不是重复的 open
          this.sendOpen(stream);
          return;
        }
        this.streams.delete(msg.id);
        stream.onExit?.(msg.detail || '无法打开终端');
        this.scheduleIdleShutdown();
      }
    };

    ws.onclose = () => {
      this.opening = false;
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.streams.size) return;
      for (const stream of this.streams.values()) {
        stream.ready = false;
        stream.onStatus?.('reconnecting');
      }
      if (this.attempt >= RECONNECT_DELAYS.length) {
        for (const stream of this.streams.values()) stream.onStatus?.('ended', '连不上终端——设备可能不在线');
        return;
      }
      const delay = RECONNECT_DELAYS[Math.min(this.attempt, RECONNECT_DELAYS.length - 1)];
      this.attempt += 1;
      this.timer = window.setTimeout(() => this.ensure(), delay);
    };
  }
}

let client = null;
export function ptyClient() {
  if (!client) client = new PtyClient();
  return client;
}

// 测试用：把单例扔掉，下一次 ptyClient() 拿到一个干净的。
export function resetPtyClient() { client = null; }
