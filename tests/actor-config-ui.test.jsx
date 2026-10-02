// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schemaFields } from '../src/model/json-schema-form.js';
import { parseUiFormRequest } from '../src/model/ui-form.js';
import { GlobalKeysPanel } from '../src/ui/features/governance/GlobalKeysPanel.jsx';
import { MemberConfigSection } from '../src/ui/features/roster/MemberConfig.jsx';
import { RosterFeature } from '../src/ui/features/roster/RosterFeature.jsx';
import { JsonSchemaForm } from '../src/ui/primitives/JsonSchemaForm.jsx';
import { UiFormModal } from '../src/ui/UiFormModal.jsx';

afterEach(cleanup);

const SCHEMA = {
  type: 'object',
  required: ['api_key', 'model'],
  properties: {
    api_key: { type: 'string', title: 'API Key', description: 'DeepSeek key' },
    model: { type: 'string', title: '模型', enum: ['deepseek-chat', 'deepseek-reasoner'], default: 'deepseek-chat' },
    verbose: { type: 'boolean', title: '详细日志' },
    retries: { type: 'integer', title: '重试次数' },
  },
};

function uiForm() {
  return parseUiFormRequest({
    id: 'form-1', channel_id: 'c0', kind: 'request', type: 'ui.form',
    sender: { kind: 'agent', id: 'steward' }, audience: ['root'],
    payload: { body: { session: 's-1', title: '填写 DeepSeek key', schema: SCHEMA, secret: { api_key: 'global/deepseek_prod' } } },
  }).form;
}

describe('JsonSchemaForm', () => {
  it('renders one control per field: password for secrets, select for enums, checkbox and number', () => {
    const onChange = vi.fn();
    function Host() {
      const [values, setValues] = useState({ api_key: '', model: '"deepseek-chat"', verbose: false, retries: '' });
      return <JsonSchemaForm fields={schemaFields(SCHEMA, { secret: ['api_key'] })} values={values} errors={{ retries: '请输入整数' }} onChange={(name, value) => { onChange(name, value); setValues((current) => ({ ...current, [name]: value })); }} />;
    }
    render(<Host />);
    const key = screen.getByLabelText('API Key');
    expect(key.getAttribute('type')).toBe('password');
    expect(key.getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText('DeepSeek key')).toBeTruthy();
    expect(screen.getByLabelText('模型').tagName).toBe('SELECT');
    expect(screen.getByLabelText('详细日志').getAttribute('type')).toBe('checkbox');
    expect(screen.getByLabelText('重试次数').getAttribute('type')).toBe('number');
    expect(screen.getByLabelText('重试次数').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('请输入整数');
    fireEvent.change(key, { target: { value: 'sk-1' } });
    // a secret never lands in the DOM: no value attribute, nothing in the markup
    expect(key.getAttribute('value')).toBe(null);
    expect(document.body.innerHTML.includes('sk-1')).toBe(false);
    fireEvent.click(screen.getByLabelText('详细日志'));
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: '"deepseek-reasoner"' } });
    expect(onChange.mock.calls).toEqual([['api_key', 'sk-1'], ['verbose', true], ['model', '"deepseek-reasoner"']]);
  });
});

