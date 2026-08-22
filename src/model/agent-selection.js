function option(row) {
  if (typeof row === 'string') return { id: row, label: row };
  const id = String(row?.id || row?.value || '');
  if (!id) return null;
  return {
    id,
    label: String(row.label || row.name || id),
    ...(row.description ? { description: String(row.description) } : {}),
  };
}

function optionsOf(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).map(option).filter((row) => {
    if (!row || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

// 临时后端观察契约的唯一适配点。正式 Actor OBS 落地后只需要改这里，
// Composer 和选择器都不感知后端 JSON 的具体形状。
export function normalizeAgentSelection(value) {
  const source = value?.declared || value || {};
  const current = source.current || {};
  const models = optionsOf(source.models);
  const efforts = optionsOf(source.efforts);
  const model = String(current.model || source.model || models[0]?.id || '');
  const effort = String(current.effort || source.effort || efforts[0]?.id || '');
  return {
    actorId: String(source.actor_id || source.actorId || ''),
    current: { model, effort },
    models,
    efforts,
  };
}

export function selectedOption(rows, id) {
  return rows?.find((row) => row.id === id) || (id ? { id, label: id } : null);
}
