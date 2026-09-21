import { CONVERSATION_SCOPE } from './conversation-presentation.js';
import { READING_MODE } from './reading-session.js';

function defaultPreferences() {
  return {
    scope: CONVERSATION_SCOPE.mine,
    actorFilter: [],
    foldOverrides: [],
    foldDefaults: [],
    layoutChoices: [],
  };
}

function defaultReading() {
  return {
    revision: 0,
    mode: READING_MODE.following,
    bookmark: null,
    unseenTail: 0,
    unseenKeys: [],
    unseenRecords: [],
  };
}

function copyBookmark(value) {
  if (!value?.messageID) return null;
  const rowViewportOffset = value.rowViewportOffset == null || value.rowViewportOffset === ''
    ? null
    : Number(value.rowViewportOffset);
  const textViewportOffset = value.textViewportOffset == null || value.textViewportOffset === ''
    ? null
    : Number(value.textViewportOffset);
  return {
    messageID: String(value.messageID),
    blockID: String(value.blockID || ''),
    textOffset: Math.max(0, Number(value.textOffset) || 0),
    textBefore: String(value.textBefore || '').slice(-64),
    textAfter: String(value.textAfter || '').slice(0, 64),
    blockTextStart: String(value.blockTextStart || '').slice(0, 96),
    blockTextEnd: String(value.blockTextEnd || '').slice(-96),
    viewportOffset: Number(value.viewportOffset) || 0,
    textViewportOffset: Number.isFinite(textViewportOffset) ? textViewportOffset : null,
    rowViewportOffset: Number.isFinite(rowViewportOffset) ? rowViewportOffset : null,
    seq: Math.max(0, Number(value.seq) || 0),
    predecessorID: String(value.predecessorID || ''),
    successorID: String(value.successorID || ''),
  };
}

function copyReading(value = {}) {
  const mode = value.mode === READING_MODE.browsing ? READING_MODE.browsing : READING_MODE.following;
  const recordMap = new Map();
  for (const record of value.unseenRecords || []) {
    if (!Array.isArray(record) || !record[0]) continue;
    const key = String(record[0]);
    const seq = Number(record[1]);
    if (!Number.isSafeInteger(seq) || seq <= 0) continue;
    recordMap.set(key, Math.max(recordMap.get(key) || 0, seq));
  }
  const unseenRecords = [...recordMap];
  const unseenKeys = unseenRecords.map(([key]) => key);
  return {
    revision: Math.max(0, Number(value.revision) || 0),
    mode,
    bookmark: mode === READING_MODE.browsing ? copyBookmark(value.bookmark) : null,
    // Viewport-unseen state is derived from one authoritative fact: a stable
    // identity paired with the finite durable sequence that introduced it.
    unseenTail: unseenRecords.length,
    unseenKeys,
    unseenRecords,
  };
}

// A semantic reading position belongs to this browser document, not to the
// principal's durable profile. Persisting browsing + bookmark made a reload,
// a newly opened page, or a much later visit resume an old middle position.
// Keep the rest of the reading record durable (notably exact unseen evidence
// and its CAS revision), but make every storage boundary start at latest.
// The live store still retains the full copyReading value, so A→B→A inside
// one document restores the in-memory bookmark without another scroll owner.
function copyPersistedReading(value = {}) {
  return {
    ...copyReading(value),
    mode: READING_MODE.following,
    bookmark: null,
  };
}

