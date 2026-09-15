import { TIMELINE_SCOPE } from './timeline-scope.js';
import { VIEWPORT_MODE } from './conversation-viewport.js';

function defaultConversation() {
  return {
    mode: VIEWPORT_MODE.following,
    anchor: null,
    unseenTail: 0,
    scope: TIMELINE_SCOPE.mine,
    actorFilter: [],
    foldOverrides: [],
    viewportSnapshot: null,
  };
}

function copyViewportSnapshot(value) {
  if (!value?.listKey || !value?.geometryKey || !value?.state || !Array.isArray(value.state.ranges)) return null;
  return {
    listKey: String(value.listKey),
    geometryKey: String(value.geometryKey),
    firstItemIndex: Number(value.firstItemIndex || 0),
    state: {
      scrollTop: Number(value.state.scrollTop || 0),
      ranges: value.state.ranges.map((range) => ({
        startIndex: Number(range.startIndex || 0),
        endIndex: Number(range.endIndex || 0),
        size: Number(range.size || 0),
      })),
    },
  };
}

function copyConversation(value = {}) {
  const mode = Object.values(VIEWPORT_MODE).includes(value.mode) ? value.mode : VIEWPORT_MODE.following;
  const anchor = value.anchor?.rowID ? {
      rowID: String(value.anchor.rowID),
      offset: Number(value.anchor.offset || 0),
      seq: Number(value.anchor.seq || 0),
    } : null;
  return {
    mode,
    anchor,
    unseenTail: Math.max(0, Number(value.unseenTail || 0)),
    scope: value.scope === TIMELINE_SCOPE.all ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine,
    actorFilter: [...new Set(value.actorFilter || [])].filter(Boolean).sort(),
    foldOverrides: [...(value.foldOverrides || [])]
      .filter((entry) => Array.isArray(entry) && entry.length === 2 && entry[0])
      .map(([id, expanded]) => [id, Boolean(expanded)]),
    // Physical measurements are subordinate to semantic reading intent. A
    // following session has exactly one valid destination—the live tail—so a
    // cached scrollTop/range must never override it. Snapshots are useful only
    // as an acceleration for a browsing session that also has a durable row
    // anchor to fall back to.
    viewportSnapshot: mode === VIEWPORT_MODE.browsing && anchor
      ? copyViewportSnapshot(value.viewportSnapshot)
      : null,
  };
}

// One disposable reading session per channel. This store never owns ledger
// rows, history cursors or route state. App routing is the sole owner of the
// active Surface/Context; copying those values here would create an unread
// second truth. This store only survives Conversation remounts caused by
// channel navigation and responsive topology changes. It may also retain a
// disposable renderer measurement snapshot. Restoration is allowed only when
// the exact presentation geometry key still matches, so pixels never become
// a second ledger or navigation truth.
export function createViewSessionStore() {
  const channels = new Map();

  return Object.freeze({
    read(channelId) {
      return copyConversation(channels.get(channelId) || defaultConversation());
    },
    writeConversation(channelId, conversation) {
      if (!channelId) return;
      const current = channels.get(channelId) || defaultConversation();
      channels.set(channelId, copyConversation({ ...current, ...conversation }));
    },
    forget(channelId) {
      channels.delete(channelId);
    },
  });
}
