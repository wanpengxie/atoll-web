// @vitest-environment jsdom
// 空间管理 → Actor 描述：不可变的 名字@版本。同名再建是下一个版本；退役只让
// 它不能再被新成员引用。命令经 space.commands.submit，由 WorkspaceApp 映射到
// system.actor.description.create / retire。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

const ROWS = [
  { id: 'writer@1', name: 'writer', version: 1, ref: 'writer@1', class: 'claude', status: 'retired', owner: 'root' },
  { id: 'writer@2', name: 'writer', version: 2, ref: 'writer@2', class: 'claude', status: 'present', description: '写作助手', params: { model: 'claude-opus' } },
  { id: 'analyst@1', name: 'analyst', version: 1, ref: 'analyst@1', class: 'codex-agent', status: 'present', params: {} },
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
  it('groups versions by name, newest first, and says which are retired', () => {
    const { refresh } = renderPanel();
    const sections = screen.getAllByRole('region').filter((node) => node.getAttribute('aria-label')?.startsWith('Actor 描述 '));
    expect(sections.map((node) => node.getAttribute('aria-label'))).toEqual(['Actor 描述 analyst', 'Actor 描述 writer']);
    const writer = screen.getByRole('region', { name: 'Actor 描述 writer' });
    expect(within(writer).getByText('2 个版本')).toBeTruthy();
    const versions = [...writer.querySelectorAll('.actor-description-version')];
    expect(versions.map((node) => node.dataset.ref)).toEqual(['writer@2', 'writer@1']);
    expect(versions[0].textContent).toContain('class claude · 可用');
    expect(versions[0].textContent).toContain('写作助手');
    expect(versions[0].querySelector('details pre').textContent).toContain('claude-opus');
    expect(versions[1].textContent).toContain('class claude · 已退役 · root');
    // 退役过的版本不再给退役按钮。
    expect(within(versions[1]).queryByRole('button', { name: '退役' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '刷新' })[0]);
    expect(refresh).toHaveBeenCalled();
  });

  it('creates the next version of a name and sends name, class, description and params', async () => {
    const { submit } = renderPanel();
    fireEvent.change(screen.getByLabelText('Actor 描述名字'), { target: { value: 'writer' } });
    // 同名再建：提示下一个版本号。
    expect(screen.getByText('将建成 writer@3')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Actor 描述名字'), { target: { value: 'reviewer' } });
    expect(screen.getByText('将建成 reviewer@1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Actor 描述 Class'), { target: { value: 'claude' } });
    fireEvent.change(screen.getByLabelText('Actor 描述说明'), { target: { value: '审稿' } });
    fireEvent.change(screen.getByLabelText('Actor 描述参数 JSON'), { target: { value: '[1]' } });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(await screen.findByText('参数必须是 JSON 对象')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Actor 描述参数 JSON'), { target: { value: '{"api_key":"$required:审稿服务的 key"}' } });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'space',
      action: 'actor_description_create',
      payload: { name: 'reviewer', class: 'claude', description: '审稿', params: { api_key: '$required:审稿服务的 key' } },
    }));
    await screen.findByText('Actor 描述已新建。');
    // 建成后说明和参数清空，名字留着方便再建下一个版本。
    expect(screen.getByLabelText('Actor 描述说明').value).toBe('');
    expect(screen.getByLabelText('Actor 描述参数 JSON').value).toBe('{}');
  });

  it('retires one version only after confirmation', async () => {
    const { submit } = renderPanel();
    const current = document.querySelector('[data-ref="writer@2"]');
    fireEvent.click(within(current).getByRole('button', { name: '退役' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText('退役 writer@2？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'space', action: 'actor_description_retire', payload: { name: 'writer', version: 2 },
    }));
    await screen.findByText('writer@2 已退役。');
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
