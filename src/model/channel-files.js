function cleanSegment(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function displaySegment(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function channelDefaultStorageDeviceId(channel, devices = []) {
  const projected = devices.find((row) => row?.defaultStorage === true)?.id;
  return String(projected || channel?.default_storage_device_id || 'local-device').trim();
}

// The channel declares its starting mount. Never substitute daemons[0]: the
// space daemon list is not a storage policy and its order carries no intent.
export function availableDefaultStorageDeviceId(channel, devices = []) {
  const configured = channelDefaultStorageDeviceId(channel, devices);
  return devices.some((row) => row?.id === configured) ? configured : '';
}

// Resource addresses carry registry identities, never mutable labels.
export function channelMountRoot({ deviceId, channelId }) {
  const device = cleanSegment(deviceId);
  const channel = cleanSegment(channelId);
  if (!device || !channel) throw new TypeError('设备和频道不能为空');
  return `daemon://${device}/${channel}/`;
}

export function normalizeDirectory(value = '') {
  const parts = String(value).split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new TypeError('目录不能包含 . 或 ..');
  return parts.length ? `${parts.join('/')}/` : '';
}

export function fileDirectoryPrefix({ deviceId, channelId, directory = '' }) {
  const logical = normalizeDirectory(directory);
  const encoded = logical.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/');
  return `${channelMountRoot({ deviceId, channelId })}${encoded ? `${encoded}/` : ''}`;
}

export function fileListCommand({ channelId, deviceId, directory = '', cursor = '', limit = 100 }) {
  const prefix = fileDirectoryPrefix({ deviceId, channelId, directory });
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
