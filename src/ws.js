// ws.js — native WebSocket client talking to GET /ws (wire v2, 连接模型勘误期).
//
// Wire protocol (matches platform/subjectgate/frame.go + drivers/gateway/connector/web/web.go):
//
//   envelope (both directions): {"v":2, "frame_type":"…", "ref"?:"…", "payload"?:{…}}
//
//   client → server (exactly ONE, the opening frame of the connection):
//     {"v":2,"frame_type":"attach","payload":{"since":{"<channel_id>":<seq>, …}}}
//     `since` may be an EMPTY object (or omitted) — that is legal (a fresh
//     connection with no known cursors yet).
//
//   server → client (attach ack, empty payload):
//     {"v":2,"frame_type":"receipt","ref":"…","payload":{}}
//
//   server → client (feed, one per delivered envelope):
//     {"v":2,"frame_type":"feed","payload":{"channel_id":"…","seq":N,"envelope":{…}}}
//
//   server → client (error):
//     {"v":2,"frame_type":"error","ref"?:"…","payload":{"frame":"…","code":"…","detail"?:"…"}}
//     `code` is one of: bad_payload | forbidden | unavailable | closed (plus a few
//     door-specific codes on business frames this client does not drive directly).
//
// 连接即人 (spec §0/§1): the connection is channel-blind and auto-subscribed to
// EVERY channel the authenticated principal is currently entitled to — there is no
// server-side subscribe/unsubscribe verb anymore (the old {"type":"subscribe"/
// "unsubscribe"} frames are RETIRED; the server's opening-frame gate rejects
// anything that is not a valid v2 attach). `subscribe`/`unsubscribe` below are
// PURELY CLIENT-LOCAL bookkeeping — which channels this ChannelSocket instance
// currently dispatches onMessage for, and (for a channel never covered by the
// connection's live attach `since` map) a request to reconnect with an updated
// attach so that channel's backfill-from-cursor guarantee is honoured.
//
// Auth is by cookie — the gateway re-authenticates via the same session cookie
// the SPA carries (app membrane, cookie→principal, before the ws upgrade).

const FRAME_VERSION = 2;

export class ChannelSocket {
  /**
   * @param {(channelID: string, seq: number, envelope: object) => void} onMessage
   * @param {(frameType: string, code: string, detail?: string) => void} [onError]
   *   Called for every server error frame (bad_payload | forbidden | unavailable |
   *   closed, plus any door-specific code). Optional — defaults to a console.warn
   *   so existing single-argument call sites need no change.
   */
  constructor(onMessage, onError) {
    this.onMessage = onMessage;
    this.onError = onError || ((frameType, code, detail) => {
      console.warn(`[ws] error frame_type=${frameType} code=${code}${detail ? ` detail=${detail}` : ''}`);
    });
    this.ws = null;
    // subscribed: channels this instance currently dispatches onMessage for
    // (CLIENT-LOCAL — the server streams every eligible channel regardless).
    this.subscribed = new Set();
    // sinceSeq: channelID → last-known cursor, used to build the attach `since`
    // map on every (re)connect so backfill-on-attach is preserved across reconnects.
    this.sinceSeq = new Map();
    // attachedSince: the channel ids covered by the CURRENT live connection's
    // attach frame — a subscribe() for a channel outside this set forces a
    // reconnect (only the opening attach frame carries `since`; there is no
    // later verb to add a channel's cursor to an already-open connection).
    this.attachedSince = new Set();
    this.reconnectAttempts = 0;
    this.shouldRun = false;
    this._refCounter = 0;
  }

  start() {
    this.shouldRun = true;
    this._connect();
  }

  stop() {
    this.shouldRun = false;
    if (this.ws) this.ws.close();
    this.ws = null;
    this.subscribed.clear();
    this.attachedSince.clear();
  }

  /**
   * Start dispatching onMessage for channelID. When sinceSeq is a number it is
   * remembered for this and every future attach `since` map (so a reconnect keeps
   * replaying from the caller's last-loaded position). A channel not yet covered
   * by the CURRENT connection's attach map forces a reconnect carrying the
   * updated `since` (the only way this wire form can add a channel's cursor to a
   * live connection — attach is a one-time opening handshake, not a repeatable verb).
   * @param {string} channelID
   * @param {number} [sinceSeq]
   */
  subscribe(channelID, sinceSeq) {
    this.subscribed.add(channelID);
    if (typeof sinceSeq === 'number') {
      this.sinceSeq.set(channelID, sinceSeq);
    }
    if (this.shouldRun && this.ws && this.ws.readyState === WebSocket.OPEN && !this.attachedSince.has(channelID)) {
      // This channel's cursor was never sent in an attach on this connection —
      // reconnect so the new attach's `since` map covers it.
      this.ws.close();
    }
  }

  /** Stop dispatching onMessage for channelID. Purely local — no frame is sent
   * (there is no client-visible unsubscribe verb; the server keeps streaming). */
  unsubscribe(channelID) {
    this.subscribed.delete(channelID);
    this.sinceSeq.delete(channelID);
  }

  _connect() {
    if (!this.shouldRun) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      // The since map covers every channel this instance currently tracks a
      // cursor for (an empty map is legal — a fresh connection with nothing yet).
      const since = {};
      for (const [chID, seq] of this.sinceSeq) since[chID] = seq;
      this.attachedSince = new Set(Object.keys(since));
      this._refCounter += 1;
      const attach = {
        v: FRAME_VERSION,
        frame_type: 'attach',
        ref: `attach-${this._refCounter}`,
        payload: { since },
      };
      ws.send(JSON.stringify(attach));
    });

    ws.addEventListener('message', (ev) => {
      let frame;
      try { frame = JSON.parse(ev.data); } catch { return; }
      if (!frame || frame.v !== FRAME_VERSION) return;
      switch (frame.frame_type) {
        case 'feed': {
          const p = frame.payload || {};
          if (!this.subscribed.has(p.channel_id)) return; // client-local dispatch filter
          this.onMessage(p.channel_id, Number(p.seq), p.envelope);
          return;
        }
        case 'receipt':
          // Attach ack (empty payload) — nothing to do; the connection is live.
          return;
        case 'error': {
          const p = frame.payload || {};
          this.onError(p.frame, p.code, p.detail);
          return;
        }
        default:
          return;
      }
    });

    const handleClose = () => {
      this.attachedSince.clear();
      if (!this.shouldRun) return;
      const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempts, 6));
      this.reconnectAttempts += 1;
      setTimeout(() => this._connect(), delay);
    };
    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', () => ws.close());
  }
}
