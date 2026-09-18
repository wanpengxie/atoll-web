const STORAGE_PREFIX = 'atoll.web.file-reading-history.v1.';
export const FILE_READING_HISTORY_LIMIT = 24;

function storageKey(principalId, worldEpoch) {
  return `${STORAGE_PREFIX}${encodeURIComponent(String(principalId || ''))}.${encodeURIComponent(String(worldEpoch || ''))}`;
}

function safeEntry(value) {
  if (!value || typeof value !== 'object' || !value.channelId || !value.resourceId) return null;
  const size = Number(value.size);
  const line = Number(value.line);
  return {
    key: String(value.key || `recent-file:${value.channelId}:${value.resourceId}`),
    channelId: String(value.channelId),
    resourceId: String(value.resourceId),
    name: String(value.name || value.resourceId),
    mediaType: String(value.mediaType || 'application/octet-stream'),
    ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
    ...(value.kind ? { kind: String(value.kind) } : {}),
    ...(value.preview ? { preview: String(value.preview) } : {}),
    ...(value.mountPath ? { mountPath: String(value.mountPath) } : {}),
    ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    lastOpenedAt: Number.isFinite(Number(value.lastOpenedAt)) ? Number(value.lastOpenedAt) : 0,
    provenance: { source: 'reading_history' },
  };
}

export function rememberFileRead(history, artifact, openedAt = Date.now()) {
  const next = safeEntry({ ...artifact, lastOpenedAt: openedAt });
  if (!next) return Array.isArray(history) ? history : [];
  const rows = (Array.isArray(history) ? history : [])
    .map(safeEntry)
    .filter((row) => row && (row.channelId !== next.channelId || row.resourceId !== next.resourceId));
  return [next, ...rows].slice(0, FILE_READING_HISTORY_LIMIT);
}

export function readFileReadingHistory(principalId, worldEpoch, storage = globalThis.localStorage) {
  if (!principalId || !worldEpoch) return [];
  try {
    const value = JSON.parse(storage?.getItem(storageKey(principalId, worldEpoch)) || '[]');
    return (Array.isArray(value) ? value : []).map(safeEntry).filter(Boolean).slice(0, FILE_READING_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function writeFileReadingHistory(principalId, worldEpoch, history, storage = globalThis.localStorage) {
  if (!principalId || !worldEpoch) return;
  try {
    const rows = (Array.isArray(history) ? history : []).map(safeEntry).filter(Boolean).slice(0, FILE_READING_HISTORY_LIMIT);
    storage?.setItem(storageKey(principalId, worldEpoch), JSON.stringify(rows));
  } catch { /* private mode / quota: 当前标签页内的 React 状态仍然可用 */ }
}
