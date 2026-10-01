// starred-messages.js — messages a reader starred, kept on this device only.
//
// A star is the reader's own bookmark: it lives in this browser's
// localStorage, per principal, and never reaches the node. Each star keeps a
// short snapshot (sender, time, first line) so the list reads without the
// message being loaded.
//
// Jumping back is a request to whichever conversation list is showing the
// channel; it only finds messages that list already holds.

const STORAGE_PREFIX = 'atoll.stars.v1.';
const SNIPPET_CHARS = 120;
const EMPTY = Object.freeze([]);

let principal = '';
let stars = new Map(); // channelId -> frozen array, newest star first
const listeners = new Set();
const jumpListeners = new Set();

function storageKey() {
  return `${STORAGE_PREFIX}${principal}`;
}

function load() {
  stars = new Map();
  if (!principal) return;
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(storageKey()) || '{}');
    for (const [channelId, list] of Object.entries(parsed || {})) {
      if (Array.isArray(list)) stars.set(channelId, Object.freeze(list.filter((item) => item?.id)));
    }
  } catch { /* unreadable: start empty */ }
}

function save() {
  if (!principal) return;
  try {
    globalThis.localStorage?.setItem(storageKey(), JSON.stringify(Object.fromEntries(stars)));
  } catch { /* quota: keep in memory */ }
}

function emit() {
  for (const listener of listeners) listener();
}

// Called once the signed-in principal is known; switching accounts switches
// the star set.
export function setStarPrincipal(principalId) {
  const next = String(principalId || '');
  if (next === principal) return;
  principal = next;
  load();
  emit();
}

export function subscribeStars(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function starsFor(channelId) {
  return stars.get(String(channelId || '')) || EMPTY;
}

export function isStarred(channelId, messageId) {
  return starsFor(channelId).some((item) => item.id === messageId);
}

function snippet(text) {
  const line = String(text || '').split('\n').map((part) => part.trim()).find(Boolean) || '';
  return line.length > SNIPPET_CHARS ? `${line.slice(0, SNIPPET_CHARS)}…` : line;
}

// Adds or removes the star on one message.
export function toggleStar(channelId, { id, sender = '', text = '', ts = 0 } = {}) {
  const channel = String(channelId || '');
  if (!channel || !id || !principal) return false;
  const current = starsFor(channel);
  const next = current.some((item) => item.id === id)
    ? current.filter((item) => item.id !== id)
    : [Object.freeze({ id, sender, text: snippet(text), ts: Number(ts) || 0, starredAt: Date.now() }), ...current];
  if (next.length) stars.set(channel, Object.freeze(next));
  else stars.delete(channel);
  save();
  emit();
  return true;
}

// Ask the list showing `channelId` to bring `messageId` into view.
export function requestMessageJump(channelId, messageId) {
  let handled = false;
  for (const listener of jumpListeners) handled = listener(String(channelId || ''), String(messageId || '')) || handled;
  return handled;
}

export function subscribeMessageJumps(listener) {
  jumpListeners.add(listener);
  return () => jumpListeners.delete(listener);
}
