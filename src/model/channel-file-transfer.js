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

// 传输只带 ticket。文件在哪台机器、哪个频道、哪个路径、读还是写，都是发票那一刻
// 由 access 门定死的，服务端从票里读；地址写在 URL 上只是客户端复述一个它改不动的
// 决定，而复述就要约定转义写法——浏览器的 encodeURIComponent 和 Go 的 PathEscape
// 对冒号处理不同，曾让所有上传下载一律 400。
export function fileTransferURL(ticket) {
  return `/files?t=${encodeURIComponent(ticket)}`;
}

// resource create 由当前登录会话发送，因此账本中的上传主体是用户，而不是 agent。
// daemonName 是设备名而非设备 id：服务端按名字解析 daemon 地址（ResolveDeviceName）。
export async function uploadChannelFile({ file, channel, daemonName, directory = '', onResource, fetchImpl = fetch }) {
  if (!file || !channel?.id || !daemonName || !onResource) throw new TypeError('上传上下文不完整');
  const qualifiedChannel = channel.qualified_name || channel.id;
  const path = `${normalizeDirectory(directory)}${safeUploadName(file.name)}`;
  const address = fileAddress({ daemonName, qualifiedChannel, path });
  const ticket = await onResource(createFileTicket({ channelId: channel.id, address }));
  if (!ticket?.ticket) throw new TypeError('服务端没有返回上传凭据');
  const response = await fetchImpl(fileTransferURL(ticket.ticket), { method: 'PUT', credentials: 'include', body: file });
  if (!response.ok) throw new TypeError(`上传失败 (${response.status})`);
  return attachmentFromResource({
    resourceId: ticket.resource_id || address,
    address: ticket.address || address,
    file: { name: file.name, type: file.type || mediaTypeFromFileName(file.name), size: file.size },
  });
}
