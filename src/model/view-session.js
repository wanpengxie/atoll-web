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
  };
}

function copyConversation(value = {}) {
  return {
    mode: Object.values(VIEWPORT_MODE).includes(value.mode) ? value.mode : VIEWPORT_MODE.following,
    anchor: value.anchor?.rowID ? {
      rowID: String(value.anchor.rowID),
      offset: Number(value.anchor.offset || 0),
      seq: Number(value.anchor.seq || 0),
    } : null,
    unseenTail: Math.max(0, Number(value.unseenTail || 0)),
    scope: value.scope === TIMELINE_SCOPE.all ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine,
    actorFilter: [...new Set(value.actorFilter || [])].filter(Boolean).sort(),
    foldOverrides: [...(value.foldOverrides || [])]
      .filter((entry) => Array.isArray(entry) && entry.length === 2 && entry[0])
      .map(([id, expanded]) => [id, Boolean(expanded)]),
  };
}

function defaultSession() {
  return { primarySurface: 'conversation', context: null, conversation: defaultConversation() };
}

function copyContext(value) {
  if (!value?.kind || !value?.key) return null;
  return {
    kind: String(value.kind),
    key: String(value.key),
    ...(value.sourceRowID ? { sourceRowID: String(value.sourceRowID) } : {}),
  };
}

function copySession(value = {}) {
  return {
    primarySurface: value.primarySurface === 'tasks' ? 'tasks' : 'conversation',
    context: copyContext(value.context),
    conversation: copyConversation(value.conversation),
  };
}

// One disposable reading session per channel. This store never owns ledger
// rows or history cursors; it only survives Surface remounts caused by channel
// navigation and responsive topology changes.
export function createViewSessionStore() {
  const channels = new Map();

  return Object.freeze({
    read(channelId) {
      return copyConversation((channels.get(channelId) || defaultSession()).conversation);
    },
    readSession(channelId) {
      return copySession(channels.get(channelId) || defaultSession());
    },
    writeConversation(channelId, conversation) {
      if (!channelId) return;
      const current = channels.get(channelId) || defaultSession();
      channels.set(channelId, copySession({
        ...current,
        conversation: { ...current.conversation, ...conversation },
      }));
    },
    writeSurface(channelId, primarySurface) {
      if (!channelId) return;
      const current = channels.get(channelId) || defaultSession();
      channels.set(channelId, copySession({ ...current, primarySurface }));
    },
    writeContext(channelId, context) {
      if (!channelId) return;
      const current = channels.get(channelId) || defaultSession();
      channels.set(channelId, copySession({ ...current, context }));
    },
    forget(channelId) {
      channels.delete(channelId);
    },
  });
}
