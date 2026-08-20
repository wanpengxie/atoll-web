import { registryCommand } from './channel-governance.js';
import { isSystemDeclaration } from './management-actors.js';
import { TYPES } from '../protocol/vocab.js';

export const SPACE_TYPES = Object.freeze({
  actorRegister: TYPES.actorTemplate.create,
  actorEdit: TYPES.actorTemplate.set,
  actorRevoke: TYPES.actorTemplate.remove,
  actorList: TYPES.actorTemplate.list,
  actorGet: TYPES.actorTemplate.get,
  channelRegister: TYPES.channelTemplate.create,
  channelEdit: TYPES.channelTemplate.set,
  channelRevoke: TYPES.channelTemplate.remove,
  channelList: TYPES.channelTemplate.list,
  channelGet: TYPES.channelTemplate.get,
  overlaySet: TYPES.actorOverlay.set,
  overlayClear: TYPES.actorOverlay.clear,
  profileSet: TYPES.channel.set,
  deviceCreate: TYPES.device.create,
  deviceRetire: TYPES.device.remove,
  deviceAttach: TYPES.device.attach,
  deviceDetach: TYPES.device.detach,
  deviceList: TYPES.device.list,
});

export function parseJSONObject(text, label = 'JSON') {
  const source = String(text ?? '').trim();
  if (!source) return {};
  let value;
  try { value = JSON.parse(source); } catch (error) { throw new TypeError(`${label} 不是有效 JSON：${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 必须是 JSON 对象`);
  return value;
}

export function isProtectedDeclaration(id) {
  return isSystemDeclaration(id);
}

// 声明的 name 不是给人看的标题，是坐进频道的那个成员被叫的名字 —— 它会成为成员
// actor id 的中间段（`agent:reviewer:<ts>`），别人靠它指名道姓。所以它守的是名字的
// 规矩：一个小写 DNS 标签。想写的那句话放 description。
//
// 这里先拦一道，是为了当场说清楚，而不是把"My Agent"送出去换一句远端拒绝。
// 规矩本身由 registrar 执法，这里只是把它照抄到人眼前。
export const NAME_RULE = '名称是成员的名字：1-63 个字符，只能用小写 a-z、0-9 和 -，首尾必须是字母或数字。想写的说明放到"说明"里。';

export function isValidName(value) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(String(value ?? ''));
}

function requireName(value) {
  const name = String(value ?? '').trim();
  if (!isValidName(name)) throw new TypeError(NAME_RULE);
  return name;
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
    id, name: requireName(values.name), class: String(values.class || '').trim(),
    visibility: values.visibility || 'private',
    ...(String(values.description || '').trim() ? { description: String(values.description).trim() } : {}),
    ...(values.config ? { config: values.config } : {}),
  };
  if (action === 'edit') {
    const edited = pickDefined(values, ['name', 'description', 'class', 'config', 'visibility']);
    if (edited.name !== undefined) edited.name = requireName(edited.name);
    payload = { id, ...edited };
  }
  if (['revoke', 'get'].includes(action)) payload = { id };
  return command({ type, payload, roster, label: `${type} → ${id || 'all'}` });
}

export function channelTemplateCommand(action, values, roster) {
  const type = SPACE_TYPES[`channel${action[0].toUpperCase()}${action.slice(1)}`];
  if (!type) throw new TypeError('未知频道模板操作');
  const id = String(values?.id || '').trim();
  if (!['list'].includes(action) && !id) throw new TypeError('模板 ID 不能为空');
  let payload = {};
  if (action === 'register') payload = { id, name: String(values.name || '').trim(), visibility: values.visibility || 'private', body: values.body || { declarations: [] }, ...(values.description ? { description: String(values.description).trim() } : {}) };
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

// system.channel.set 的字段闭集是 {channel_id, description, serving}；endpoints
// 只能在建频道时随 recipe.profile 一起给，不是这个词的参数。
export function profileCommand({ channelId, description = '', serving = 0, roster }) {
  if (!channelId) throw new TypeError('频道不能为空');
  const value = Number(serving);
  if (!Number.isSafeInteger(value) || value < 0 || value > 1) throw new TypeError('serving 必须是 0 或 1');
  return command({ channelId, type: SPACE_TYPES.profileSet, payload: { channel_id: channelId, description: String(description), serving: value }, roster, label: `${SPACE_TYPES.profileSet} → ${channelId}` });
}

export function deviceCommand(action, values, roster) {
  const type = SPACE_TYPES[`device${action[0].toUpperCase()}${action.slice(1)}`];
  if (!type) throw new TypeError('未知设备操作');
  let payload;
  if (action === 'create') payload = { name: String(values.name || '').trim() };
  if (action === 'retire') payload = { device_id: String(values.deviceId || '').trim() };
  if (action === 'attach' || action === 'detach') payload = { channel_id: String(values.channelId || '').trim(), device_id: String(values.deviceId || '').trim() };
  if (action === 'list') payload = {};
  if (!payload) throw new TypeError('未知设备操作');
  if (Object.values(payload).some((value) => !value)) throw new TypeError('设备操作字段不能为空');
  return command({ type, payload, roster, label: `${type} → ${payload.device_id || payload.name || ''}` });
}

function pickDefined(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}
