import { CONVERSATION_SCOPE } from './conversation-presentation.js';

// Per-channel conversation preferences: scope and actor filter. What a reader
// did to one message (expanded, collapsed, switched a diagram to source) is
// page state and is never stored; neither is the reading position.

function defaultPreferences() {
  return {
    scope: CONVERSATION_SCOPE.mine,
    actorFilter: [],
  };
}

function copyPreferences(value = {}) {
  return {
    scope: value.scope === CONVERSATION_SCOPE.all ? CONVERSATION_SCOPE.all : CONVERSATION_SCOPE.mine,
    actorFilter: [...new Set(value.actorFilter || [])].filter(Boolean).sort(),
  };
}

function sameStringArray(left = [], right = []) {
  const normalize = (value) => [...new Set(value || [])].filter(Boolean).map(String).sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// The key and schema are unchanged so existing preferences survive; reading
// entries and per-message choices an older build stored are ignored and
// dropped on the next write.
const VIEW_SESSION_SCHEMA = 3;

function storageKey(principalID) {
  return principalID ? `atoll.view-session.v3.${principalID}` : '';
}

function parseStored(storage, principalID) {
  const key = storageKey(principalID);
  if (!key || !storage?.getItem) return new Map();
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (value?.schema !== VIEW_SESSION_SCHEMA) return new Map();
    return new Map(Object.entries(value.preferences || {}).map(([channelID, item]) => [channelID, copyPreferences(item)]));
  } catch {
    return new Map();
  }
}

function readRaw(storage, principalID) {
  const key = storageKey(principalID);
  if (!key || !storage?.getItem) return null;
  try { return storage.getItem(key); } catch { return null; }
}

function writeStored(storage, principalID, preferences) {
  const key = storageKey(principalID);
  if (!key || !storage?.setItem) return null;
  const text = JSON.stringify({
    schema: VIEW_SESSION_SCHEMA,
    preferences: Object.fromEntries([...preferences].map(([channelID, item]) => [channelID, copyPreferences(item)])),
  });
  try {
    storage.setItem(key, text);
    return text;
  } catch {
    // Persistence is an accelerator; a disabled or full store changes nothing
    // on the page.
    return null;
  }
}

export function createViewSessionStore({ principalID = '', storage = globalThis.localStorage } = {}) {
  const preferences = parseStored(storage, principalID);
  // Another document may have written newer preferences. Re-read only when
  // storage no longer holds what this store last wrote.
  let lastWritten = readRaw(storage, principalID);
  const refresh = () => {
    if (readRaw(storage, principalID) === lastWritten) return;
    for (const [channelID, item] of parseStored(storage, principalID)) preferences.set(channelID, item);
  };
  const persist = () => {
    lastWritten = writeStored(storage, principalID, preferences);
  };

  return Object.freeze({
    read(channelID) {
      refresh();
      return copyPreferences(preferences.get(channelID) || defaultPreferences());
    },
    writeConversation(channelID, change = {}) {
      if (!channelID) return false;
      const previous = preferences.get(channelID) || defaultPreferences();
      // A mounted document can still publish its last snapshot while another
      // document has persisted a newer actor filter. Only let an incoming
      // actorFilter replace the latest value when it differs from that old
      // snapshot; an explicit removal still writes an empty list.
      refresh();
      const latest = preferences.get(channelID) || defaultPreferences();
      const hasActorFilterChange = Object.hasOwn(change, 'actorFilter');
      const actorFilterChangeIsStale = hasActorFilterChange
        && !sameStringArray(previous.actorFilter, latest.actorFilter)
        && sameStringArray(change.actorFilter, previous.actorFilter);
      const effectiveChange = actorFilterChangeIsStale
        ? { ...change, actorFilter: latest.actorFilter }
        : change;
      preferences.set(channelID, copyPreferences({ ...latest, ...effectiveChange }));
      persist();
      return true;
    },
    forget(channelID) {
      preferences.delete(channelID);
      persist();
    },
  });
}
