import { SYSTEM_ACTOR_ID, TYPES } from '../protocol/vocab.js';

// A host channel reaches a storage channel through a seat: a member whose
// description entry is {body: {class: "channel-seat"}, params: {body: <storage
// channel>}}. The node's roster (/obs/channel/<id>/actors) says such a member
// is `kind: "channel"`, `body: "class channel-seat"`; which channel it fronts
// is only in its entry (system.member.get → params.body, stored as the
// channel's id).
export const STORAGE_SEAT_BODY = 'class channel-seat';
export const STORAGE_REQUEST_TTL_MS = 30_000;
const DESCRIBE_TTL_MS = 15_000;

export function isStorageSeatRow(row) {
  return Boolean(row?.id) && String(row.body || '').trim() === STORAGE_SEAT_BODY;
}

export function storageError(code, message) {
  return Object.assign(new Error(message), { code, detail: message });
}

function offersGetURL(reply) {
  const source = reply?.value && typeof reply.value === 'object' ? reply.value : reply;
  const words = source?.words;
  return Boolean(words && typeof words === 'object' && Object.hasOwn(words, TYPES.storageGetURL));
}

function seatBody(reply) {
  const source = reply?.value && typeof reply.value === 'object' ? reply.value : reply;
  return String(source?.params?.body || source?.effective?.body || source?.config?.body || '');
}

// Which seat of this channel answers for storageChannel (its qualified name).
// Asking a seat what it offers (actor.describe) is quiet — it is never a
// conversation row — so that is asked first: one seat offering
// storage.get_url is the one. Only when several do is each one's entry read
// and matched against the storage channel's id from the channel directory.
export async function identifyStorageSeat({ channelId, storageChannel, seats, directory = [], request }) {
  const missing = () => storageError('storage_seat_missing', `当前频道没有通往 ${storageChannel} 的存储座位，读不到这个文件。`);
  if (!seats.length) throw missing();
  const probes = await Promise.all(seats.map(async (row) => {
    try {
      const reply = await request(channelId, row.id, TYPES.describe, {}, { expiresAtMs: Date.now() + DESCRIBE_TTL_MS });
      return { row, offers: offersGetURL(reply) };
    } catch (error) {
      return { row, error };
    }
  }));
  const offering = probes.filter((probe) => probe.offers).map((probe) => probe.row);
  if (offering.length === 1) return offering[0].id;
  if (!offering.length) {
    const failure = probes.find((probe) => probe.error)?.error;
    if (failure && probes.every((probe) => probe.error)) {
      throw storageError('storage_seat_unavailable', `${storageChannel} 的存储座位暂时没有回应：${failure.detail || failure.message || failure}`);
    }
    throw missing();
  }
  const storageId = String((directory.find((row) => row?.qualified_name === storageChannel) || directory.find((row) => row?.id === storageChannel))?.id || '');
  const matched = [];
  for (const row of offering) {
    let body = '';
    try {
      body = seatBody(await request(channelId, SYSTEM_ACTOR_ID, TYPES.member.get, { member: row.id }));
    } catch {
      continue;
    }
    if (body && (body === storageChannel || (storageId && body === storageId))) matched.push(row);
  }
  if (matched.length === 1) return matched[0].id;
  if (!matched.length) throw missing();
  throw storageError('storage_seat_ambiguous', `当前频道有多个通往 ${storageChannel} 的存储座位，无法确定用哪一个。`);
}

const REPLY_MESSAGES = Object.freeze({
  not_found: '存储里没有这个文件：可能已被删除，或上传后还没有确认。',
  invalid_args: '存储地址里的路径无效。',
  forbidden: '当前频道无权读取这个文件。',
  backend_unavailable: '存储后端暂时不可用，请稍后再试。',
  too_large: '文件超出存储允许的大小。',
});

export function storageReplyError(failure, parsed) {
  const code = String(failure?.code || 'storage_failed');
  const known = REPLY_MESSAGES[code];
  const detail = String(failure?.detail || failure?.message || '');
  const text = known
    ? `${known}${parsed?.address ? `（${parsed.address}）` : ''}`
    : `读取存储文件失败：${detail || code}`;
  return storageError(code, text);
}

function expiryMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

// The completed reply {url, expires_at, size, media_type}. Only an http(s)
// URL is a link the page may load.
export function storageTicket(reply) {
  const source = reply?.value && typeof reply.value === 'object' && reply.value.url ? reply.value : reply;
  const url = String(source?.url || '');
  let parsed = null;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) {
    throw storageError('storage_reply_invalid', '存储服务没有返回可用的链接。');
  }
  const size = Number(source.size);
  return Object.freeze({
    url,
    expiresAtMs: expiryMs(source.expires_at),
    ...(source.size != null && Number.isFinite(size) && size >= 0 ? { size } : {}),
    mediaType: String(source.media_type || ''),
  });
}
