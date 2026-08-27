function cleanSegment(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function displaySegment(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

// daemon 段是设备名字，不是设备 id——服务端按名字解析（ResolveDeviceName）。
export function channelMountRoot({ daemonName, qualifiedChannel }) {
  const daemon = cleanSegment(daemonName);
  const channel = cleanSegment(qualifiedChannel);
  if (!daemon || !channel) throw new TypeError('设备和频道不能为空');
  return `daemon://${daemon}/${channel}/`;
}

export function normalizeDirectory(value = '') {
  const parts = String(value).split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new TypeError('目录不能包含 . 或 ..');
  return parts.length ? `${parts.join('/')}/` : '';
}

export function fileDirectoryPrefix({ daemonName, qualifiedChannel, directory = '' }) {
  const logical = normalizeDirectory(directory);
  const encoded = logical.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/');
  return `${channelMountRoot({ daemonName, qualifiedChannel })}${encoded ? `${encoded}/` : ''}`;
}

export function fileListCommand({ channelId, daemonName, qualifiedChannel, directory = '', cursor = '', limit = 100 }) {
  const prefix = fileDirectoryPrefix({ daemonName, qualifiedChannel, directory });
  return { channel_id: channelId, op: 'list', query: { prefix, limit, ...(cursor ? { cursor } : {}) } };
}

export function directoryEntries(items, prefix) {
  const rows = [];
  for (const item of items || []) {
    const id = String(item?.id || item?.resource_id || item?.address || '');
    if (!id.startsWith(prefix)) continue;
    const relative = id.slice(prefix.length);
    // A file list is one physical directory page. Never synthesize folders
    // from slashes: navigation is determined only by the backend node fact.
    if (!relative || relative.includes('/')) continue;
    const modifiedAt = item.meta?.modified_at || item.meta?.mtime || item.updated_at;
    const nodeType = String(item.meta?.node_type || 'regular');
    const directory = nodeType === 'directory';
    const kind = directory ? 'directory' : nodeType === 'regular' ? 'file' : 'other';
    const name = displaySegment(relative);
    rows.push({
      key: `${directory ? 'dir' : kind}:${id}`,
      kind,
      nodeType,
      name,
      resourceId: id,
      ops: Array.isArray(item.ops) ? item.ops : [],
      // Browser state is a logical path. Encoding happens exactly once, when
      // the state crosses into a resource address or list prefix.
      ...(directory ? { directory: `${name}/` } : {}),
      ...(item.meta?.media_type ? { mediaType: String(item.meta.media_type) } : {}),
      ...(Number.isFinite(Number(item.meta?.size)) ? { size: Number(item.meta.size) } : {}),
      ...(modifiedAt ? { modifiedAt } : {}),
    });
  }
  // The device page is already ordered (directory, regular, other, then
  // path). Preserve it: re-sorting each accumulated page client-side would
  // make later pages jump ahead of rows whose cursor produced them.
  return rows;
}

export function directoryName(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new TypeError('文件夹名称不能为空，也不能包含 / 或 \\');
  return name;
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
