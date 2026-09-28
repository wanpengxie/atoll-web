import { describe, expect, it, vi } from 'vitest';
import {
  globalKeyNames,
  globalNameOf,
  globalResourceId,
  listGlobalKeys,
  maskSecret,
  writeGlobalValue,
} from '../src/model/global-keys.js';
import { initialFormValues, schemaFields, validateFormValues } from '../src/model/json-schema-form.js';
import {
  insertGlobalReference,
  memberConfigPatch,
  memberLayerFromMeasure,
  memberLayerIssue,
  missingGlobalReferences,
  parseMemberConfigText,
} from '../src/model/member-config.js';
import {
  answerUiForm,
  clientUiRequests,
  parseUiFormRequest,
  uiFormCancelled,
  uiFormResult,
  uiRequestAddressing,
  uiSessionRequired,
} from '../src/model/ui-form.js';
import { CLIENT_UI_WORDS, TYPES } from '../src/protocol/vocab.js';

const FORM_SCHEMA = {
  type: 'object',
  required: ['api_key', 'model'],
  properties: {
    api_key: { type: 'string', title: 'API Key', description: 'DeepSeek key' },
    model: { type: 'string', title: '模型', enum: ['deepseek-chat', 'deepseek-reasoner'], default: 'deepseek-chat' },
    retries: { type: 'integer', minimum: 0, maximum: 5 },
    verbose: { type: 'boolean', default: false },
    base_url: { type: 'string', examples: ['https://api.deepseek.com'], pattern: '^https://' },
    extra: { type: 'object' },
  },
};

function formRequest(body = {}, extra = {}) {
  return {
    id: 'form-1', channel_id: 'c0', kind: 'request', type: TYPES.uiForm,
    sender: { kind: 'agent', id: 'steward' }, audience: ['root'],
    payload: { body: { session: 's-1', title: '填写 DeepSeek key', schema: FORM_SCHEMA, secret: { api_key: 'global/deepseek_prod' }, ...body } },
    ...extra,
  };
}

describe('vocab', () => {
  it('registers ui.form among the words a client answers and member.set among member words', () => {
    expect(TYPES.uiForm).toBe('ui.form');
    expect(CLIENT_UI_WORDS).toEqual(['ui.state', 'ui.navigate', 'ui.open', 'ui.form']);
    expect(CLIENT_UI_WORDS).not.toContain(TYPES.uiSessionList);
    expect(TYPES.member.set).toBe('system.member.set');
  });
});

describe('JSON Schema form model', () => {
  it('reads an object schema into typed fields, with secret fields as password inputs', () => {
    const fields = schemaFields(FORM_SCHEMA, { secret: ['api_key'] });
    expect(fields.map((field) => [field.name, field.control, field.required])).toEqual([
      ['api_key', 'password', true],
      ['model', 'select', true],
      ['retries', 'number', false],
      ['verbose', 'checkbox', false],
      ['base_url', 'text', false],
      ['extra', 'json', false],
    ]);
    expect(fields[0]).toMatchObject({ label: 'API Key', description: 'DeepSeek key', secret: true });
    expect(schemaFields({ type: 'object' })).toEqual([]);
    expect(schemaFields(null)).toEqual([]);
  });

  it('prefills from values first, then defaults', () => {
    const fields = schemaFields(FORM_SCHEMA);
    const values = initialFormValues(fields, { retries: 3, extra: { a: 1 } });
    expect(values).toMatchObject({ api_key: '', model: '"deepseek-chat"', retries: '3', verbose: false, base_url: '' });
    expect(JSON.parse(values.extra)).toEqual({ a: 1 });
  });

  it('validates required, enum, integer range, pattern and JSON and restores types', () => {
    const fields = schemaFields(FORM_SCHEMA, { secret: ['api_key'] });
    const empty = validateFormValues(fields, initialFormValues(fields));
    expect(empty.valid).toBe(false);
    expect(empty.errors).toEqual({ api_key: '必填' });

    const bad = validateFormValues(fields, { api_key: 'sk', model: '"nope"', retries: '9', base_url: 'http://x', extra: '[1]' });
    expect(bad.errors).toEqual({ model: '请选择一个可选值', retries: '不能大于 5', base_url: '格式不符合要求', extra: '必须是 JSON 对象' });

    const good = validateFormValues(fields, { api_key: ' sk-secret ', model: '"deepseek-reasoner"', retries: '2', verbose: true, base_url: '', extra: '{"a":1}' });
    expect(good.valid).toBe(true);
    // 密钥原样收，不裁剪；空着的可选字段不出现；布尔恒有值。
    expect(good.values).toEqual({ api_key: ' sk-secret ', model: 'deepseek-reasoner', retries: 2, verbose: true, extra: { a: 1 } });
    expect(validateFormValues(fields, { api_key: 'k', model: '"deepseek-chat"', retries: '1.5' }).errors).toEqual({ retries: '请输入整数' });
  });
});

