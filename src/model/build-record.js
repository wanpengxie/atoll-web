// 构建记录（system.build.started / system.build.finished 的 payload，也是
// system.member.get 的 build）：运行时把写下的描述和配置变成在跑的东西，每次
// 尝试一条记录。失败了就停下，不自动重试，下一个事件（改描述或配置、重启）再建。

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 把一条记录读成固定形状；不是构建记录就给 null。
export function buildRecord(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!plainObject(raw) || !plainObject(raw.object)) return null;
  const kind = text(raw.object.kind);
  if (!kind) return null;
  const attempt = Number(raw.attempt);
  return Object.freeze({
    object: Object.freeze({ kind, channel: text(raw.object.channel), name: text(raw.object.name) }),
    channelRevision: Number(raw.description?.channel_revision || 0),
    actor: text(raw.description?.actor),
    configRevision: plainObject(raw.config) ? Number(raw.config.revision || 0) : null,
    attempt: Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1,
    cause: text(raw.cause),
    result: text(raw.result),
    state: text(raw.state),
    reason: text(raw.reason),
    startedAt: Number(raw.started_at || 0),
    finishedAt: Number(raw.finished_at || 0),
  });
}

export function buildObjectLabel(record) {
  const object = record?.object || {};
  if (object.kind === 'member') return `成员 ${object.name || '?'}`;
  if (object.kind === 'channel') return `频道 ${object.channel || ''}`.trim();
  return object.kind || '对象';
}

const RESULT_LABELS = Object.freeze({ ok: '成功', failed: '失败', superseded: '被新值取代' });
const STATE_LABELS = Object.freeze({
  ready: '已就绪',
  serving: '服务中',
  stopped: '已停止：改描述或配置、或重启后才会再构建',
});

export function buildResultLabel(record) {
  if (!record) return '';
  if (!record.result) return '构建中';
  return RESULT_LABELS[record.result] || record.result;
}

export function buildStateLabel(record) {
  return record?.state ? STATE_LABELS[record.state] || record.state : '';
}

// "第 2 次尝试"
export function buildAttemptLabel(record) {
  if (!record) return '';
  return `第 ${record.attempt} 次尝试`;
}

// 一条记录的一句话：时间线和摘要都用它。
export function buildSummaryText(record, { started = false } = {}) {
  if (!record) return '';
  const label = buildObjectLabel(record);
  if (started || !record.result) return `开始构建${label}（第 ${record.attempt} 次尝试）`;
  if (record.result === 'ok') {
    const state = buildStateLabel(record);
    return `${label}构建成功${state ? `，${state}` : ''}`;
  }
  if (record.result === 'superseded') return `${label}的这次构建被更新的值取代`;
  const state = buildStateLabel(record);
  return `${label}构建失败（第 ${record.attempt} 次尝试${state ? `，${state}` : ''}）${record.reason ? `：${record.reason}` : ''}`;
}

export function buildTone(record) {
  if (!record?.result) return 'pending';
  if (record.result === 'ok') return 'ok';
  if (record.result === 'superseded') return 'muted';
  return 'stopped';
}
