import { isSystemDeclaration, SYSTEM_ACTOR } from './management-actors.js';
import { TYPES } from '../protocol/vocab.js';

export const GOVERNANCE_TYPES = Object.freeze({
  create: TYPES.channel.create,
  get: TYPES.channel.get,
  list: TYPES.channel.list,
  retire: TYPES.channel.remove,
  profileSet: TYPES.channel.set,
  introduce: TYPES.member.create,
  admit: TYPES.member.admit,
  remove: TYPES.member.remove,
  restart: TYPES.member.restart,
});

export function validateChannelName(value) {
  const name = String(value || '').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    return '名称须为 1–63 位小写字母、数字或连字符，且不能以连字符开头或结尾';
  }
  return '';
}

// system.channel.create 的 payload 是 {name, recipe, initial_actor_ids}。Actor
// ID 是来源频道局部身份，后端 sysactor 会把它们解析为可信创世 seats。
// body（declarations + profile）。UI 只提供“空配方 + 可选简介”的形态；从模板
// 建频道时由调用方先取回模板 body 再作为 recipe 传进来。
export function createChannelCommand({ parentId, name, purpose = '', recipe = null, initialActorIds, roster = [] }) {
  const error = validateChannelName(name);
  if (error) throw new TypeError(error);
  if (!Array.isArray(initialActorIds)) throw new TypeError('必须明确提供初始 Actor；空频道请传 []');
  const initialActors = initialActorIds.map((id) => String(id || '').trim());
  if (initialActors.some((id) => !id)) throw new TypeError('初始 Actor ID 不能为空');
  if (new Set(initialActors).size !== initialActors.length) throw new TypeError('初始 Actor ID 不能重复');
  const body = recipe && typeof recipe === 'object' && !Array.isArray(recipe)
    ? { declarations: Array.isArray(recipe.declarations) ? recipe.declarations : [], ...(recipe.profile ? { profile: recipe.profile } : {}) }
    : { declarations: [] };
  if (purpose.trim()) body.profile = { ...(body.profile || {}), description: purpose.trim() };
  return {
    ...target(parentId, roster),
    msgType: GOVERNANCE_TYPES.create,
    text: `创建子频道 ${name}`,
    payload: { name: String(name).trim(), recipe: body, initial_actor_ids: initialActors },
  };
}

function target(channelId, roster = []) {
  const system = roster.find((row) => row.id === SYSTEM_ACTOR.id) || SYSTEM_ACTOR;
  return { channelId, audience: [system.id], targetLabel: system.name || system.id };
}

// 空间面和频道面共用一个收件人，registryCommand / actorCommand 的区别只剩语义。
export function registryCommand({ channelId, type, payload, roster = [] }) {
  return { ...target(channelId, roster), msgType: type, payload, text: `${type} → ${payload?.channel_id || payload?.id || channelId}` };
}

export function actorCommand({ channelId, type, payload, roster = [] }) {
  return { ...target(channelId, roster), msgType: type, payload, text: `${type} → ${payload?.member || payload?.principal || payload?.decl_id || ''}` };
}

export function isProtectedActor(row) {
  return row?.kind === 'system'
    || row?.id === SYSTEM_ACTOR.id
    || isSystemDeclaration(row?.decl_id);
}

export function usablePrincipals(items = [], roster = []) {
  const present = items.map((item) => item.declared || item).filter((row) => row.id && row.status === 'present' && row.kind === 'human');
  const current = new Set(roster.map((row) => row.principal).filter(Boolean));
  return present.filter((row) => !current.has(row.id)).sort((a, b) => (a.display_name || a.email || a.id).localeCompare(b.display_name || b.email || b.id));
}

export function usableDeclarations(items = [], kind = '') {
  return items.map((item) => item.declared || item).filter((row) => (
    row.id && row.status === 'present' && !isSystemDeclaration(row.id)
    && (!kind || declarationKind(row) === kind)
  )).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export function declarationKind(row) {
  const explicit = row.kind || row.actor_kind;
  if (explicit === 'agent' || explicit === 'tool') return explicit;
  const value = String(row.default_class || '').toLowerCase();
  if (value.includes('agent') || value.includes('codex') || value.includes('claude')) return 'agent';
  return 'tool';
}

export function creationConvergence({ turn, expectedQualifiedName, channels = [], membership = null }) {
  const terminal = turn?.terminal?.payload;
  const failed = terminal?.status === 'failed';
  const createdId = terminal?.value?.channel_id || '';
  const channel = channels.find((row) => row.qualified_name === expectedQualifiedName || row.id === createdId) || null;
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
  // system.member.* 的回复是平铺的：create/admit/restart 回 {member}，delete 回 {removed:[…]}。
  const targetId = terminal?.member || actorId;
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
