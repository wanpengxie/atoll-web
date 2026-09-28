import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';
import { requestExpired } from './conversation-visibility.js';
import { globalNameOf, maskSecret } from './global-keys.js';
import { schemaFields } from './json-schema-form.js';

// ui.* 的纯函数一半：从账本里认出"发给这块屏、还开着"的请求，读 ui.form 的参数，
// 把结果或失败装成 resolve 帧。副作用（弹窗、写全局 key、发帧）由调用方注入。
//
// 没有"服务端推给浏览器"的通道，也不需要——账本本身就是下行：请求落进频道日志，
// 客户端本来就在订阅，看见发给自己的就干活，干完用 resolve 帧带 result 或 error
// 关掉它。

export const UI_FORM_CANCELLED = 'cancelled';

// 这个客户端此刻答哪些 ui.* 词。ui.state / ui.navigate / ui.open 的应答随 09-19
// 旧前端一起下线，尚未移植；它们照旧留在账本上等到截止时间。
export const ANSWERED_UI_WORDS = Object.freeze([TYPES.uiForm]);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function visitTurns(entries, visit) {
  for (const entry of entries || []) {
    if (entry?.kind === 'turn' && entry.turn?.request) visit(entry.turn);
    if (entry?.thread?.length) visitTurns(entry.thread, visit);
  }
}

// 返回 { open, closed }：open 是发给 selfId、还没有终态也没过期的 ui 请求；
// closed 是已经有终态（或已过期）的同类请求 id——调用方用它把已弹出的表单收掉。
// 只有看见终态才算关，看不见（频道还在同步）不算，免得同步间隙把人正在填的表单
// 收走。
export function clientUiRequests(state, selfId, { types = ANSWERED_UI_WORDS, now = Date.now() } = {}) {
  const wanted = new Set(types);
  const open = [];
  const closed = [];
  if (!selfId) return { open, closed };
  visitTurns(state?.timeline, (turn) => {
    const request = turn.request;
    if (request.kind && request.kind !== 'request') return;
    if (!wanted.has(request.type)) return;
    if (!Array.isArray(request.audience) || !request.audience.includes(selfId)) return;
    if (turn.terminal || requestExpired(request, now)) closed.push(request.id);
    else open.push(request);
  });
  return { open, closed };
}

// 一个人同时开着几块屏，所以每个 ui 词都点名是哪一块（session，来自
// ui.session.list 或他消息上盖的 origin）。
//   mine        —— 点的就是这块屏：受理。
//   other       —— 点的是别的屏：不掺和，也不回帧，免得一个请求变成一群拒绝。
//   unaddressed —— 没点名：拒绝，并在拒绝里说出这块屏的 id，调用方下次就会点名。
export function uiRequestAddressing(envelope, session) {
  const named = String(argsOf(envelope)?.session || '');
  if (!named) return 'unaddressed';
  return session?.id && named === session.id ? 'mine' : 'other';
}

export function uiResolveResult(envelope, result) {
  return { channel_id: envelope.channel_id, req_id: envelope.id, result };
}

export function uiResolveError(envelope, code, message) {
  return { channel_id: envelope.channel_id, req_id: envelope.id, error: { code, message: String(message || code) } };
}

export function uiSessionRequired(envelope, session) {
  return uiResolveError(envelope, 'session_required',
    `${envelope.type} must name a session; this client is ${session?.id || 'unnamed'}`
    + (session?.label ? ` (${session.label})` : '')
    + '. A person holds several screens; list them with ui.session.list.');
}

function invalid(message) {
  return Object.freeze({ ok: false, code: 'invalid_args', message });
}

// 读 ui.form 的参数并校验。secret 必须是 {字段: "global/<name>"}，字段必须是
// schema 里的字符串字段——否则这块屏不知道该把哪个值当密钥，宁可拒绝也不把
// 密钥画成明文框。
export function parseUiFormRequest(envelope) {
  const body = argsOf(envelope);
  const schema = body.schema;
  if (!plainObject(schema) || !plainObject(schema.properties)) return invalid('ui.form schema must be a JSON Schema object with properties');
  if (schema.type != null && schema.type !== 'object') return invalid('ui.form schema must describe an object');
  if (body.values != null && !plainObject(body.values)) return invalid('ui.form values must be an object');
  if (body.secret != null && !plainObject(body.secret)) {
    return invalid('ui.form secret must map field names to global/<name>; this client cannot tell which fields are secret');
  }
  const secret = {};
  for (const [field, resourceId] of Object.entries(body.secret || {})) {
    const property = schema.properties[field];
    if (!plainObject(property)) return invalid(`ui.form secret names ${field}, which is not a schema property`);
    if (property.type != null && property.type !== 'string') return invalid(`ui.form secret field ${field} must be a string`);
    if (!globalNameOf(resourceId)) return invalid(`ui.form secret ${field} must name global/<name> with name matching [a-z0-9_-]{1,64}`);
    secret[field] = String(resourceId);
  }
  const fields = schemaFields(schema, { secret: Object.keys(secret) });
  if (!fields.length) return invalid('ui.form schema has no fields');
  return Object.freeze({
    ok: true,
    form: Object.freeze({
      id: envelope.id,
      channelId: envelope.channel_id,
      type: envelope.type,
      envelope,
      requester: String(envelope.sender?.id || ''),
      session: String(body.session || ''),
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '填写表单',
      schema,
      values: plainObject(body.values) ? body.values : {},
      secret: Object.freeze(secret),
      fields,
    }),
  });
}

// 回复的形状：非密钥字段原样给值；密钥字段只给它写去了哪里和掩码。值恒不进回复。
export function uiFormResult(form, values) {
  const plain = {};
  const secret = {};
  for (const [name, value] of Object.entries(values || {})) {
    const resource = form?.secret?.[name];
    if (resource) secret[name] = { resource, masked: maskSecret(value) };
    else plain[name] = value;
  }
  return { values: plain, secret };
}

export function uiFormCancelled(form) {
  return uiResolveError(form.envelope, UI_FORM_CANCELLED, '用户取消了表单');
}

// 先把每个密钥写进它的全局 key，全部写成了才回复——回复里说"存在 global/x"，
// 就必须真的存进去了。任何一步失败都原样抛出，调用方留着表单让人重试或取消。
export async function answerUiForm({ form, values, writeSecret, resolve }) {
  for (const [name, resourceId] of Object.entries(form.secret || {})) {
    if (!Object.hasOwn(values, name)) continue;
    try {
      await writeSecret(resourceId, values[name]);
    } catch (error) {
      const code = String(error?.code || '');
      const detail = String(error?.detail || error?.message || error);
      const failure = new Error(`写入 ${resourceId} 失败：${code && !detail.includes(code) ? `${code}（${detail}）` : detail}`);
      failure.code = error?.code || 'secret_write_failed';
      failure.cause = error;
      throw failure;
    }
  }
  const result = uiFormResult(form, values);
  await resolve(uiResolveResult(form.envelope, result));
  return result;
}
