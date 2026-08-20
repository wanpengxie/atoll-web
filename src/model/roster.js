import { TYPES } from '../protocol/vocab.js';
import { actorDisplayName } from './actor-display.js';

const SELF_PREFIX = 'atoll.self.v3.';

function measure(actual, name) {
  return actual?.measures?.find((item) => item.name === name);
}

function project(item) {
  const declared = item.declared || {};
  const id = declared.id || item.key;
  const bound = measure(item.actual, 'bound');
  const device = measure(item.actual, 'device_online');
  return {
    id,
    kind: declared.kind,
    name: actorDisplayName({ id, name: declared.name }),
    decl_id: declared.decl_id || '',
    description: declared.description || '',
    principal: declared.principal || '',
    bound: bound?.unknown ? null : Boolean(bound?.value),
    deviceOnline: device?.unknown ? null : Boolean(device?.value),
  };
}

export function createRoster({ obs, me = '', storage = globalThis.localStorage, debounceMs = 500, contractVersion = 2 } = {}) {
  const cache = new Map();
  const pendingSubmissions = new Map();
  const timers = new Map();

  function savedSelf(channelId) {
    try {
      const value = JSON.parse(storage?.getItem(`${SELF_PREFIX}${me}.${channelId}`) || 'null');
      return value?.principal === me && value?.contractVersion === contractVersion ? value.actorId || '' : '';
    } catch {
      return '';
    }
  }

  function saveSelf(channelId, actorId) {
    if (channelId && actorId && me) storage?.setItem(`${SELF_PREFIX}${me}.${channelId}`, JSON.stringify({
      principal: me,
      channelId,
      actorId,
      contractVersion,
      observedAt: Date.now(),
    }));
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
      if (expectedChannel === channelId && envelope?.kind === 'request' && envelope?.sender?.kind === 'human' && envelope?.sender?.id) {
        saveSelf(channelId, envelope.sender.id);
        pendingSubmissions.delete(envelope.id);
        return envelope.sender.id;
      }
      return '';
    },
    clearSelf(channelId) {
      if (channelId && me) storage?.removeItem?.(`${SELF_PREFIX}${me}.${channelId}`);
    },
    handleEnvelope(channelId, envelope, onRefresh) {
      if (![TYPES.narration.memberCreated, TYPES.narration.memberDeleted].includes(envelope?.type)) return;
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
