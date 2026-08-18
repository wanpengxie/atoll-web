function cleanSegment(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function displaySegment(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function channelMountRoot({ daemonId, qualifiedChannel }) {
  const daemon = cleanSegment(daemonId);
  const channel = cleanSegment(qualifiedChannel);
  if (!daemon || !channel) throw new TypeError('设备和频道不能为空');
  return `daemon://${daemon}/${channel}/`;
}

export function normalizeDirectory(value = '') {
  const parts = String(value).split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new TypeError('目录不能包含 . 或 ..');
  return parts.length ? `${parts.join('/')}/` : '';
}

export function fileListCommand({ channelId, daemonId, qualifiedChannel, directory = '' }) {
  const prefix = `${channelMountRoot({ daemonId, qualifiedChannel })}${normalizeDirectory(directory)}`;
  return { channel_id: channelId, op: 'list', query: { prefix } };
}

export function directoryEntries(items, prefix) {
  const rows = new Map();
  for (const item of items || []) {
    const id = String(item?.id || item?.resource_id || item?.address || '');
    if (!id.startsWith(prefix)) continue;
    const relative = id.slice(prefix.length);
    if (!relative) continue;
    const slash = relative.indexOf('/');
    if (slash >= 0) {
      const rawName = relative.slice(0, slash);
      if (rawName && !rows.has(`dir:${rawName}`)) rows.set(`dir:${rawName}`, { key: `dir:${rawName}`, kind: 'directory', name: displaySegment(rawName), directory: `${rawName}/` });
      continue;
    }
    rows.set(`file:${id}`, {
      key: `file:${id}`,
      kind: 'file',
      name: displaySegment(relative),
      resourceId: id,
      ops: Array.isArray(item.ops) ? item.ops : [],
      ...(item.meta?.media_type ? { mediaType: String(item.meta.media_type) } : {}),
      ...(Number.isFinite(Number(item.meta?.size)) ? { size: Number(item.meta.size) } : {}),
    });
  }
  return [...rows.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name, 'zh-CN');
  });
}

export function parentDirectory(directory = '') {
  const parts = normalizeDirectory(directory).split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join('/')}/` : '';
}

export function fileNameFromAddress(address) {
  const value = String(address || '').replace(/\/$/, '');
  const raw = value.slice(value.lastIndexOf('/') + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}
