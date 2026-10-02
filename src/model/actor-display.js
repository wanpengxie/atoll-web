// 成员的显示名只来自名册（后端给的 name）；名字可以重复，只是显示。
// actor id 只整体使用，从不拆开取其中一段。名册里查不到的成员显示成"未知成员"，
// 完整 id 只放在 title、详情这类技术位置。
export function actorIdLabel(actorId) {
  return String(actorId || '').trim();
}

export function actorDisplayName(actor, fallbackId = '') {
  const name = String(actor?.name || '').trim();
  if (name) return name;
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
  return name || unknown;
}
