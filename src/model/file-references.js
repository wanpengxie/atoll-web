function mediaTypeFromFileName(name) {
  const extension = String(name || '').split('.').pop()?.toLowerCase();
  return ({
    avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
    md: 'text/markdown', txt: 'text/plain', json: 'application/json',
    pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
  })[extension] || 'application/octet-stream';
}

// Markdown 的 href 是 URI 形态，文件门需要的是 daemon 看到的宿主路径。
// 只解码 URI 字符，不把普通文本、相对链接或 //host/path 猜成文件。
export function parseFileReference(href) {
  const raw = String(href || '');
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  let decoded;
  try {
    decoded = decodeURI(raw);
  } catch {
    return null;
  }
  const located = decoded.match(/^(.*):([1-9]\d*)$/);
  const path = located ? located[1] : decoded;
  if (!path.startsWith('/') || path === '/') return null;
  const line = located ? Number(located[2]) : 0;
  if (located && !Number.isSafeInteger(line)) return null;
  return {
    path,
    ...(located ? { line } : {}),
  };
}

export function attachmentFromFileReference(reference) {
  // A stored file (oss://…) is named by its address; its bytes come from the
  // storage seat, not from a host path.
  const address = String(reference?.address || '');
  if (address) {
    const name = String(reference?.name || address.split('/').filter(Boolean).pop() || address);
    return { resource_id: address, name, media_type: mediaTypeFromFileName(name), file_reference: true };
  }
  const path = String(reference?.path || '');
  const name = path.split('/').filter(Boolean).pop() || path;
  return {
    resource_id: path,
    name,
    media_type: mediaTypeFromFileName(name),
    file_reference: true,
    ...(Number.isSafeInteger(reference?.line) && reference.line > 0 ? { line: reference.line } : {}),
  };
}
