const slash = /[/\\]+/gu;

export function normalizeFeatureDirectory(value = '') {
  const parts = String(value).split(slash).filter((part) => part && part !== '.');
  const safe = [];
  for (const part of parts) {
    if (part === '..') safe.pop();
    else safe.push(part);
  }
  return safe.length ? `${safe.join('/')}/` : '';
}

export function parentFeatureDirectory(value = '') {
  const parts = normalizeFeatureDirectory(value).split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join('/')}/` : '';
}

export function featureFileCrumbs(directory = '', rootName = '文件') {
  const parts = normalizeFeatureDirectory(directory).split('/').filter(Boolean);
  return [{ name: rootName, directory: '' }, ...parts.map((name, index) => ({
    name,
    directory: `${parts.slice(0, index + 1).join('/')}/`,
  }))];
}

export function featureFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
