import { READING_MODE } from './reading-session.js';

const EMPTY_IDS = Object.freeze([]);
const EMPTY_LEASE = Object.freeze({ activationID: '', visualSlotIDs: EMPTY_IDS });

export function emptyBrowsingFoldLease() {
  return EMPTY_LEASE;
}

function sameIDs(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// Automatic "latest" expansion is a presentation default, not a durable
// reader choice. Once a reader has entered Browsing, collapsing a row merely
// because another row became latest destroys the text being read and lets the
// browser clamp the native coordinate. Keep only the latest rows witnessed by
// this browsing activation, bounded by rows still in the current Presentation.
// Explicit fold overrides remain authoritative in the renderer.
export function reconcileBrowsingFoldLease(current = EMPTY_LEASE, {
  activationID = '',
  mode = READING_MODE.following,
  rows = [],
  bookmarkID = '',
} = {}) {
  if (mode !== READING_MODE.browsing || !activationID) return EMPTY_LEASE;
  const visualSlotIDs = new Set(rows.map((row) => String(row?.visualSlotID || row?.id || '')).filter(Boolean));
  const retained = current.activationID === activationID
    ? current.visualSlotIDs.filter((id) => visualSlotIDs.has(id))
    : [];
  const latest = rows.find((row) => row?.role?.latest === true);
  const latestID = String(latest?.id || '');
  const latestSlotID = String(latest?.visualSlotID || latestID);
  if (latestSlotID && (retained.length === 0 || String(bookmarkID || '') === latestID)) {
    if (!retained.includes(latestSlotID)) retained.push(latestSlotID);
  }
  if (current.activationID === activationID && sameIDs(current.visualSlotIDs, retained)) return current;
  return Object.freeze({ activationID: String(activationID), visualSlotIDs: Object.freeze(retained) });
}
