// Pure DOM readings shared by the two reading containers.
//
// Every function here only READS. None of them writes scrollTop, scrollTo or
// any style; the following container is structurally pinned by
// `flex-direction: column-reverse` and has no geometry writer at all.
//
// These are lifted verbatim (behaviour-identical) from LegendMessageList so the
// two containers report the SAME observation shape to ReadingSession. When this
// experiment is integrated, LegendMessageList should import them from here
// instead of keeping its private copies — see Q.md "接手指引".

export function fixedWaitingReserve(root) {
  if (!root || root.nodeType !== 1) return 0;
  return Math.max(0, Number.parseFloat(
    globalThis.getComputedStyle?.(root)?.getPropertyValue('--conversation-waiting-reserve') || '0',
  ) || 0);
}

export function isReadingSurfaceVisible(root) {
  if (!root) return false;
  const rect = root.getBoundingClientRect?.();
  const style = globalThis.getComputedStyle?.(root);
  return Boolean(
    rect?.width > 0
    && rect?.height > 0
    && style?.display !== 'none'
    && style?.visibility !== 'hidden',
  );
}

export function installedHighSeq(root, rows) {
  if (!root || !rows?.length) return 0;
  const seqByID = new Map(rows.map((row) => [String(row.id), Number(row.seqHigh || 0)]));
  let high = 0;
  for (const node of root.querySelectorAll('[data-presentation-row-id]')) {
    high = Math.max(high, seqByID.get(String(node.dataset.presentationRowId || '')) || 0);
  }
  return high;
}

export function completeViewportUnits(root) {
  if (!root) return 1;
  const viewport = root.getBoundingClientRect?.();
  if (!viewport) return 1;
  const complete = [...root.querySelectorAll('[data-presentation-row-id]')]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= viewport.top - 0.5 && rect.bottom <= viewport.bottom + 0.5;
    }).length;
  return Math.max(1, Math.min(24, complete));
}

export function visibleRowEvidence(root, rows) {
  if (!root || !rows?.length || typeof globalThis.document?.elementFromPoint !== 'function') return Object.freeze([]);
  const rootRect = root.getBoundingClientRect?.();
  if (!rootRect || rootRect.width <= 0 || rootRect.height <= 0) return Object.freeze([]);
  const reserve = fixedWaitingReserve(root);
  const readableBottom = Math.max(rootRect.top, rootRect.bottom - reserve);
  const rowByID = new Map(rows.map((row) => [String(row.id), row]));
  const visible = [];
  for (const node of root.querySelectorAll('[data-presentation-row-id]')) {
    const messageID = String(node.dataset.presentationRowId || '');
    if (!messageID) continue;
    const row = rowByID.get(messageID);
    // The DOM is the committed paint boundary. A live presentation row can
    // land one frame after the snapshot ref used by the scheduled observer;
    // keep its exact ID in the evidence instead of dropping it as "unknown".
    // Sequence evidence remains zero until the next snapshot joins it.
    const style = globalThis.getComputedStyle?.(node);
    const hiddenAncestor = node.closest?.('[hidden], [inert], [aria-hidden="true"]');
    const painted = !hiddenAncestor
      && style?.display !== 'none'
      && style?.visibility !== 'hidden'
      && Number.parseFloat(style?.opacity || '1') > 0
      && (typeof node.checkVisibility !== 'function' || node.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      }));
    if (!painted) continue;
    const rect = node.getBoundingClientRect();
    const left = Math.max(rootRect.left, rect.left);
    const right = Math.min(rootRect.right, rect.right);
    const top = Math.max(rootRect.top, rect.top);
    const bottom = Math.min(readableBottom, rect.bottom);
    if (right - left <= 1 || bottom - top <= 1) continue;
    const xs = [(left + right) / 2];
    const ys = [top + 1, (top + bottom) / 2, bottom - 1];
    const ownsVisiblePoint = ys.some((y) => xs.some((x) => {
      const hit = globalThis.document.elementFromPoint(x, y);
      return Boolean(hit && (hit === node || node.contains(hit)));
    }));
    if (!ownsVisiblePoint) continue;
    visible.push(Object.freeze({ messageID, seqHigh: Number(row?.seqHigh || 0) }));
  }
  return Object.freeze(visible);
}

// The topmost row that still has pixels inside the viewport, plus the row-local
// offset the restore contract consumes. This is the handoff payload that lets
// Virtuoso mount on exactly the row the follower was looking at.
export function topVisibleBookmark(root, rows) {
  if (!root || !rows?.length) return null;
  const rootRect = root.getBoundingClientRect?.();
  if (!rootRect) return null;
  const rowNode = [...root.querySelectorAll('[data-presentation-row-id]')]
    .filter((node) => node.getBoundingClientRect().bottom > rootRect.top + 0.5)
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] || null;
  if (!rowNode) return null;
  const messageID = String(rowNode.dataset.presentationRowId || '');
  const index = rows.findIndex((row) => row.id === messageID);
  if (index < 0) return null;
  const rowRect = rowNode.getBoundingClientRect();
  return Object.freeze({
    messageID,
    rowViewportOffset: rowRect.top - rootRect.top,
    viewportOffset: rowRect.top - rootRect.top,
    seq: Number(rows[index]?.seqLow || 0),
    predecessorID: index > 0 ? rows[index - 1].id : '',
    successorID: index + 1 < rows.length ? rows[index + 1].id : '',
  });
}
