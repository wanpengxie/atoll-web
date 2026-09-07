// 可拖宽的面板：左侧频道栏、右侧上下文面板（普通 / 文件预览两种宽度分开记）。
// 宽度是读者的偏好，落 localStorage；没拖过就不写，让 CSS 的默认值生效。

export const PANE_KINDS = Object.freeze({
  rail: { min: 200, max: 520, step: 16 },
  // 右侧面板的上限随视口走：至少给对话区留出 workspaceReserve。
  context: { min: 300, workspaceReserve: 420, step: 16 },
  artifact: { min: 420, workspaceReserve: 360, step: 16 },
});

const STORAGE_PREFIX = 'atoll.web.pane.';

export function clampPaneWidth(kind, width, viewportWidth = Number.POSITIVE_INFINITY) {
  const limits = PANE_KINDS[kind];
  if (!limits) throw new Error(`unknown pane kind: ${kind}`);
  const value = Number(width);
  if (!Number.isFinite(value)) return null;
  const max = limits.max ?? Math.max(limits.min, viewportWidth - limits.workspaceReserve);
  return Math.round(Math.min(max, Math.max(limits.min, value)));
}

export function readPaneWidth(kind, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + kind);
    if (raw === null || raw === undefined || raw === '') return null;
    return clampPaneWidth(kind, Number(raw));
  } catch {
    return null;
  }
}

export function writePaneWidth(kind, width, storage = globalThis.localStorage) {
  try {
    if (width === null || width === undefined) storage?.removeItem(STORAGE_PREFIX + kind);
    else storage?.setItem(STORAGE_PREFIX + kind, String(Math.round(width)));
  } catch { /* private mode: 本次会话内仍然生效，只是不记 */ }
}
