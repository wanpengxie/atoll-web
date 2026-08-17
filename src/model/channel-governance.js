import { CORE_ACTOR_DECL_ID, resolveManagementActors } from './management-actors.js';

const SYSTEM_DECLS = new Set([
  CORE_ACTOR_DECL_ID,
  'atoll-internal:svcactor',
  'atoll-internal:registrar-seat',
]);

export const GOVERNANCE_TYPES = Object.freeze({
  create: 'channel.create',
  get: 'channel.get',
  describe: 'channel.describe',
  retire: 'channel.retire',
  introduce: 'channel.introduce_actor',
  remove: 'channel.remove_actor',
  restart: 'channel.restart_actor',
});

export function validateChannelName(value) {
  const name = String(value || '').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    return '名称须为 1–63 位小写字母、数字或连字符，且不能以连字符开头或结尾';
  }
  return '';
}

export function createChannelCommand({ parentId, name, purpose = '', template = '', roster = [] }) {
  const error = validateChannelName(name);
  if (error) throw new TypeError(error);
  const actors = resolveManagementActors(roster);
  const target = parentId === 'c0' ? actors.registrar : actors.coreactor;
  if (!target) throw new TypeError(parentId === 'c0' ? '当前频道没有 registrar seat' : '当前频道没有 coreactor');
  return {
    channelId: parentId,
    msgType: GOVERNANCE_TYPES.create,
    audience: [target.id],
    targetLabel: target.name || target.id,
    text: `创建子频道 ${name}`,
    payload: {
      name: String(name).trim(),
      ...(String(template).trim() ? { template: String(template).trim() } : {}),
      ...(purpose.trim() ? { overrides: { profile: { description: purpose.trim() } } } : {}),
    },
  };
}

export function registryCommand({ channelId, type, payload, roster = [] }) {
  const actors = resolveManagementActors(roster);
  const target = channelId === 'c0' ? actors.registrar : actors.coreactor;
  if (!target) throw new TypeError(channelId === 'c0' ? '当前频道没有 registrar seat' : '当前频道没有 coreactor');
  return { channelId, msgType: type, audience: [target.id], targetLabel: target.name || target.id, payload, text: `${type} → ${payload?.channel_id || channelId}` };
}

export function actorCommand({ channelId, type, payload, roster = [] }) {
  const system = resolveManagementActors(roster).system;
  if (!system) throw new TypeError('当前频道没有 system actor');
  return { channelId, msgType: type, audience: [system.id], targetLabel: 'system', payload, text: `${type} → ${payload?.instance_id || payload?.principal || payload?.decl_id || ''}` };
}

export function isProtectedActor(row) {
  return row?.kind === 'system'
    || row?.id === 'system'
    || SYSTEM_DECLS.has(row?.decl_id)
    || String(row?.decl_id || '').startsWith('peer:');
}

export function usablePrincipals(items = [], roster = []) {
  const present = items.map((item) => item.declared || item).filter((row) => row.id && row.status === 'present');
  const current = new Set(roster.map((row) => row.principal).filter(Boolean));
  return present.filter((row) => !current.has(row.id)).sort((a, b) => (a.display_name || a.email || a.id).localeCompare(b.display_name || b.email || b.id));
}

export function usableDeclarations(items = [], kind = '') {
  return items.map((item) => item.declared || item).filter((row) => (
    row.id && row.status === 'present' && !SYSTEM_DECLS.has(row.id) && !String(row.id).startsWith('peer:')
    && (!kind || declarationKind(row) === kind)
  )).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export function declarationKind(row) {
  const explicit = row.kind || row.actor_kind;
  if (explicit === 'agent' || explicit === 'tool') return explicit;
  const value = String(row.default_class || '').toLowerCase();
  if (value.includes('agent') || value.includes('codex')) return 'agent';
  return 'tool';
}

export function creationConvergence({ turn, expectedQualifiedName, channels = [], membership = null }) {
  const terminal = turn?.terminal?.payload;
  const failed = terminal?.status === 'failed';
  const channel = channels.find((row) => row.qualified_name === expectedQualifiedName || row.id === terminal?.value?.id) || null;
  return {
    accepted: Boolean(turn),
    ledger: terminal?.status === 'completed',
    failed,
    error: failed ? terminal.error_code || terminal.reason || terminal.detail || 'unknown' : '',
    observable: Boolean(channel),
    membership: Boolean(channel && membership?.(channel.id)),
    serving: channel?.open === true,
    channel,
    ready: Boolean(terminal?.status === 'completed' && channel && membership?.(channel.id) && channel.open === true),
  };
}

export function actorConvergence({ turn, type, actorId = '', roster = [] }) {
  const terminal = turn?.terminal?.payload;
  const targetId = terminal?.value?.instance_id || actorId;
  const actor = roster.find((row) => row.id === targetId) || null;
  const ledger = terminal?.status === 'completed';
  const failed = terminal?.status === 'failed';
  const rosterConverged = ledger && (
    type === GOVERNANCE_TYPES.remove ? !actor
      : type === GOVERNANCE_TYPES.restart ? Boolean(actor && actor.bound !== false)
        : Boolean(actor)
  );
  return { accepted: Boolean(turn), ledger, failed, error: failed ? terminal.error_code || terminal.reason || terminal.detail || 'unknown' : '', actor, targetId, rosterConverged, ready: ledger && rosterConverged };
}
