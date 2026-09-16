// Estimates describe OFFSCREEN space only. The adapter measures every mounted
// row before committing its window and scroll position. This module has no
// timers, DOM or knowledge of network/history operations.
const UNMEASURED_HEIGHT = 96;

export function measuredLayout(rows, measurements, viewportHeight = 0) {
  const offsets = [0];
  const indexes = new Map();
  rows.forEach((row, index) => {
    indexes.set(row.id, index);
    offsets.push(offsets[index] + Math.max(1, measurements.get(row.id)?.size || UNMEASURED_HEIGHT));
  });
  const leading = Math.max(0, viewportHeight - offsets.at(-1));
  return { rows, offsets, indexes, leading, height: offsets.at(-1) + leading };
}

export function rowAt(layout, position) {
  if (!layout.rows.length) return -1;
  const y = Math.max(0, position - layout.leading);
  let low = 0;
  let high = layout.rows.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (layout.offsets[mid + 1] <= y) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function readingAnchor(layout, position) {
  const index = rowAt(layout, position);
  return index < 0 ? null : {
    rowID: layout.rows[index].id,
    offset: layout.leading + layout.offsets[index] - position,
  };
}

export function readingPosition(layout, anchor, fallback = 0) {
  const index = layout.indexes.get(anchor?.rowID);
  return index == null ? fallback : layout.leading + layout.offsets[index] - anchor.offset;
}

export function clampPosition(layout, position, viewportHeight) {
  return Math.max(0, Math.min(Math.max(0, layout.height - viewportHeight), position));
}

export function materializedRange(layout, position, viewportHeight) {
  if (!layout.rows.length) return { start: 0, end: 0 };
  const height = Math.max(1, viewportHeight);
  return {
    start: Math.max(0, rowAt(layout, position - height * 1.5) - 1),
    end: Math.min(layout.rows.length, rowAt(layout, position + height * 2) + 2),
  };
}

// If a row really disappears (e.g. an explicit filter), prefer the closest
// surviving neighbour. A removal is never permission to jump to the tail.
export function survivingAnchor(previous, next, anchor) {
  if (!anchor || next.indexes.has(anchor.rowID)) return anchor;
  const index = previous.indexes.get(anchor.rowID);
  if (index == null) return null;
  for (let distance = 1; distance < previous.rows.length; distance += 1) {
    for (const candidate of [index + distance, index - distance]) {
      const row = previous.rows[candidate];
      if (row && next.indexes.has(row.id)) return { rowID: row.id, offset: anchor.offset };
    }
  }
  return null;
}
