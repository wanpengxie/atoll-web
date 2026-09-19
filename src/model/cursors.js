import { argsOf } from '../protocol/envelope.js';
import { isRailNotifiableDisposition, notificationDisposition } from './notification-policy.js';
import { isSelfActor, relatedEnvelopeIds, relatedEnvelopeIdsIncremental } from './timeline-scope.js';

const CURSOR_PREFIX = 'atoll.cursor.v3.';
// v4 changes the meaning from "every loaded envelope after this seq" to
// "root timeline entries after the last tail the user actually saw". Reusing
// v3 would turn an old, cache-relative number into a false unread boundary.
const READ_PREFIX = 'atoll.read.v4.';
const EXACT_READ_PREFIX = 'atoll.read-identities.v1.';
const NOTIFICATION_PREFIX = 'atoll.notification-high-water.v1.';
const READ_AUTHORITY_KEY = 'atoll.read-authority.v1';
const READ_AUTHORITY_SCHEMA = 1;

function safeNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function createCursors(storage = globalThis.localStorage, { requireReadAuthority = false } = {}) {
  const memory = new Map();
  let readAuthorityReady = !requireReadAuthority;
  let selectedReadAuthority = null;

  function get(key) {
    if (storage) return storage.getItem(key);
    return memory.get(key) ?? null;
  }

  function set(key, value) {
    if (storage) storage.setItem(key, String(value));
    else memory.set(key, String(value));
  }

  function remove(key) {
    if (storage) storage.removeItem(key);
    else memory.delete(key);
  }

  function keys() {
    if (!storage) return [...memory.keys()];
    const result = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) result.push(key);
    }
    return result;
  }

  function exactReadMap(channelId) {
    if (!readAuthorityReady) return new Map();
    try {
      const parsed = JSON.parse(get(`${EXACT_READ_PREFIX}${channelId}`) || '[]');
      return new Map((Array.isArray(parsed) ? parsed : []).filter((entry) => (
        Array.isArray(entry) && entry[0] && safeNumber(entry[1]) > 0
      )).map(([messageID, seq]) => [String(messageID), safeNumber(seq)]));
    } catch {
      return new Map();
    }
  }

  function writeExactReadMap(channelId, values) {
    const key = `${EXACT_READ_PREFIX}${channelId}`;
    if (values.size > 0) set(key, JSON.stringify([...values]));
    else remove(key);
  }

  function notificationState(channelId) {
    if (!readAuthorityReady) return { highWater: 0 };
    try {
      const parsed = JSON.parse(get(`${NOTIFICATION_PREFIX}${channelId}`) || 'null');
      if (!parsed || typeof parsed !== 'object') return { highWater: 0 };
      return { highWater: safeNumber(parsed.highWater) };
    } catch {
      return { highWater: 0 };
    }
  }

  function writeNotificationState(channelId, state) {
    set(`${NOTIFICATION_PREFIX}${channelId}`, JSON.stringify({
      highWater: safeNumber(state.highWater),
    }));
  }

  return {
    destroy() {
      readAuthorityReady = false;
      selectedReadAuthority = null;
      memory.clear();
    },
    selectReadAuthority({ principalId = '', serverBoot = '' } = {}) {
      if (!requireReadAuthority) return Object.freeze({ ready: true, reused: true, changed: false });
      const target = {
        schema: READ_AUTHORITY_SCHEMA,
        principalId: String(principalId || ''),
        serverBoot: String(serverBoot || ''),
      };
      if (!target.principalId || !target.serverBoot) {
        const changed = readAuthorityReady;
        readAuthorityReady = false;
        selectedReadAuthority = null;
        return Object.freeze({ ready: false, reused: false, changed });
      }
      let stored = null;
      try { stored = JSON.parse(get(READ_AUTHORITY_KEY) || 'null'); }
      catch { stored = null; }
      const reused = stored?.schema === READ_AUTHORITY_SCHEMA
        && stored.principalId === target.principalId
        && stored.serverBoot === target.serverBoot;
      if (!reused) {
        for (const key of keys()) {
          if (key.startsWith(READ_PREFIX)
            || key.startsWith(EXACT_READ_PREFIX)
            || key.startsWith(NOTIFICATION_PREFIX)) remove(key);
        }
        set(READ_AUTHORITY_KEY, JSON.stringify(target));
      }
      const changed = !readAuthorityReady
        || selectedReadAuthority?.principalId !== target.principalId
        || selectedReadAuthority?.serverBoot !== target.serverBoot;
      selectedReadAuthority = target;
      readAuthorityReady = true;
      return Object.freeze({ ready: true, reused, changed });
    },
    clearReadAuthority() {
      if (!requireReadAuthority) return false;
      const changed = readAuthorityReady;
      readAuthorityReady = false;
      selectedReadAuthority = null;
      return changed;
    },
    isReadAuthorityReady() {
      return readAuthorityReady;
    },
    reconcile(available = {}) {
      for (const key of keys()) {
        // Resume cursors are bounded by what IndexedDB can actually restore.
        // Read cursors are user state, not cache state: FIFO eviction must not
        // make old history unread again.
        if (!key.startsWith(CURSOR_PREFIX)) continue;
        const channelId = key.slice(CURSOR_PREFIX.length);
        const maximum = safeNumber(available[channelId]);
        const current = safeNumber(get(key));
        if (current > maximum) set(key, maximum);
      }
    },
    snapshot() {
      const result = {};
      for (const key of keys()) {
        if (!key.startsWith(CURSOR_PREFIX)) continue;
        result[key.slice(CURSOR_PREFIX.length)] = safeNumber(get(key));
      }
      return result;
    },
    value(channelId) {
      return safeNumber(get(`${CURSOR_PREFIX}${channelId}`));
    },
    advance(channelId, seq) {
      const current = this.value(channelId);
      const next = Math.max(current, safeNumber(seq));
      set(`${CURSOR_PREFIX}${channelId}`, next);
      return next;
    },
    read(channelId) {
      if (!readAuthorityReady) return 0;
      return safeNumber(get(`${READ_PREFIX}${channelId}`));
    },
    hasRead(channelId) {
      if (!readAuthorityReady) return false;
      return get(`${READ_PREFIX}${channelId}`) != null;
    },
    baselineRead(channelId, seq) {
      if (!readAuthorityReady || !channelId) return 0;
      const key = `${READ_PREFIX}${channelId}`;
      const head = safeNumber(seq);
      const raw = get(key);
      // No local read fact means "start observing after this attach snapshot",
      // not "all hydrated history since seq zero is unread". A cursor above
      // the current head belongs to a replaced/truncated ledger and is clamped.
      const stored = Number(raw);
      const storedValid = raw != null && Number.isSafeInteger(stored) && stored >= 0;
      if (!storedValid || stored > head) set(key, head);
      const readSeq = this.read(channelId);
      const exact = exactReadMap(channelId);
      for (const [messageID, high] of exact) {
        if (high <= readSeq || high > head) exact.delete(messageID);
      }
      writeExactReadMap(channelId, exact);
      return readSeq;
    },
    markRead(channelId, seq) {
      if (!readAuthorityReady) return 0;
      const current = this.read(channelId);
      const next = Math.max(current, safeNumber(seq));
      set(`${READ_PREFIX}${channelId}`, next);
      const exact = exactReadMap(channelId);
      for (const [messageID, high] of exact) if (high <= next) exact.delete(messageID);
      writeExactReadMap(channelId, exact);
      return next;
    },
    notificationHighWater(channelId) {
      if (!readAuthorityReady) return 0;
      return notificationState(channelId).highWater;
    },
    baselineNotifications(channelId, seq) {
      if (!readAuthorityReady || !channelId) return 0;
      const key = `${NOTIFICATION_PREFIX}${channelId}`;
      if (get(key) == null) {
        const head = safeNumber(seq);
        const highWater = Math.min(head, this.read(channelId));
        writeNotificationState(channelId, { highWater });
      }
      return this.notificationHighWater(channelId);
    },
    acknowledgeNotifications(channelId, seq) {
      if (!readAuthorityReady || !channelId) return 0;
      const current = notificationState(channelId);
      const next = Math.max(current.highWater, safeNumber(seq));
      writeNotificationState(channelId, { highWater: next });
      return next;
    },
    acknowledgeReadIdentities(channelId, identities = []) {
      if (!readAuthorityReady) return false;
      const exact = exactReadMap(channelId);
      let changed = false;
      for (const identity of identities) {
        const messageID = String(identity?.messageID || '');
        const seqHigh = safeNumber(identity?.seqHigh);
        if (!messageID || !seqHigh || seqHigh <= this.read(channelId)) continue;
        if ((exact.get(messageID) || 0) >= seqHigh) continue;
        exact.set(messageID, seqHigh);
        changed = true;
      }
      if (changed) writeExactReadMap(channelId, exact);
      return changed;
    },
    acknowledgedReadIdentities(channelId) {
      if (!readAuthorityReady) return new Map();
      return new Map(exactReadMap(channelId));
    },
    resetReads() {
      for (const key of keys()) {
        // Notification acknowledgement belongs to the selected principal/boot
        // authority, not to the disposable Replica/cache. Authority selection
        // clears it on a genuine world change; a same-world force reset must
        // not resurrect badges the user already dismissed at the tail.
        if (key.startsWith(READ_PREFIX) || key.startsWith(EXACT_READ_PREFIX)) remove(key);
      }
    },
  };
}

