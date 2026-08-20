import { normalizeDirectory } from './channel-files.js';
import { attachmentFromResource, createFileTicket, fileAddress } from './resources.js';

export function safeUploadName(name) {
  return String(name || 'upload').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+/, '') || 'upload';
}

export function mediaTypeFromFileName(name, declared = '') {
  if (declared) return declared;
  const extension = String(name).split('.').pop()?.toLowerCase();
  return ({ md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', mp4: 'video/mp4' })[extension] || 'application/octet-stream';
}

export function fileTransferURL(address, ticket) {
  return `/files/${encodeURIComponent(address)}?t=${encodeURIComponent(ticket)}`;
}

// resource create 由当前登录会话发送，因此账本中的上传主体是用户，而不是 agent。
// PUT 只兑换一次性 ticket；消息附件只携带 resource_id/address 和文件元数据。
export async function uploadChannelFile({ file, channel, daemonId, directory = '', onResource, fetchImpl = fetch }) {
  if (!file || !channel?.id || !daemonId || !onResource) throw new TypeError('上传上下文不完整');
  const qualifiedChannel = channel.qualified_name || channel.id;
  const path = `${normalizeDirectory(directory)}${safeUploadName(file.name)}`;
  const address = fileAddress({ daemonId, qualifiedChannel, path });
  const ticket = await onResource(createFileTicket({ channelId: channel.id, address }));
  if (!ticket?.ticket) throw new TypeError('服务端没有返回上传凭据');
  const response = await fetchImpl(fileTransferURL(address, ticket.ticket), { method: 'PUT', credentials: 'include', body: file });
  if (!response.ok) throw new TypeError(`上传失败 (${response.status})`);
  return attachmentFromResource({
    resourceId: ticket.resource_id || address,
    address: ticket.address || address,
    file: { name: file.name, type: file.type || mediaTypeFromFileName(file.name), size: file.size },
  });
}