function copyPreferences(value = {}) {
  return {
    scope: value.scope === CONVERSATION_SCOPE.all ? CONVERSATION_SCOPE.all : CONVERSATION_SCOPE.mine,
    actorFilter: [...new Set(value.actorFilter || [])].filter(Boolean).sort(),
    foldOverrides: [...(value.foldOverrides || [])]
      .filter((entry) => Array.isArray(entry) && entry.length === 2 && entry[0])
      .map(([id, expanded]) => [String(id), Boolean(expanded)]),
    foldDefaults: [...new Set(value.foldDefaults || [])].filter(Boolean).map(String),
    layoutChoices: (value.layoutChoices || []).filter((entry) => (
      Array.isArray(entry) && typeof entry[0] === 'string'
      && (typeof entry[1] === 'boolean' || typeof entry[1] === 'string'
        || (Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string')))
    )).map(([key, choice]) => [key, Array.isArray(choice) ? [...choice] : choice]),
  };
}

function sameStringArray(left = [], right = []) {
  const normalize = (value) => [...new Set(value || [])].filter(Boolean).map(String).sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function readingKey(channelID, viewKey) {
  return `${channelID}\u0000${viewKey}`;
}

const VIEW_SESSION_SCHEMA = 3;

// Reading's live-arrival producer and the durable view-session owner are
// deliberately separate modules. Keep the bridge at this model boundary so
// the list executor and conversation projection never become persistence
// owners. A document normally has one principal store; the Set also keeps
// tests and embedded surfaces from requiring a singleton store instance.
const viewSessionStores = new Set();

function storageKey(principalID) {
  return principalID ? `atoll.view-session.v3.${principalID}` : '';
}

function parseStored(storage, principalID) {
  const key = storageKey(principalID);
  if (!key || !storage?.getItem) return { preferences: new Map(), readings: new Map() };
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (value?.schema !== VIEW_SESSION_SCHEMA) return { preferences: new Map(), readings: new Map() };
    return {
      preferences: new Map(Object.entries(value.preferences || {}).map(([channelID, item]) => [channelID, copyPreferences(item)])),
      readings: new Map(Object.entries(value.readings || {}).map(([keyID, item]) => [keyID, copyPersistedReading(item)])),
    };
  } catch {
    return { preferences: new Map(), readings: new Map() };
  }
}

function writeStored(storage, principalID, preferences, readings) {
  const key = storageKey(principalID);
  if (!key || !storage?.setItem) return;
  try {
    storage.setItem(key, JSON.stringify({
      schema: VIEW_SESSION_SCHEMA,
      preferences: Object.fromEntries([...preferences].map(([channelID, item]) => [channelID, copyPreferences(item)])),
      readings: Object.fromEntries([...readings].map(([keyID, item]) => [keyID, copyPersistedReading(item)])),
    }));
  } catch {
    // Persistence is an accelerator. A disabled/full convenience store must
    // not break the active reading session.
  }
}

// Preferences and reading state deliberately use different key domains.
// Choices belong to a channel/message identity; reading belongs to a concrete
// filtered view activation. An old unmount has no authority over a newer
// activation of the same view.
export function createViewSessionStore({ principalID = '', storage = globalThis.localStorage } = {}) {
  const restored = parseStored(storage, principalID);
  const preferences = restored.preferences;
  const readings = restored.readings;
  const active = new Map();
  const unseenAcknowledgements = new Map();

  function mergeStoredReading(keyID, item) {
    const current = readings.get(keyID);
    if (current && item.revision <= current.revision) return;
    // A newer document may advance durable unseen evidence and the CAS
    // revision, but its persisted record intentionally carries no reading
    // position. Keep this document's in-memory position when merging it.
    readings.set(keyID, current ? copyReading({
      ...item,
      mode: current.mode,
      bookmark: current.bookmark,
    }) : item);
  }

  function refresh(key = '') {
    const latest = parseStored(storage, principalID);
    if (!key) {
      for (const [channelID, item] of latest.preferences) preferences.set(channelID, item);
      for (const [keyID, item] of latest.readings) mergeStoredReading(keyID, item);
      return;
    }
    const item = latest.readings.get(key);
    if (item) mergeStoredReading(key, item);
  }

  const persist = ({ preserveLatestPreferences = false } = {}) => {
    if (preserveLatestPreferences) {
      const latest = parseStored(storage, principalID);
      for (const [channelID, item] of latest.preferences) preferences.set(channelID, item);
    }
    writeStored(storage, principalID, preferences, readings);
  };

  const store = Object.freeze({
    read(channelID) {
      refresh();
      const prefs = copyPreferences(preferences.get(channelID) || defaultPreferences());
      const defaultView = copyReading(readings.get(readingKey(channelID, 'conversation')) || defaultReading());
      return { ...prefs, ...defaultView };
    },
    writeConversation(channelID, change = {}) {
      if (!channelID) return false;
      const previous = preferences.get(channelID) || defaultPreferences();
      // A mounted document can still publish its last preference snapshot while
      // another current document has already persisted a newer exact actor ID
      // (for example while a reload is crossing the commit boundary). Refresh
      // before writing, and only let an incoming actorFilter replace the latest
      // value when it differs from that old snapshot. This preserves a stale
      // exact-incarnation filter as an explicit removable choice; an explicit
      // removal from the current non-empty choice still writes an empty list.
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
    activate(channelID, viewKey, activationID) {
      if (!channelID || !viewKey || !activationID) return defaultReading();
      const key = readingKey(channelID, viewKey);
      refresh(key);
      let current = readings.get(key) || defaultReading();
      // A persisted durable unseen record opens the active document in
      // browsing mode even though copyPersistedReading deliberately stores
      // the next reload at latest. This is in-memory activation state only;
      // the durable record remains the source of the jump obligation.
      if (current.unseenRecords.length && current.mode !== READING_MODE.browsing) {
        current = copyReading({ ...current, mode: READING_MODE.browsing });
        readings.set(key, current);
      }
      active.set(key, activationID);
      unseenAcknowledgements.set(key, false);
      return copyReading(current);
    },
    readView(channelID, viewKey) {
      const key = readingKey(channelID, viewKey);
      refresh(key);
      return copyReading(readings.get(key) || defaultReading());
    },
    save(channelID, viewKey, activationID, expectedRevision, change = {}) {
      const key = readingKey(channelID, viewKey);
      if (!channelID || !viewKey || active.get(key) !== activationID) return false;
      refresh(key);
      const current = readings.get(key) || defaultReading();
      if (Number(expectedRevision) !== current.revision) return false;
      const next = copyReading({ ...current, ...change, revision: current.revision + 1 });
      readings.set(key, next);
      persist({ preserveLatestPreferences: true });
      return true;
    },
    recordLiveArrivals(channelID, events = []) {
      if (!channelID || !Array.isArray(events) || !events.length) return false;
      const incoming = new Map();
      for (const event of events) {
        const key = String(event?.key || '');
        const seq = Number(event?.seq);
        if (!key || !Number.isSafeInteger(seq) || seq <= 0) continue;
        incoming.set(key, Math.max(incoming.get(key) || 0, seq));
      }
      if (!incoming.size) return false;
      let changed = false;
      const prefix = `${channelID}\u0000`;
      for (const [key, activationID] of active) {
        if (!key.startsWith(prefix) || !activationID) continue;
        const current = readings.get(key) || defaultReading();
        if (current.mode !== READING_MODE.browsing) continue;
        const nextRecords = [...current.unseenRecords, ...incoming].map((record) => (
          Array.isArray(record) ? record : [record[0], record[1]]
        ));
        const next = copyReading({
          ...current,
          revision: current.revision + 1,
          unseenRecords: nextRecords,
        });
        const same = next.unseenRecords.length === current.unseenRecords.length
          && next.unseenRecords.every(([recordKey, seq], index) => (
            recordKey === current.unseenRecords[index]?.[0]
            && seq === current.unseenRecords[index]?.[1]
          ));
        if (same) continue;
        readings.set(key, next);
        unseenAcknowledgements.set(key, true);
        changed = true;
      }
      if (changed) persist({ preserveLatestPreferences: true });
      return changed;
    },
    readActiveUnseen(channelID) {
      const prefix = `${channelID}\u0000`;
      const records = new Map();
      for (const [key, activationID] of active) {
        if (!key.startsWith(prefix) || !activationID) continue;
        for (const [recordKey, seq] of (readings.get(key) || defaultReading()).unseenRecords) {
          records.set(recordKey, Math.max(records.get(recordKey) || 0, seq));
        }
      }
      return [...records];
    },
    prepareActiveUnseen(channelID) {
      const prefix = `${channelID}\u0000`;
      for (const [key, activationID] of active) {
        if (!key.startsWith(prefix) || !activationID) continue;
        if ((readings.get(key) || defaultReading()).unseenRecords.length) unseenAcknowledgements.set(key, true);
      }
    },
    acknowledgeActiveUnseen(channelID) {
      const prefix = `${channelID}\u0000`;
      const before = new Map();
      let changed = false;
      for (const [key, activationID] of active) {
        if (!key.startsWith(prefix) || !activationID) continue;
        if (!unseenAcknowledgements.get(key)) {
          unseenAcknowledgements.set(key, true);
          continue;
        }
        const current = readings.get(key) || defaultReading();
        for (const [recordKey, seq] of current.unseenRecords) {
          before.set(recordKey, Math.max(before.get(recordKey) || 0, seq));
        }
        if (!current.unseenRecords.length) continue;
        readings.set(key, copyReading({
          ...current,
          revision: current.revision + 1,
          unseenRecords: [],
        }));
        changed = true;
      }
      if (changed) persist({ preserveLatestPreferences: true });
      return Object.freeze({ records: Object.freeze([...before]), remaining: 0 });
    },
    deactivate(channelID, viewKey, activationID) {
      const key = readingKey(channelID, viewKey);
      if (active.get(key) !== activationID) return false;
      active.delete(key);
      unseenAcknowledgements.delete(key);
      return true;
    },
    forget(channelID) {
      preferences.delete(channelID);
      for (const key of [...readings.keys()]) if (key.startsWith(`${channelID}\u0000`)) readings.delete(key);
      for (const key of [...active.keys()]) {
        if (!key.startsWith(`${channelID}\u0000`)) continue;
        active.delete(key);
        unseenAcknowledgements.delete(key);
      }
      persist();
    },
  });
  viewSessionStores.add(store);
  return store;
}

export function recordActiveReadingArrivals(channelID, events = []) {
  let changed = false;
  for (const store of viewSessionStores) changed = store.recordLiveArrivals(channelID, events) || changed;
  return changed;
}

export function readActiveReadingUnseen(channelID) {
  const records = new Map();
  for (const store of viewSessionStores) {
    for (const [key, seq] of store.readActiveUnseen(channelID)) records.set(key, Math.max(records.get(key) || 0, seq));
  }
  return [...records];
}

export function prepareActiveReadingUnseen(channelID) {
  for (const store of viewSessionStores) store.prepareActiveUnseen(channelID);
}

export function acknowledgeActiveReadingUnseen(channelID) {
  const records = new Map();
  let remaining = 0;
  for (const store of viewSessionStores) {
    const result = store.acknowledgeActiveUnseen(channelID);
    for (const [key, seq] of result.records) records.set(key, Math.max(records.get(key) || 0, seq));
    remaining = Math.max(remaining, Number(result.remaining || 0));
  }
  return Object.freeze({ records: Object.freeze([...records]), remaining });
}