// Channel badges are notifications, not a ledger row counter. One request may
// produce many queued/processing/deferred response frames while an agent works;
// those frames update the existing turn and must not look like new messages.
// Keep only requests that already have a conversation row, protocol-final
// responses with actual readable content whose canonical turn remains visible.
// Standalone public events can become viewport dynamics, but remain too noisy
// for channel badges under the established rail contract.
// Processing remains a lifecycle update even when Presentation installs the
// row. A positive classification prevents namespaced progress, missing/future
// statuses, timer transport, and internal tool turns from becoming badges.
function isNotifiable(channelState, envelope, selfId = '') {
  return isRailNotifiableDisposition(notificationDisposition(channelState, envelope, selfId));
}

function visitUnreadRows(channelState, readSeq, visit) {
  const order = channelState?._rowOrder;
  const maxima = channelState?._rowMaxSeq;
  if (Array.isArray(order) && Array.isArray(maxima) && order.length === maxima.length) {
    // 倒着只走 cursor 之后的尾巴。历史页可能较晚插入但 seq 更小，所以用这个
    // 位置之前的 prefix max 判定“更前面绝无未读”，不能拿当前 seq 直接 break。
    for (let index = order.length - 1; index >= 0; index -= 1) {
      if (maxima[index] <= readSeq) break;
      const seq = order[index];
      if (seq <= readSeq) continue;
      const envelope = channelState.rows.get(seq);
      if (envelope) visit(seq, envelope);
    }
    return;
  }
  for (const [seq, envelope] of channelState.rows) {
    if (seq > readSeq) visit(seq, envelope);
  }
}

