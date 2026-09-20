// @vitest-environment jsdom
import React, { createRef } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(cleanup);

function governancePort(overrides = {}) {
  return {
    roster: [],
    principals: [],
    declarations: [],
    commands: {},
    ...overrides,
  };
}

describe('治理成员布局与菜单焦点 owner', () => {
  it('保留六个 row child：disabled 绑定/重启仍占位且不会把移除挤到第二行', () => {
    render(<ChannelAdministrationPanel
      channel={{ id: 'c1' }}
      port={governancePort({
        roster: [{ id: 'worker', name: 'Worker', kind: 'agent', bound: null }],
      })}
      onClose={vi.fn()}
    />);

    const row = screen.getByText('Worker').closest('.managed-actor');
    expect(row).toBeTruthy();
    expect(row.children).toHaveLength(6);
    expect(within(row).getByRole('button', { name: '绑定' }).disabled).toBe(true);
    expect(within(row).getByRole('button', { name: '重启' }).disabled).toBe(true);
    expect(within(row).getByRole('button', { name: '移除' }).disabled).toBe(false);
    expect(screen.getByText('当前治理端口未提供绑定或重启命令；这里仅展示目录事实、查看与已有移除入口。')).toBeTruthy();
  });

  it('Escape 只关闭参与者 popover，并把焦点留在 combobox，不关闭整个 context', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const openerRef = createRef();
    render(<>
      <button ref={openerRef} type="button">打开治理</button>
      <WorkspaceRightPanel
        panel="channel-administration"
        channel={{ id: 'c1' }}
        governance={{ channel: governancePort() }}
        onClose={onClose}
      />
    </>);

    const panel = screen.getByRole('complementary', { name: '频道治理' });
    const select = within(panel).getByRole('combobox', { name: '选择参与者' });
    await user.click(select);
    expect(within(panel).getByRole('listbox', { name: '选择参与者选项' })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(within(panel).queryByRole('listbox', { name: '选择参与者选项' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: '频道治理' })).toBeTruthy();
    expect(document.activeElement).toBe(select);
  });
});