describe('member layers and config patch', () => {
  it('reads OBS measures and member.get layers into one shape, unknown staying absent', () => {
    expect(memberLayerFromMeasure({ name: 'business', value: 'stuck', unknown: false, reason: 'missing global resource global/k', since: 55 }))
      .toEqual({ state: 'stuck', reason: 'missing global resource global/k', since: 55 });
    expect(memberLayerFromMeasure({ name: 'business', value: null, unknown: true, reason: 'no_testimony' })).toBeUndefined();
  });

  it('names the layer and reason of a member that cannot serve, standard first', () => {
    expect(memberLayerIssue({ standard: { state: 'ready' }, business: { state: 'ready' } })).toBeNull();
    expect(memberLayerIssue({})).toBeNull();
    expect(memberLayerIssue({ standard: { state: 'ready' }, business: { state: 'stuck', reason: 'missing global resource global/deepseek_prod' } }))
      .toMatchObject({ layer: 'business', label: '卡住', text: '业务层卡住：missing global resource global/deepseek_prod' });
    expect(memberLayerIssue({ standard: { state: 'unreachable', reason: 'stream closed' }, business: { state: 'initializing' } }))
      .toMatchObject({ layer: 'standard', label: '不可达', text: '标准层不可达：stream closed' });
    expect(memberLayerIssue({ business: { state: 'retrying' } }).text).toBe('业务层重试中');
  });

  it('computes a top-level patch: changed keys replace, removed keys reset to null, untouched keys stay out', () => {
    const before = { model: 'a', api_key: '$global.k', nested: { x: 1, y: [1, 2] }, redacted: '已隐藏' };
    const after = { model: 'b', nested: { y: [1, 2], x: 1 }, redacted: '已隐藏', temperature: 0.2 };
    expect(memberConfigPatch(before, after)).toEqual({ model: 'b', api_key: null, temperature: 0.2 });
    expect(memberConfigPatch(before, { ...before, nested: { x: 2, y: [1, 2] } })).toEqual({ nested: { x: 2, y: [1, 2] } });
    expect(memberConfigPatch(before, before)).toEqual({});
    expect(memberConfigPatch(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it('parses config text and inserts a $global reference at the cursor', () => {
    expect(parseMemberConfigText('')).toEqual({});
    expect(() => parseMemberConfigText('[1]')).toThrow('配置必须是 JSON 对象');
    expect(() => parseMemberConfigText('{')).toThrow(/配置 JSON 格式无效/);
    const text = '{\n  "api_key": \n}';
    const cursor = text.indexOf(': ') + 2;
    const inserted = insertGlobalReference(text, cursor, cursor, 'deepseek_prod');
    expect(inserted.text).toBe('{\n  "api_key": "$global.deepseek_prod"\n}');
    expect(inserted.cursor).toBe(cursor + '"$global.deepseek_prod"'.length);
    expect(JSON.parse(inserted.text)).toEqual({ api_key: '$global.deepseek_prod' });
    expect(() => insertGlobalReference(text, 0, 0, 'Bad Name')).toThrow();
    expect(missingGlobalReferences({ a: '$global.one', b: ['$global.two'], c: '$global.' }, ['one'])).toEqual(['global/two']);
  });
});

describe('global keys', () => {
  it('validates names and masks values to the last four characters', () => {
    expect(globalResourceId('deepseek_prod')).toBe('global/deepseek_prod');
    expect(() => globalResourceId('Deep Seek')).toThrow();
    expect(() => globalResourceId('x'.repeat(65))).toThrow();
    expect(globalNameOf('global/a-b_1')).toBe('a-b_1');
    expect(globalNameOf('kv:demo')).toBe('');
    expect(maskSecret('sk-abcdef1234')).toBe('****1234');
    expect(maskSecret('1234')).toBe('****');
    expect(maskSecret('')).toBe('****');
    expect(globalKeyNames([{ id: 'global/b' }, { id: 'global/a' }, { id: 'kv:x' }, { id: 'global/BAD' }])).toEqual(['a', 'b']);
  });

  it('lists every page under global/', async () => {
    const resource = vi.fn()
      .mockResolvedValueOnce({ items: [{ id: 'global/b' }], next: '1' })
      .mockResolvedValueOnce({ items: [{ id: 'global/a' }], next: null });
    await expect(listGlobalKeys(resource)).resolves.toEqual(['a', 'b']);
    expect(resource.mock.calls.map(([payload]) => payload)).toEqual([
      { op: 'list', query: { prefix: 'global/', limit: 500 } },
      { op: 'list', query: { prefix: 'global/', limit: 500, cursor: '1' } },
    ]);
  });

  it('writes a value as a JSON string: create when absent, write when present, write after a create race', async () => {
    const absent = vi.fn(async (payload) => (payload.op === 'stat' ? { exists: false } : { status: 'ok' }));
    await expect(writeGlobalValue(absent, 'k', 'sk-1')).resolves.toMatchObject({ resourceId: 'global/k', created: true });
    expect(absent.mock.calls.map(([payload]) => payload)).toEqual([
      { op: 'stat', resource_id: 'global/k' },
      { op: 'create', resource_id: 'global/k', args: 'sk-1' },
    ]);
    const present = vi.fn(async (payload) => (payload.op === 'stat' ? { exists: true } : { status: 'ok' }));
    await writeGlobalValue(present, 'k', 'sk-2');
    expect(present.mock.calls.at(-1)[0]).toEqual({ op: 'write', resource_id: 'global/k', args: 'sk-2' });
    const raced = vi.fn(async (payload) => {
      if (payload.op === 'stat') return { exists: false };
      if (payload.op === 'create') throw Object.assign(new Error('resource already exists'), { code: 'conflict_exists' });
      return { status: 'ok' };
    });
    await expect(writeGlobalValue(raced, 'k', 'sk-3')).resolves.toMatchObject({ created: false });
    expect(raced.mock.calls.at(-1)[0]).toEqual({ op: 'write', resource_id: 'global/k', args: 'sk-3' });
  });
});

describe('ui.form', () => {
  it('finds open ui.form requests addressed to me, including ones nested under a turn', () => {
    const open = formRequest();
    const nested = formRequest({}, { id: 'form-2', parent_id: 'ask-1' });
    const closed = formRequest({}, { id: 'form-3' });
    const other = formRequest({}, { id: 'form-4', audience: ['someone-else'] });
    const state = {
      timeline: [
        { kind: 'turn', turn: { requestId: 'form-1', request: open } },
        { kind: 'turn', turn: { requestId: 'ask-1', request: { id: 'ask-1', kind: 'request', type: 'agent.ask', audience: ['steward'] } }, thread: [
          { kind: 'turn', turn: { requestId: 'form-2', request: nested } },
        ] },
        { kind: 'turn', turn: { requestId: 'form-3', request: closed, terminal: { id: 'form-3-done' } } },
        { kind: 'turn', turn: { requestId: 'form-4', request: other } },
      ],
    };
    const scan = clientUiRequests(state, 'root');
    expect(scan.open.map((request) => request.id)).toEqual(['form-1', 'form-2']);
    expect(scan.closed).toEqual(['form-3']);
    expect(clientUiRequests(state, '')).toEqual({ open: [], closed: [] });
  });

  it('acts only when this screen is named, and refuses an unaddressed request by naming itself', () => {
    const session = { id: 's-1', label: 'Chrome' };
    expect(uiRequestAddressing(formRequest(), session)).toBe('mine');
    expect(uiRequestAddressing(formRequest({ session: 's-2' }), session)).toBe('other');
    expect(uiRequestAddressing(formRequest({ session: '' }), session)).toBe('unaddressed');
    const refusal = uiSessionRequired(formRequest({ session: '' }), session);
    expect(refusal).toMatchObject({ channel_id: 'c0', req_id: 'form-1', error: { code: 'session_required' } });
    expect(refusal.error.message).toContain('s-1 (Chrome)');
  });

  it('parses a valid request and refuses secrets it cannot place', () => {
    const parsed = parseUiFormRequest(formRequest({ values: { model: 'deepseek-reasoner' } }));
    expect(parsed.ok).toBe(true);
    expect(parsed.form).toMatchObject({ id: 'form-1', channelId: 'c0', title: '填写 DeepSeek key', secret: { api_key: 'global/deepseek_prod' }, values: { model: 'deepseek-reasoner' } });
    expect(parsed.form.fields.find((field) => field.name === 'api_key').control).toBe('password');
    // 本地缓存脱敏后的 secret（'已隐藏'）读不出哪个字段是密钥：拒绝，恒不画成明文框。
    expect(parseUiFormRequest(formRequest({ secret: '已隐藏' }))).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(parseUiFormRequest(formRequest({ secret: { api_key: 'kv:demo' } }))).toMatchObject({ ok: false });
    expect(parseUiFormRequest(formRequest({ secret: { missing: 'global/x' } }))).toMatchObject({ ok: false });
    expect(parseUiFormRequest(formRequest({ secret: { retries: 'global/x' } }))).toMatchObject({ ok: false });
    expect(parseUiFormRequest(formRequest({ schema: { type: 'array' } }))).toMatchObject({ ok: false });
  });

  it('replies with plain values and only a mask for each secret', () => {
    const { form } = parseUiFormRequest(formRequest());
    const result = uiFormResult(form, { api_key: 'sk-very-secret-9876', model: 'deepseek-chat', verbose: false });
    expect(result).toEqual({
      values: { model: 'deepseek-chat', verbose: false },
      secret: { api_key: { resource: 'global/deepseek_prod', masked: '****9876' } },
    });
    expect(JSON.stringify(result)).not.toContain('sk-very-secret');
    expect(uiFormCancelled(form)).toEqual({ channel_id: 'c0', req_id: 'form-1', error: { code: 'cancelled', message: '用户取消了表单' } });
  });

  it('writes every secret before resolving, and resolves nothing when a write fails', async () => {
    const { form } = parseUiFormRequest(formRequest());
    const order = [];
    const writeSecret = vi.fn(async (resourceId) => { order.push(`write:${resourceId}`); });
    const resolve = vi.fn(async (frame) => { order.push('resolve'); return frame; });
    const result = await answerUiForm({ form, values: { api_key: 'sk-secret-1234', model: 'deepseek-chat' }, writeSecret, resolve });
    expect(order).toEqual(['write:global/deepseek_prod', 'resolve']);
    expect(writeSecret).toHaveBeenCalledWith('global/deepseek_prod', 'sk-secret-1234');
    const frame = resolve.mock.calls[0][0];
    expect(frame).toEqual({ channel_id: 'c0', req_id: 'form-1', result });
    expect(JSON.stringify(frame)).not.toContain('sk-secret');

    const failingResolve = vi.fn();
    await expect(answerUiForm({
      form,
      values: { api_key: 'sk-secret-1234', model: 'deepseek-chat' },
      writeSecret: async () => { throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); },
      resolve: failingResolve,
    })).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('global/deepseek_prod') });
    expect(failingResolve).not.toHaveBeenCalled();
  });
});
