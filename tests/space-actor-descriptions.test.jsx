// @vitest-environment jsdom
// 空间管理 → Actor 描述：每条有自己的 id，版本挂在 id 下，每一版不可改。给已有的
// 一条出新版本是带它的 id 再建；名字只显示，两条描述可以同名。退役只让这一版不能
// 再被新成员引用。命令经 space.commands.submit，由 WorkspaceApp 映射到
// system.actor.description.create / retire。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

const ROWS = [
  { id: 'd-writer', name: 'writer', version: 1, ref: 'd-writer@1', class: 'claude', status: 'retired', owner: 'root' },
  { id: 'd-writer', name: 'writer', version: 2, ref: 'd-writer@2', class: 'claude', status: 'present', description: '写作助手', params: { model: 'claude-opus' } },
  { id: 'd-analyst', name: 'analyst', version: 1, ref: 'd-analyst@1', class: 'codex-agent', status: 'present', params: {} },
  // 另一条同名描述：名字只显示，按 id 各成一组。
  { id: 'd-writer-b', name: 'writer', version: 1, ref: 'd-writer-b@1', class: 'codex', status: 'present', configurable: false },
];

function renderPanel(overrides = {}) {
  const submit = overrides.submit || vi.fn().mockResolvedValue({ ref: 'x@1' });
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<SpaceAdministrationPanel
    port={{ disabled: false, actorDescriptions: ROWS, devices: [], commands: { submit, refresh }, ...overrides.port }}
    onClose={vi.fn()}
  />);
  return { submit, refresh };
}

describe('space administration: actor descriptions', () => {
  it('groups versions by description id, newest first; same-named descriptions stay apart', () => {
    const { refresh } = renderPanel();
    const sections = [...document.querySelectorAll('section.actor-description')];
    expect(sections.map((node) => node.dataset.descriptionId)).toEqual(['d-analyst', 'd-writer', 'd-writer-b']);
    const writer = document.querySelector('[data-description-id="d-writer"]');
    expect(within(writer).getByText(/2 个版本/)).toBeTruthy();
    const versions = [...writer.querySelectorAll('.actor-description-version')];
    expect(versions.map((node) => node.dataset.ref)).toEqual(['d-writer@2', 'd-writer@1']);
    expect(versions[0].textContent).toContain('class claude · 可用');
    expect(versions[0].textContent).toContain('写作助手');
    expect(versions[0].querySelector('details pre').textContent).toContain('claude-opus');
    expect(versions[1].textContent).toContain('class claude · 已退役 · root');
    // 退役过的版本不再给退役按钮。
    expect(within(versions[1]).queryByRole('button', { name: '退役' })).toBeNull();
    expect(document.querySelector('[data-ref="d-writer-b@1"]').textContent).toContain('不可配置');
    fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[0]);
    expect(refresh).toHaveBeenCalled();
  });

  it('creates a new description without an id, and a new version with its id', async () => {
    const { submit } = renderPanel();
    expect(screen.getByRole('button', { name: '新建' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Actor 描述名字'), { target: { value: 'writer' } });
    fireEvent.change(screen.getByLabelText('Actor 描述 Class'), { target: { value: 'claude' } });
    fireEvent.change(screen.getByLabelText('Actor 描述说明'), { target: { value: '审稿' } });
    fireEvent.change(screen.getByLabelText('Actor 描述参数 JSON'), { target: { value: '[1]' } });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(await screen.findByText('参数必须是 JSON 对象')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();

    // 同名的新描述照样能建：不带 id，就是新的一条。
    fireEvent.change(screen.getByLabelText('Actor 描述参数 JSON'), { target: { value: '{"api_key":"$required:审稿服务的 key"}' } });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'space',
      action: 'actor_description_create',
      payload: { name: 'writer', class: 'claude', description: '审稿', params: { api_key: '$required:审稿服务的 key' }, configurable: true },
    }));
    await screen.findByText('Actor 描述已新建。');
    expect(screen.getByLabelText('Actor 描述说明').value).toBe('');
    expect(screen.getByLabelText('Actor 描述参数 JSON').value).toBe('{}');

    // 给 d-writer 出新版本：带它的 id，表单预填它最新一版。
    fireEvent.click(screen.getByRole('combobox', { name: '新建还是出新版本' }));
    fireEvent.click(screen.getByRole('option', { name: 'writer 的新版本（现为 @2）' }));
    expect(screen.getByText('将建成 writer @3')).toBeTruthy();
    expect(screen.getByLabelText('Actor 描述 Class').value).toBe('claude');
    fireEvent.click(screen.getByLabelText('可被配置'));
    fireEvent.click(screen.getByRole('button', { name: '出新版本' }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({
      scope: 'space',
      action: 'actor_description_create',
      payload: { id: 'd-writer', name: 'writer', class: 'claude', description: '写作助手', params: { model: 'claude-opus' }, configurable: false },
    }));
  });

  it('retires one version only after confirmation, by description id', async () => {
    const { submit } = renderPanel();
    const current = document.querySelector('[data-ref="d-writer@2"]');
    fireEvent.click(within(current).getByRole('button', { name: '退役' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText('退役 writer @2？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'space', action: 'actor_description_retire', payload: { id: 'd-writer', version: 2 },
    }));
    await screen.findByText('writer @2 已退役。');
  });

  it('shows a rejected command as an error and an unavailable directory as a status', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('invalid_args：class nope is not a class this node has'));
    renderPanel({ submit, port: { actorDescriptions: [], actorDescriptionsUnavailable: true } });
    expect(screen.getByText('Actor 描述目录当前不可用。')).toBeTruthy();
    expect(screen.getByText('还没有 Actor 描述。')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Actor 描述名字'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Actor 描述 Class'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('class nope is not a class this node has'));
  });
});