function acknowledgedAt(acknowledged, messageID, seq) {
  if (!messageID || !(acknowledged instanceof Map)) return false;
  const rowSeq = safeNumber(seq);
  return rowSeq > 0 && safeNumber(acknowledged.get(messageID)) >= rowSeq;
}

export function unreadCount(channelState, readSeq, selfId, { acknowledged = new Map() } = {}) {
  if (!channelState?.rows) return 0;
  let count = 0;
  visitUnreadRows(channelState, readSeq, (seq, envelope) => {
    if (envelope?.visibility === 'system') return;
    if (isSelfActor(envelope?.sender?.id, selfId)) return;
    if (!isNotifiable(channelState, envelope, selfId)) return;
    if (acknowledgedAt(acknowledged, envelope?.id, seq)
      || acknowledgedAt(acknowledged, envelope?.parent_id, seq)
      || acknowledgedAt(acknowledged, envelope?.correlation_id, seq)) return;
    count += 1;
  });
  return count;
}

// The channel rail carries two different signals:
//   related — messages in the same conversation scope as the "@我" timeline
//   total   — every new conversational request/settled response not authored
//             by this user
//
// Keep one read cursor for both. They describe the same unread interval; only
// the visual priority differs. In particular, generic system traffic belongs
// to total but cannot become a strong notification unless it is genuinely in
// one of this user's conversations.
// incremental:与时间线共用那张增量索引(输出等价,见 timeline-scope.js)。这个函数
// 被每个频道各叫一次,而它里面那趟 relatedEnvelopeIds 是"把整本账复制一遍再走两
// 遍"——频道多、账本长的时候,它比时间线投影还贵。
function projectUnreadCounts(channelState, readSeq, selfId, {
  incremental = false,
  acknowledged = new Map(),
  diagnostics = false,
  diagnosticLimit = 200,
} = {}) {
  if (!channelState?.rows) return { related: 0, total: 0 };
  const relatedIds = incremental ? relatedEnvelopeIdsIncremental(channelState, selfId) : relatedEnvelopeIds(channelState, selfId);
  // fold 已经为 parent 路由维护了同一份 id 索引；未读投影复用它，避免每次
  // App 渲染都先把每个频道的整本账复制成另一张临时 Map。手工构造的旧状态和
  // 单元测试没有该索引时仍保持原来的纯函数行为。
  let byId = channelState._envelopesById;
  if (!byId) {
    byId = new Map();
    for (const envelope of channelState.rows.values()) {
      if (envelope?.id) byId.set(envelope.id, envelope);
    }
  }

  function rootId(envelope) {
    let current = envelope;
    const seen = new Set();
    while (current?.parent_id && !seen.has(current.parent_id)) {
      seen.add(current.parent_id);
      const parent = byId.get(current.parent_id);
      // Live terminal frames can beat the historical request body into the
      // local replica. correlation_id/parent_id still names the root turn, so
      // missing hydration must not temporarily count every terminal frame as
      // a separate notification.
      if (!parent) return current.correlation_id || envelope?.correlation_id || current.parent_id;
      current = parent;
    }
    return current?.id || envelope?.id || '';
  }

  const totalRoots = new Set();
  const relatedRoots = new Set();
  const diagnosticRows = [];
  const recordDiagnostic = (seq, envelope, root, ackReason) => {
    if (!diagnostics || diagnosticRows.length >= diagnosticLimit) return;
    diagnosticRows.push(Object.freeze({
      id: String(root || envelope?.id || ''),
      type: String(envelope?.type || ''),
      kind: String(envelope?.kind || ''),
      status: String(argsOf(envelope)?.status || ''),
      seq: safeNumber(seq),
      ackReason: String(ackReason || ''),
    }));
  };
  visitUnreadRows(channelState, readSeq, (seq, envelope) => {
    if (isSelfActor(envelope?.sender?.id, selfId)) {
      recordDiagnostic(seq, envelope, '', 'self');
      return;
    }
    const disposition = notificationDisposition(channelState, envelope, selfId);
    if (!isRailNotifiableDisposition(disposition)) {
      recordDiagnostic(seq, envelope, '', disposition);
      return;
    }
    const root = rootId(envelope);
    if (!root) {
      recordDiagnostic(seq, envelope, '', 'missing_root');
      return;
    }
    if (acknowledgedAt(acknowledged, root, seq)
      || acknowledgedAt(acknowledged, envelope?.id, seq)) {
      recordDiagnostic(seq, envelope, root, 'exact_visible_ack');
      return;
    }
    if (totalRoots.has(root)) {
      recordDiagnostic(seq, envelope, root, 'duplicate_root');
      return;
    }
    totalRoots.add(root);
    const related = Boolean(envelope?.id && (relatedIds.has(envelope.id) || relatedIds.has(root)));
    if (related) relatedRoots.add(root);
    recordDiagnostic(seq, envelope, root, related ? 'counted_related' : 'counted_other');
  });
  const counts = { related: relatedRoots.size, total: totalRoots.size };
  if (!diagnostics) return counts;
  return Object.freeze({
    counts: Object.freeze(counts),
    rows: Object.freeze(diagnosticRows),
  });
}

export function unreadCounts(channelState, readSeq, selfId, options = {}) {
  return projectUnreadCounts(channelState, readSeq, selfId, options);
}

// Opt-in, local-only evidence for a rail count. It deliberately exports no
// envelope/body/audience/sender data: each bounded row identifies only the
// logical root, protocol category, sequence and the exact count/ack decision.
// This uses the same projection as unreadCounts so diagnostics cannot invent a
// second notification policy while investigating a user's existing badge.
export function unreadCountDiagnostics(channelState, readSeq, selfId, options = {}) {
  return projectUnreadCounts(channelState, readSeq, selfId, {
    ...options,
    diagnostics: true,
  });
}