describe('UiFormModal', () => {
  it('validates, submits typed values, and keeps the form with its error when submission fails', async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error('写入 global/deepseek_prod 失败：forbidden'))
      .mockResolvedValueOnce(undefined);
    const form = uiForm();
    render(<UiFormModal form={form} requesterName="steward" channelName="c0" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: '填写 DeepSeek key' });
    expect(within(dialog).getByText(/只写入全局 key/).textContent).toContain('global/deepseek_prod');
    fireEvent.click(within(dialog).getByRole('button', { name: '提交' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(dialog).getByText('必填')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('API Key'), { target: { value: 'sk-secret-1234' } });
    fireEvent.change(within(dialog).getByLabelText('重试次数'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '提交' }));
    await waitFor(() => expect(within(dialog).getByText(/forbidden/)).toBeTruthy());
    expect(onSubmit).toHaveBeenLastCalledWith(form, { api_key: 'sk-secret-1234', model: 'deepseek-chat', verbose: false, retries: 2 });
    // 失败后表单还在，值也还在，可以直接重试。
    expect(within(dialog).getByLabelText('API Key').value).toBe('sk-secret-1234');
    fireEvent.click(within(dialog).getByRole('button', { name: '提交' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  // 打开时读一次要写的 key：已有值就给人看原值，并说提交会覆盖它。
  it('shows the value a secret field would overwrite, read once when it opens', async () => {
    const readSecret = vi.fn(async () => ({ exists: true, value: 'sk-old-9999' }));
    render(<UiFormModal form={uiForm()} onSubmit={vi.fn()} onCancel={vi.fn()} readSecret={readSecret} />);
    const dialog = screen.getByRole('dialog', { name: '填写 DeepSeek key' });
    await waitFor(() => expect(within(dialog).getByText(/已有值/).textContent).toContain('sk-old-9999'));
    expect(within(dialog).getByText(/提交会覆盖它/)).toBeTruthy();
    expect(readSecret).toHaveBeenCalledTimes(1);
    expect(readSecret).toHaveBeenCalledWith('global/deepseek_prod');
    cleanup();
    render(<UiFormModal form={uiForm()} onSubmit={vi.fn()} onCancel={vi.fn()} readSecret={async () => ({ exists: false, value: '' })} />);
    await waitFor(() => expect(screen.getByText(/现在还没有值/)).toBeTruthy());
  });

  it('opens with focus on the dialog itself, not on a button a stray key would press', () => {
    render(<UiFormModal form={uiForm()} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  });

  it('cancels through onCancel, also on Escape', async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(<UiFormModal form={uiForm()} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    cleanup();
    const onEscape = vi.fn().mockResolvedValue(undefined);
    render(<UiFormModal form={uiForm()} onSubmit={vi.fn()} onCancel={onEscape} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onEscape).toHaveBeenCalledTimes(1));
  });
});

describe('GlobalKeysPanel', () => {
  function port(names = ['openai_prod']) {
    const state = { names: [...names] };
    return {
      state,
      value: {
        available: true,
        channelId: 'c0',
        commands: {
          list: vi.fn(async () => [...state.names]),
          read: vi.fn(async (name) => ({ exists: true, value: `value-of-${name}` })),
          create: vi.fn(async (name) => { state.names.push(name); state.names.sort(); }),
          write: vi.fn(async () => {}),
          remove: vi.fn(async (name) => { state.names = state.names.filter((row) => row !== name); }),
        },
      },
    };
  }

  it('lists names with their values, adds with a password field, and reads once on open', async () => {
    const { value } = port();
    const { container, rerender } = render(<GlobalKeysPanel port={value} />);
    await screen.findByText('openai_prod');
    expect(screen.getByText('$global.openai_prod')).toBeTruthy();
    // 开发期不打码：原值直接显示。
    await screen.findByText('value-of-openai_prod');
    // 全局 key 全空间一份：换频道不重读。
    rerender(<GlobalKeysPanel port={{ ...value, channelId: 'c0.project' }} />);
    expect(value.commands.list).toHaveBeenCalledTimes(1);
    const add = screen.getByRole('form', { name: '添加全局 key' });
    const secret = within(add).getByLabelText('值');
    expect(secret.getAttribute('type')).toBe('password');
    fireEvent.change(within(add).getByLabelText('名称'), { target: { value: 'Bad Name' } });
    fireEvent.change(secret, { target: { value: 'sk-deep-secret-5678' } });
    fireEvent.click(within(add).getByRole('button', { name: '添加' }));
    expect(within(add).getByText('格式不符合要求')).toBeTruthy();
    expect(value.commands.create).not.toHaveBeenCalled();

    fireEvent.change(within(add).getByLabelText('名称'), { target: { value: 'deepseek_prod' } });
    fireEvent.click(within(add).getByRole('button', { name: '添加' }));
    await screen.findByText('deepseek_prod');
    expect(value.commands.create).toHaveBeenCalledWith('deepseek_prod', 'sk-deep-secret-5678');
    expect(screen.getByText('已添加 global/deepseek_prod。')).toBeTruthy();
    // 输入框清空了；列出来的是读回来的值。
    expect([...container.querySelectorAll('input')].some((input) => input.value.includes('sk-deep-secret'))).toBe(false);
    await screen.findByText('value-of-deepseek_prod');
  });

  it('overwrites a value and deletes a key only after confirmation', async () => {
    const { value } = port(['a_key', 'b_key']);
    render(<GlobalKeysPanel port={value} />);
    await screen.findByText('a_key');
    fireEvent.click(screen.getByRole('button', { name: '修改 a_key 的值' }));
    const change = screen.getByRole('form', { name: '修改 a_key 的值' });
    fireEvent.change(within(change).getByLabelText('新值'), { target: { value: 'sk-new-0001' } });
    fireEvent.click(within(change).getByRole('button', { name: '保存新值' }));
    await waitFor(() => expect(value.commands.write).toHaveBeenCalledWith('a_key', 'sk-new-0001'));
    await screen.findByText('已覆盖 global/a_key 的值。');

    fireEvent.click(screen.getByRole('button', { name: '删除 b_key' }));
    expect(value.commands.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }));
    await waitFor(() => expect(value.commands.remove).toHaveBeenCalledWith('b_key'));
    await waitFor(() => expect(screen.queryByText('b_key')).toBeNull());
  });
});

describe('the roster and member config', () => {
  // 对外只有一个状态：在名册上的行只说在线/绑定，不说它内部哪一层。
  it('shows a roster row by its presence only, never a layer', () => {
    render(<RosterFeature port={{ rows: [
      { id: 'steward', kind: 'agent', name: 'steward', bound: true, deviceOnline: null },
    ] }} />);
    const rows = screen.getAllByRole('button').filter((node) => node.classList.contains('roster-row'));
    expect(rows[0].textContent).toContain('已绑定');
    expect(rows[0].textContent).not.toContain('业务层');
    expect(rows[0].textContent).not.toContain('标准层');
  });

  // system.member.get 对一个描述里的成员的回答（actor-config 场景的 writer）。
  function writerDetail(overrides = {}) {
    return {
      actor_id: 'agent:writer:9', member: true, present: true, name: 'writer',
      class: 'claude', desired_host: 'local-device',
      body: { actor: 'd-writer@1' },
      params: { temperature: 0.3 },
      requires: ['web'],
      own_config: { values: { model: 'claude-opus' }, revision: 2 },
      effective: { model: 'claude-opus', service: { api_key: '$required:写作服务的 API key', region: 'cn' }, temperature: 0.3 },
      sources: { model: 'config', 'service.api_key': 'actor', 'service.region': 'actor', temperature: 'member' },
      build: { object: { kind: 'member', channel: 'c0.project', name: 'writer' }, description: { channel_revision: 3, actor: 'd-writer@1' }, config: { revision: 2 }, attempt: 4, result: 'failed', state: 'stopped', reason: 'service.api_key is a placeholder still unfilled' },
      ...overrides,
    };
  }
  const WRITER = { id: 'agent:writer:9', kind: 'agent' };

  it('reads on demand and shows the entry, own config, sources, missing placeholders and the last build', async () => {
    const readMember = vi.fn().mockResolvedValue(writerDetail({ missing: [{ key: 'service.api_key', hint: '写作服务的 API key' }], note: 'a newer version of its actor description exists: d-writer@2' }));
    render(<MemberConfigSection actor={WRITER} port={{ commands: { readMember, setMember: vi.fn(), setMemberConfig: vi.fn() } }} />);
    // 手动挡：不点就不发 member.get。
    expect(readMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '读取配置' }));
    await screen.findByText('Actor 描述 d-writer@1');
    expect(readMember).toHaveBeenCalledWith(WRITER);
    expect(screen.getByText('a newer version of its actor description exists: d-writer@2')).toBeTruthy();
    // 两块：描述条目（params、requires）和这一台的配置（values、版本）。
    expect(screen.getByLabelText('当前 params').textContent).toContain('"temperature": 0.3');
    expect(screen.getByText('requires：web')).toBeTruthy();
    expect(screen.getByLabelText('当前配置').textContent).toContain('claude-opus');
    expect(screen.getByText('第 2 版')).toBeTruthy();
    // 合成值的每个键来自哪一层。
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1).map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['model', 'claude-opus', '这一台的配置'],
      ['service.api_key', '$required:写作服务的 API key', 'Actor 描述'],
      ['service.region', 'cn', 'Actor 描述'],
      ['temperature', '0.3', '成员条目'],
    ]);
    // 还没填的占位和最近一次构建。
    const missing = screen.getByRole('group', { name: '还没填的占位' });
    expect(missing.textContent).toContain('还缺 1 个值');
    expect(missing.textContent).toContain('写作服务的 API key');
    const build = screen.getByLabelText('最近一次构建');
    expect(build.textContent).toContain('失败 · 已停止：改描述或配置、或重启后才会再构建');
    expect(build.textContent).toContain('第 4 次尝试 · 描述第 3 版 · d-writer@1 · 配置第 2 版');
    expect(build.textContent).toContain('service.api_key is a placeholder still unfilled');
  });

  it('edits the member entry and sends body and a params merge patch through setMember', async () => {
    const readMember = vi.fn().mockResolvedValue(writerDetail());
    const setMember = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('bad'), { code: 'invalid_args', detail: 'member writer: actor description d-writer@2 is retired' }))
      .mockResolvedValueOnce({ written: true, description_revision: 4 });
    // 挑 Actor 描述：按描述 id；带版本号钉死那一版，不带就是最新版。
    const actorDescriptions = [{ id: 'd-writer', name: 'writer', version: 2, ref: 'd-writer@2' }];
    render(<MemberConfigSection actor={WRITER} port={{ actorDescriptions, commands: { readMember, setMember, setMemberConfig: vi.fn() } }} />);
    fireEvent.click(screen.getByRole('button', { name: '读取配置' }));
    await screen.findByText('Actor 描述 d-writer@1');
    fireEvent.click(screen.getByRole('button', { name: '编辑条目' }));
    const editor = screen.getByRole('form', { name: '编辑成员条目' });
    // 从 actor 描述造的成员：编辑器打开时就在 Actor 描述那一档。
    const ref = within(editor).getByLabelText('成员 Actor 描述');
    expect(ref.value).toBe('d-writer@1');
    expect([...ref.querySelectorAll('option')].map((option) => option.value)).toEqual(['', 'd-writer', 'd-writer@2', 'd-writer@1']);
    fireEvent.change(ref, { target: { value: 'd-writer@2' } });
    fireEvent.change(within(editor).getByLabelText('成员 params JSON'), { target: { value: '{"effort":"high"}' } });
    fireEvent.change(within(editor).getByLabelText('成员 requires'), { target: { value: '' } });
    // 将提交的变更：body 整个换、params 合并补丁（删掉的键给 null）、requires 清空给 null。
    expect(JSON.parse(within(editor).getByText(/"body"/).textContent)).toEqual({
      body: { actor: 'd-writer@2' },
      params: { effort: 'high', temperature: null },
      requires: null,
    });
    // 没有预览：只有取消和保存。
    expect(within(editor).queryByRole('button', { name: '检查变更' })).toBeNull();
    expect(within(editor).getAllByRole('button').map((button) => button.textContent)).toEqual(['取消', '保存条目']);

    fireEvent.click(within(editor).getByRole('button', { name: '保存条目' }));
    await within(editor).findByText('invalid_args：member writer: actor description d-writer@2 is retired');

    // 改成不带版本号：跟最新版。
    fireEvent.change(within(editor).getByLabelText('成员 Actor 描述'), { target: { value: 'd-writer' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存条目' }));
    await screen.findByText(/成员条目已写进频道描述（第 4 版）/);
    expect(setMember).toHaveBeenLastCalledWith({ actor: WRITER, body: { actor: 'd-writer' }, params: { effort: 'high', temperature: null }, requires: null });
    // 保存后重新读一次。
    expect(readMember).toHaveBeenCalledTimes(2);
  });

  it('switches an entry to a class and leaves unchanged params and requires out of the call', async () => {
    const readMember = vi.fn().mockResolvedValue(writerDetail());
    const setMember = vi.fn().mockResolvedValue({ written: true, description_revision: 4 });
    render(<MemberConfigSection actor={WRITER} port={{ commands: { readMember, setMember, setMemberConfig: vi.fn() } }} />);
    fireEvent.click(screen.getByRole('button', { name: '读取配置' }));
    await screen.findByText('Actor 描述 d-writer@1');
    fireEvent.click(screen.getByRole('button', { name: '编辑条目' }));
    const editor = screen.getByRole('form', { name: '编辑成员条目' });
    // 没改任何东西：保存不可点。
    expect(within(editor).getByRole('button', { name: '保存条目' }).disabled).toBe(true);
    fireEvent.click(within(editor).getByRole('radio', { name: 'Class' }));
    fireEvent.change(within(editor).getByLabelText('成员 Class'), { target: { value: 'codex' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存条目' }));
    await waitFor(() => expect(setMember).toHaveBeenCalledWith({ actor: WRITER, body: { class: 'codex' }, params: {} }));
  });

  it('edits this member\'s own config and sends desired_host and a values merge patch through setMemberConfig', async () => {
    const readMember = vi.fn().mockResolvedValue(writerDetail({ own_config: { values: { model: 'claude-opus', service: { region: 'cn' } }, revision: 2 } }));
    const setMemberConfig = vi.fn()
      .mockResolvedValueOnce({ member: 'writer', revision: 3 });
    const list = vi.fn(async () => ['deepseek_prod', 'openai_prod']);
    const devices = [{ id: 'local-device', name: 'local-device' }, { id: 'laptop', name: 'Laptop' }];
    render(<MemberConfigSection actor={WRITER} port={{ devices, commands: { readMember, setMember: vi.fn(), setMemberConfig }, globalKeys: { available: true, commands: { list } } }} />);
    fireEvent.click(screen.getByRole('button', { name: '读取配置' }));
    await screen.findByText('Actor 描述 d-writer@1');
    // 全局 key 名单只在打开编辑器时读。
    expect(list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '编辑配置' }));
    const editor = screen.getByRole('form', { name: '编辑成员配置' });
    await waitFor(() => expect(within(editor).getByRole('option', { name: 'openai_prod' })).toBeTruthy());
    const host = within(editor).getByLabelText('成员运行设备');
    // local-device 是默认，不单列；其余是本频道能用的设备。
    expect([...host.querySelectorAll('option')].map((option) => [option.value, option.textContent])).toEqual([['', 'local-device（默认）'], ['laptop', 'Laptop']]);
    fireEvent.change(host, { target: { value: 'laptop' } });
    const textarea = within(editor).getByLabelText('成员配置 JSON');
    fireEvent.change(textarea, { target: { value: '{"service":{"region":"us"},"api_key":}' } });
    // 插入引用：在光标处放一个 "$global.<name>"。
    textarea.setSelectionRange(textarea.value.length - 1, textarea.value.length - 1);
    fireEvent.change(within(editor).getByLabelText('选择全局 key'), { target: { value: 'deepseek_prod' } });
    fireEvent.click(within(editor).getByRole('button', { name: '插入引用' }));
    expect(textarea.value).toBe('{"service":{"region":"us"},"api_key":"$global.deepseek_prod"}');

    expect(within(editor).queryByRole('button', { name: '检查变更' })).toBeNull();
    const patch = { service: { region: 'us' }, api_key: '$global.deepseek_prod', model: null };
    fireEvent.click(within(editor).getByRole('button', { name: '保存配置' }));
    await screen.findByText(/这一台的配置已保存（第 3 版）/);
    expect(setMemberConfig).toHaveBeenCalledTimes(1);
    expect(setMemberConfig).toHaveBeenLastCalledWith({ actor: WRITER, desiredHost: 'laptop', values: patch });
  });

  it('fills a missing placeholder with a values patch built from its dotted key', async () => {
    const readMember = vi.fn()
      .mockResolvedValueOnce(writerDetail({ member: false, present: false, actor_id: '', missing: [{ key: 'service.api_key', hint: '写作服务的 API key' }] }))
      .mockResolvedValueOnce(writerDetail({ build: { object: { kind: 'member', channel: 'c0.project', name: 'writer' }, description: { channel_revision: 3 }, attempt: 1, result: 'ok', state: 'ready' } }));
    const setMemberConfig = vi.fn().mockResolvedValue({ member: 'writer', revision: 3 });
    // 构建失败、不在名册上的成员：从频道设置的构建摘要打开，没有 kind。
    const actor = { id: 'writer', name: 'writer', kind: '', body: '' };
    render(<MemberConfigSection actor={actor} port={{ commands: { readMember, setMember: vi.fn(), setMemberConfig } }} />);
    fireEvent.click(screen.getByRole('button', { name: '读取配置' }));
    const missing = await screen.findByRole('group', { name: '还没填的占位' });
    const fill = within(missing).getByRole('button', { name: '填入' });
    expect(fill.disabled).toBe(true);
    fireEvent.change(within(missing).getByLabelText('填写 service.api_key'), { target: { value: '$global.openai_prod' } });
    fireEvent.click(fill);
    await screen.findByText(/已填 service.api_key（配置第 3 版）/);
    expect(setMemberConfig).toHaveBeenCalledWith({ actor, values: { service: { api_key: '$global.openai_prod' } } });
    // 填完重新读：占位没了，构建成功。
    await waitFor(() => expect(screen.queryByRole('group', { name: '还没填的占位' })).toBeNull());
    expect(screen.getByLabelText('最近一次构建').textContent).toContain('成功 · 已就绪');
  });

  it('offers no editing for humans and runtime-generated members', async () => {
    const readMember = vi.fn().mockResolvedValue({ actor_id: 'root', member: true, present: true });
    render(<MemberConfigSection actor={{ id: 'root', kind: 'human' }} port={{ commands: { readMember, setMember: vi.fn(), setMemberConfig: vi.fn() } }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '读取配置' })); });
    expect(screen.queryByRole('button', { name: '编辑条目' })).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑配置' })).toBeNull();
    expect(screen.getByText('只有 Agent 和工具成员有可编辑的描述和配置。')).toBeTruthy();
    cleanup();

    const generated = vi.fn().mockResolvedValue({ actor_id: 'svcactor', member: true, present: true, generated: true });
    render(<MemberConfigSection actor={{ id: 'svcactor', kind: '' }} port={{ commands: { readMember: generated, setMember: vi.fn(), setMemberConfig: vi.fn() } }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '读取配置' })); });
    expect(screen.getByText('运行时生成（不在频道描述里）')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '描述条目' })).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑配置' })).toBeNull();
  });
});
