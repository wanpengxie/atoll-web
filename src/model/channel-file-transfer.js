import { normalizeDirectory } from './channel-files.js';
import { attachmentFromResource, createFileTicket, fileAddress } from './resources.js';

export function safeUploadName(name) {
  return String(name || 'upload').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+/, '') || 'upload';
}

// "application/octet-stream" 不算声明：它是"我不知道"的写法，不是一种类型。消息附件
// 和 agent 引用的文件经常只带这个值，按它判就什么都预览不了；扩展名比它更可信。
export const UNKNOWN_MEDIA_TYPE = 'application/octet-stream';

const MEDIA_TYPE_BY_EXTENSION = Object.freeze({
  md: 'text/markdown', markdown: 'text/markdown', mdown: 'text/markdown', txt: 'text/plain', text: 'text/plain', log: 'text/plain',
  go: 'text/plain', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain',
  py: 'text/plain', rs: 'text/plain', java: 'text/plain', kt: 'text/plain', swift: 'text/plain', rb: 'text/plain', php: 'text/plain',
  c: 'text/plain', cc: 'text/plain', cpp: 'text/plain', cxx: 'text/plain', h: 'text/plain', hpp: 'text/plain',
  sh: 'text/plain', bash: 'text/plain', zsh: 'text/plain', fish: 'text/plain', ps1: 'text/plain', bat: 'text/plain',
  css: 'text/css', scss: 'text/plain', less: 'text/plain', html: 'text/html', htm: 'text/html', xml: 'text/xml', svg: 'image/svg+xml',
  yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', ini: 'text/plain', cfg: 'text/plain', conf: 'text/plain', env: 'text/plain', properties: 'text/plain',
  sql: 'text/plain', graphql: 'text/plain', proto: 'text/plain', diff: 'text/plain', patch: 'text/plain', tex: 'text/plain', rst: 'text/plain', org: 'text/plain',
  json: 'application/json', jsonl: 'application/json', ndjson: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values',
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});

export function mediaTypeFromFileName(name, declared = '') {
  const known = String(declared || '').trim().toLowerCase();
  if (known && known !== UNKNOWN_MEDIA_TYPE) return declared;
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  // 常见的无扩展名文本文件：Makefile、Dockerfile、LICENSE、.gitignore 这一类。
  if (!extension && /^(makefile|dockerfile|license|readme|changelog|authors|todo|\..+)$/i.test(base)) return 'text/plain';
  return MEDIA_TYPE_BY_EXTENSION[extension] || UNKNOWN_MEDIA_TYPE;
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
export async function uploadChannelFile({ file, channel, deviceName, directory = '', onResource, fetchImpl = fetch }) {
  if (!file || !channel?.id || !deviceName || !onResource) throw new TypeError('上传上下文不完整');
  const path = `${normalizeDirectory(directory)}${safeUploadName(file.name)}`;
  const address = fileAddress({ deviceName, channelName: channel.qualified_name || channel.name || channel.id, path });
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
