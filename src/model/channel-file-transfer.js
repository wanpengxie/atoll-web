import { normalizeDirectory } from './channel-files.js';
import { attachmentFromResource, createFileTicket, fileAddress } from './resources.js';

export function safeUploadName(name) {
  return String(name || 'upload').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+/, '') || 'upload';
}

export function mediaTypeFromFileName(name, declared = '') {
  if (declared) return declared;
  const extension = String(name).split('.').pop()?.toLowerCase();
  return ({
    md: 'text/markdown', txt: 'text/plain', log: 'text/plain',
    go: 'text/plain', js: 'text/javascript', jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain',
    py: 'text/plain', rs: 'text/plain', java: 'text/plain', c: 'text/plain', cc: 'text/plain', cpp: 'text/plain', h: 'text/plain', hpp: 'text/plain',
    sh: 'text/plain', bash: 'text/plain', zsh: 'text/plain', css: 'text/css', html: 'text/html', xml: 'text/xml',
    yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', sql: 'text/plain',
    json: 'application/json', csv: 'text/csv', pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    mp3: 'audio/mpeg', mp4: 'video/mp4',
  })[extension] || 'application/octet-stream';
}

// 传输带频道和票，仅此两样。票的作用域就是（频道, actor）：频道由请求写明，跟其他
// 每一条业务帧一样；actor 由服务端从会话解析出来，客户端说了不算。文件在哪台机器、
// 哪个路径、读还是写，都是发票那一刻由 access 门定死的，服务端从票里读——地址写在
// URL 上只是复述一个客户端改不动的决定，而复述就要约定转义写法，浏览器的
// encodeURIComponent 和 Go 的 PathEscape 对冒号处理不同，曾让上传下载一律 400。
export function fileTransferURL(channelId, ticket) {
  return `/files?channel_id=${encodeURIComponent(channelId)}&t=${encodeURIComponent(ticket)}`;
}

// resource create 由当前登录会话发送，因此账本中的上传主体是用户，而不是 agent。
export async function uploadChannelFile({ file, channel, deviceId, directory = '', onResource, fetchImpl = fetch }) {
  if (!file || !channel?.id || !deviceId || !onResource) throw new TypeError('上传上下文不完整');
  const path = `${normalizeDirectory(directory)}${safeUploadName(file.name)}`;
  const address = fileAddress({ deviceId, channelId: channel.id, path });
  const ticket = await onResource(createFileTicket({ channelId: channel.id, address }));
  if (!ticket?.ticket) throw new TypeError('服务端没有返回上传凭据');
  const response = await fetchImpl(fileTransferURL(channel.id, ticket.ticket), { method: 'PUT', credentials: 'include', body: file });
  if (!response.ok) throw new TypeError(`上传失败 (${response.status})`);
  return attachmentFromResource({
    // 文件资源的 id 就是它的地址；服务端在回执里把它回述一遍，对不上就以服务端为准。
    resourceId: ticket.resource_id || address,
    address,
    file: { name: file.name, type: file.type || mediaTypeFromFileName(file.name), size: file.size },
  });
}
