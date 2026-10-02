// 成员的显示名只来自名册（后端给的 name）；名字可以重复，只是显示。
// actor id 只整体使用，从不拆开取其中一段。名册里查不到的成员显示成"未知成员"，
// 完整 id 只放在 title、详情这类技术位置。
export function actorIdLabel(actorId) {
  return String(actorId || '').trim();
}

// 频道自己的 system actor 是固定的 well-known id（不是拆出来的），名册里没有名字，
// 照基线显示成 system。
const SYSTEM_ACTOR_ID = 'system';

export function actorDisplayName(actor, fallbackId = '') {
  const name = String(actor?.name || '').trim();
  if (name) return name;
  if (String(actor?.id || fallbackId || '').trim() === SYSTEM_ACTOR_ID) return SYSTEM_ACTOR_ID;
  // 名字留空的成员：用它从什么造（"class kimi"）当显示，都没有就是"未命名成员"。
  const body = String(actor?.body || '').trim();
  if (body && body !== 'generated') return body;
  return String(actor?.id || fallbackId || '').trim() ? '未命名成员' : '';
}

export function actorNameMap(roster = []) {
  return new Map(roster.map((actor) => [actor.id, actorDisplayName(actor)]));
}

export function actorNameFromMap(actorId, names, unknown = '未知成员') {
  const id = String(actorId || '').trim();
  if (!id) return unknown;
  const name = String(names?.get?.(id) || '').trim();
  return name || (id === SYSTEM_ACTOR_ID ? SYSTEM_ACTOR_ID : unknown);
}
