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
          create: vi.fn(async (name) => { state.names.push(name); state.names.sort(); }),
          write: vi.fn(async () => {}),
          remove: vi.fn(async (name) => { state.names = state.names.filter((row) => row !== name); }),
        },
      },
    };
  }

  it('lists names only, adds with a password value and never shows the value again', async () => {
    const { value } = port();
    const { container } = render(<GlobalKeysPanel port={value} />);
    await screen.findByText('openai_prod');
    expect(screen.getByText('$global.openai_prod')).toBeTruthy();
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
    // 值不在任何可见文本里，输入框也清空了。
    expect(container.textContent).not.toContain('sk-deep-secret');
    expect([...container.querySelectorAll('input')].some((input) => input.value.includes('sk-deep-secret'))).toBe(false);
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

describe('member layers in the roster and member config', () => {
  it('keeps ready rows thin and names the layer and reason of a member that cannot serve', () => {
    render(<RosterFeature port={{ rows: [
      { id: 'steward', kind: 'agent', name: 'steward', bound: true, deviceOnline: null, standard: { state: 'ready' }, business: { state: 'ready' } },
      { id: 'deepseek', kind: 'agent', name: 'DeepSeek', bound: true, standard: { state: 'ready' }, business: { state: 'stuck', reason: 'missing global resource global/deepseek_prod' } },
      { id: 'search-tool', kind: 'tool', name: 'Search Tool', bound: true, standard: { state: 'ready' }, business: { state: 'retrying', reason: 'connection refused' } },
    ] }} />);
    const rows = screen.getAllByRole('button').filter((node) => node.classList.contains('roster-row'));
    expect(rows[0].textContent).not.toContain('业务层');
    expect(rows[0].textContent).toContain('已绑定');
    expect(rows[1].textContent).toContain('卡住');
    expect(rows[1].textContent).toContain('业务层卡住：missing global resource global/deepseek_prod');
    expect(rows[2].textContent).toContain('业务层重试中：connection refused');
  });

  it('reads config on demand, edits it, and sends only the changed top-level keys', async () => {
    const readMember = vi.fn()
      .mockResolvedValueOnce({ class: 'deepseek-agent', config: { model: 'deepseek-chat', api_key: '$global.deepseek_prod' }, source: { decl_id: 'mock:deepseek' } })
      .mockResolvedValueOnce({ class: 'deepseek-agent', config: { model: 'deepseek-reasoner', api_key: '$global.deepseek_prod' }, source: { decl_id: 'mock:deepseek' } });
    const setMember = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('invalid_args：config refused by deepseek-agent: temperature must be a number between 0 and 2'), { code: 'invalid_args', detail: 'config refused by deepseek-agent: temperature must be a number between 0 and 2' }))
      .mockResolvedValueOnce({ member: 'deepseek', changed: true, rebuilt: true });
    const list = vi.fn(async () => ['deepseek_prod', 'openai_prod']);
    render(<MemberConfigSection actor={{ id: 'deepseek', kind: 'agent' }} port={{ commands: { readMember, setMember }, globalKeys: { available: true, commands: { list } } }} />);
    // 手动挡：不点就不发 member.get。
    expect(readMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '读取配置' }));
    await screen.findByText('声明 mock:deepseek');
    expect(screen.getByLabelText('当前配置').textContent).toContain('$global.deepseek_prod');

    fireEvent.click(screen.getByRole('button', { name: '编辑配置' }));
    const editor = screen.getByRole('form', { name: '编辑成员配置' });
    await waitFor(() => expect(within(editor).getByRole('option', { name: 'openai_prod' })).toBeTruthy());
    const textarea = within(editor).getByLabelText('成员配置 JSON');
    fireEvent.change(textarea, { target: { value: '{"model":"deepseek-reasoner","temperature":9}' } });
    expect(within(editor).getByText(/将提交的变更/)).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: '保存配置' }));
    await within(editor).findByText(/temperature must be a number/);
    expect(setMember).toHaveBeenLastCalledWith({
      actor: { id: 'deepseek', kind: 'agent' }, klass: '', dryRun: false,
      config: { model: 'deepseek-reasoner', temperature: 9, api_key: null },
    });

    // 插入引用：在光标处放一个 "$global.<name>"。
    fireEvent.change(textarea, { target: { value: '{"model":"deepseek-reasoner","api_key":}' } });
    textarea.setSelectionRange(textarea.value.length - 1, textarea.value.length - 1);
    fireEvent.change(within(editor).getByLabelText('选择全局 key'), { target: { value: 'deepseek_prod' } });
    fireEvent.click(within(editor).getByRole('button', { name: '插入引用' }));
    expect(textarea.value).toBe('{"model":"deepseek-reasoner","api_key":"$global.deepseek_prod"}');
    fireEvent.click(within(editor).getByRole('button', { name: '保存配置' }));
    await screen.findByText('配置已保存，成员已按新配置重建。');
    expect(setMember).toHaveBeenLastCalledWith({ actor: { id: 'deepseek', kind: 'agent' }, klass: '', dryRun: false, config: { model: 'deepseek-reasoner' } });
    expect(readMember).toHaveBeenCalledTimes(2);
  });

  it('offers no editing for members without a class', async () => {
    const readMember = vi.fn().mockResolvedValue({ actor_id: 'root', member: true, present: true });
    render(<MemberConfigSection actor={{ id: 'root', kind: 'human' }} port={{ commands: { readMember, setMember: vi.fn() } }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '读取配置' })); });
    expect(screen.queryByRole('button', { name: '编辑配置' })).toBeNull();
    expect(screen.getByText('只有 Agent 和工具成员有可编辑的配置。')).toBeTruthy();
  });
});
