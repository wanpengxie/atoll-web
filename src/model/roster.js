import { isSystemNarration } from '../protocol/vocab.js';

const SELF_PREFIX = 'atoll.self.';

function measure(actual, name) {
  return actual?.measures?.find((item) => item.name === name);
}

function project(item) {
  const declared = item.declared || {};
  const bound = measure(item.actual, 'bound');
  const device = measure(item.actual, 'device_online');
  return {
    id: declared.id || item.key,
    kind: declared.kind,
    name: declared.name || declared.id || item.key,
    decl_id: declared.decl_id || '',
    description: declared.description || '',
    principal: declared.principal || '',
    bound: bound?.unknown ? null : Boolean(bound?.value),
    deviceOnline: device?.unknown ? null : Boolean(device?.value),
  };
}

export function createRoster({ obs, me = '', storage = globalThis.localStorage, debounceMs = 500 } = {}) {
  const cache = new Map();
  const pendingSubmissions = new Map();
  const timers = new Map();

  function savedSelf(channelId) {
    return storage?.getItem(`${SELF_PREFIX}${channelId}`) || '';
  }

  function saveSelf(channelId, actorId) {
    if (channelId && actorId) storage?.setItem(`${SELF_PREFIX}${channelId}`, actorId);
  }

  async function refresh(channelId) {
    const observation = await obs.channelActors(channelId);
    const rows = (observation.items || []).map(project);
    cache.set(channelId, rows);
    const principalMatch = me
      ? rows.find((row) => row.kind === 'human' && row.principal === me)
      : undefined;
    if (principalMatch) saveSelf(channelId, principalMatch.id);
    return rows;
  }

  return {
    refresh,
    get(channelId) {
      return cache.get(channelId) || [];
    },
    async ensure(channelId) {
      return cache.has(channelId) ? cache.get(channelId) : refresh(channelId);
    },
    self(channelId) {
      const principalMatch = me
        ? (cache.get(channelId) || []).find((row) => row.kind === 'human' && row.principal === me)
        : undefined;
      return principalMatch?.id || savedSelf(channelId);
    },
    candidates(channelId) {
      const selfId = this.self(channelId);
      return (cache.get(channelId) || []).filter((row) => !selfId || row.id !== selfId);
    },
    recordSubmission(channelId, messageId) {
      if (channelId && messageId) pendingSubmissions.set(messageId, channelId);
    },
    observeFeed(channelId, envelope) {
      const expectedChannel = envelope?.id ? pendingSubmissions.get(envelope.id) : '';
      if (expectedChannel === channelId && envelope?.sender?.id) {
        saveSelf(channelId, envelope.sender.id);
        pendingSubmissions.delete(envelope.id);
        return envelope.sender.id;
      }
      return '';
    },
    handleEnvelope(channelId, envelope, onRefresh) {
      if (!isSystemNarration(envelope?.type) || !envelope.type.startsWith('system.actor.')) return;
      if (timers.has(channelId)) clearTimeout(timers.get(channelId));
      timers.set(channelId, setTimeout(async () => {
        timers.delete(channelId);
        try {
          const rows = await refresh(channelId);
          onRefresh?.(rows);
        } catch (error) {
          onRefresh?.(null, error);
        }
      }, debounceMs));
    },
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
