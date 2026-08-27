export const RESOURCE_OPS = Object.freeze(['create', 'read', 'write', 'delete', 'stat', 'list']);

export function resourceId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/%~-]{0,4094}$/.test(id)) throw new TypeError('资源 ID 格式无效');
  return id;
}

// 文件读取还接受 accessdoor 已有的 device-local 绝对路径解析面。只在 read
// helper 放宽；create/write/delete 等写面继续要求规范 ResourceID/address。
export function readableResourceId(value) {
  const raw = String(value || '');
  if (!raw.startsWith('/')) return resourceId(raw);
  if (raw.length > 4095 || /[\u0000-\u001f\u007f]/.test(raw)) throw new TypeError('文件路径格式无效');
  return raw;
}

export function kvResource({ channelId, op, id = '', args, query, target, ops }) {
  if (!channelId) throw new TypeError('频道不能为空');
  if (!RESOURCE_OPS.includes(op)) throw new TypeError('未知资源操作');
  const payload = { channel_id: channelId, op };
  if (op !== 'list') payload.resource_id = resourceId(id);
  if (args !== undefined) payload.args = args;
  if (query !== undefined) payload.query = query;
  if (target !== undefined) payload.target = target;
  if (ops !== undefined) payload.ops = ops;
  return payload;
}

// daemon 段是设备的名字，不是设备 id——服务端用 ResolveDeviceName 按名字查。
export function fileAddress({ daemonName, qualifiedChannel, path }) {
  const daemon = String(daemonName || '').trim();
  const channel = String(qualifiedChannel || '').trim();
  const cleanPath = String(path || '').trim().replace(/^\/+/, '');
  if (!daemon || !channel || !cleanPath) throw new TypeError('daemon、频道和文件路径不能为空');
  if (cleanPath.split('/').some((part) => !part || part === '.' || part === '..')) throw new TypeError('文件路径不能包含空段、. 或 ..');
  const encodedPath = cleanPath.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `daemon://${daemon}/${channel}/${encodedPath}`;
}

export function createFileTicket({ channelId, address }) {
  if (!channelId || !String(address || '').startsWith('daemon://')) throw new TypeError('文件地址无效');
  return { channel_id: channelId, op: 'create', address, with_content: true };
}

export function createDirectoryResource({ channelId, address }) {
  if (!channelId || !String(address || '').startsWith('daemon://')) throw new TypeError('文件夹地址无效');
  return { channel_id: channelId, op: 'create', address, node_type: 'directory' };
}

export function deleteFileResource({ channelId, resourceId: id }) {
  return { channel_id: channelId, op: 'delete', resource_id: resourceId(id) };
}

export function readFileTicket({ channelId, resourceId: id }) {
  return { channel_id: channelId, op: 'read', resource_id: readableResourceId(id), with_content: true };
}

export function resourceOutcome(value) {
  if (!value) return { phase: 'idle', value: null, error: '' };
  if (value.status === 'ok' && value.ticket) return { phase: 'ticket', value, error: '' };
  if (value.status === 'ok') return { phase: 'completed', value, error: '' };
  return { phase: 'failed', value, error: value.detail || value.reason || value.code || '资源操作失败' };
}

export function attachmentFromResource({ resourceId: id, address = '', file }) {
  return {
    resource_id: resourceId(id),
    ...(address ? { address } : {}),
    name: file?.name || id,
    media_type: file?.type || 'application/octet-stream',
    size: Number(file?.size || 0),
  };
}
