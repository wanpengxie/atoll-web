export function actorIdLabel(actorId) {
  const id = String(actorId || '').trim();
  if (!id) return '';
  const separator = id.includes('::') ? '::' : ':';
  const segments = id.split(separator);
  // actor_id 的稳定形状是 kind:name:instance（也兼容 kind::name::instance）。
  // UI 只显示中间的业务名；完整身份仍留给 title、详情和技术审计。
  return segments.length >= 3 && segments[1] ? segments[1] : id;
}

export function actorDisplayName(actor, fallbackId = '') {
  const id = String(actor?.id || fallbackId || '').trim();
  const name = String(actor?.name || '').trim();
  return name && name !== id ? name : actorIdLabel(id);
}

export function actorNameMap(roster = []) {
  return new Map(roster.map((actor) => [actor.id, actorDisplayName(actor)]));
}

export function actorNameFromMap(actorId, names, unknown = '未知成员') {
  const id = String(actorId || '').trim();
  if (!id) return unknown;
  const name = String(names?.get?.(id) || '').trim();
  return name && name !== id ? name : actorIdLabel(id) || unknown;
}
