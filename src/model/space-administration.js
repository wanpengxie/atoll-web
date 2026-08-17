import { registryCommand } from './channel-governance.js';

export const SPACE_TYPES = Object.freeze({
  actorRegister: 'actor.template.register',
  actorEdit: 'actor.template.edit',
  actorRevoke: 'actor.template.revoke',
  actorList: 'actor.template.list',
  channelRegister: 'channel.template.register',
  channelEdit: 'channel.template.edit',
  channelRevoke: 'channel.template.revoke',
  channelList: 'channel.template.list',
  channelGet: 'channel.template.get',
  overlaySet: 'actor.overlay.set',
  overlayClear: 'actor.overlay.clear',
  profileSet: 'channel.profile.set',
  deviceMint: 'device.mint',
  deviceClaim: 'device.claim',
  deviceRetire: 'device.retire',
  deviceAttach: 'device.attach',
  deviceDetach: 'device.detach',
});

const PROTECTED_DECLARATIONS = new Set([
  'atoll-internal:coreactor',
  'atoll-internal:registrar-seat',
  'atoll-internal:svcactor',
]);

export function parseJSONObject(text, label = 'JSON') {
  const source = String(text ?? '').trim();
  if (!source) return {};
  let value;
  try { value = JSON.parse(source); } catch (error) { throw new TypeError(`${label} 不是有效 JSON：${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 必须是 JSON 对象`);
  return value;
}

export function isProtectedDeclaration(id) {
  return PROTECTED_DECLARATIONS.has(id) || String(id || '').startsWith('peer:');
}

export function safeDaemonRows(observation) {
  return (observation?.items || []).map((item) => {
    const declared = item.declared || {};
    const measures = Object.fromEntries((item.actual?.measures || []).map((row) => [row.name, row.unknown ? undefined : row.value]));
    return {
      id: declared.id || item.key,
      name: declared.name || declared.id || item.key,
      status: declared.status || 'present',
      online: measures.online ?? measures.device_online,
      description: declared.description || '',
    };
  }).filter((row) => row.id);
}

export function terminalValue(state, requestId) {
  const terminal = state?.turns?.get(requestId)?.terminal?.payload;
  if (!terminal) return { phase: 'waiting', value: null, error: '' };
  if (terminal.status === 'failed') return { phase: 'failed', value: terminal.value ?? null, error: terminal.error_code || terminal.reason || terminal.detail || '操作失败' };
  if (terminal.status === 'completed') return { phase: 'completed', value: terminal.value ?? null, error: '' };
  return { phase: terminal.status || 'waiting', value: terminal.value ?? null, error: '' };
}

function command({ channelId = 'c0', type, payload, roster, label = type }) {
  const result = registryCommand({ channelId, type, payload, roster });
  return { ...result, text: label };
}

export function actorTemplateCommand(action, values, roster) {
  const type = SPACE_TYPES[`actor${action[0].toUpperCase()}${action.slice(1)}`];
  if (!type) throw new TypeError('未知 Actor 模板操作');
  const id = String(values?.id || '').trim();
  if (action !== 'list' && !id) throw new TypeError('声明 ID 不能为空');
  if (['edit', 'revoke'].includes(action) && isProtectedDeclaration(id)) throw new TypeError('标准系统声明受保护');
  let payload = {};
  if (action === 'register') payload = {
    id, name: String(values.name || '').trim(), class: String(values.class || '').trim(),
    visibility: values.visibility || 'private',
    ...(String(values.description || '').trim() ? { description: String(values.description).trim() } : {}),
    ...(values.config ? { config: values.config } : {}),
  };
  if (action === 'edit') payload = { id, ...pickDefined(values, ['name', 'description', 'class', 'config', 'visibility']) };
  if (action === 'revoke') payload = { id };
  return command({ type, payload, roster, label: `${type} → ${id || 'all'}` });
}

export function channelTemplateCommand(action, values, roster) {
  const type = SPACE_TYPES[`channel${action[0].toUpperCase()}${action.slice(1)}`];
  if (!type) throw new TypeError('未知频道模板操作');
  const id = String(values?.id || '').trim();
  if (!['list'].includes(action) && !id) throw new TypeError('模板 ID 不能为空');
  let payload = {};
  if (action === 'register') payload = { id, name: String(values.name || '').trim(), visibility: values.visibility || 'private', body: values.body || {}, ...(values.description ? { description: String(values.description).trim() } : {}) };
  if (action === 'edit') payload = { id, ...pickDefined(values, ['name', 'description', 'visibility', 'body']) };
  if (action === 'revoke' || action === 'get') payload = { id };
  return command({ type, payload, roster, label: `${type} → ${id || 'all'}` });
}

export function overlayCommand({ channelId, declId, config, clear = false, roster }) {
  if (!channelId || !declId) throw new TypeError('频道和声明不能为空');
  const type = clear ? SPACE_TYPES.overlayClear : SPACE_TYPES.overlaySet;
  const payload = { decl_id: declId, channel_id: channelId, ...(!clear ? { config: config || {} } : {}) };
  return command({ channelId, type, payload, roster, label: `${type} → ${declId}` });
}

export function profileCommand({ channelId, description = '', serving = 0, endpoints = {}, roster }) {
  if (!channelId) throw new TypeError('频道不能为空');
  const value = Number(serving);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('serving 必须是非负整数');
  return command({ channelId, type: SPACE_TYPES.profileSet, payload: { channel_id: channelId, description: String(description), serving: value, endpoints }, roster, label: `${SPACE_TYPES.profileSet} → ${channelId}` });
}

export function deviceCommand(action, values, roster) {
  const type = SPACE_TYPES[`device${action[0].toUpperCase()}${action.slice(1)}`];
  if (!type) throw new TypeError('未知设备操作');
  let payload;
  if (action === 'mint') payload = { name: String(values.name || '').trim() };
  if (action === 'claim') payload = { device_id: String(values.deviceId || '').trim(), name: String(values.name || '').trim() };
  if (action === 'retire') payload = { device_id: String(values.deviceId || '').trim() };
  if (action === 'attach' || action === 'detach') payload = { channel_id: String(values.channelId || '').trim(), device_id: String(values.deviceId || '').trim() };
  if (Object.values(payload).some((value) => !value)) throw new TypeError('设备操作字段不能为空');
  return command({ type, payload, roster, label: `${type} → ${payload.device_id || payload.name}` });
}

function pickDefined(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}
