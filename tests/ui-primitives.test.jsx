// @vitest-environment jsdom
import React, { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField } from '../src/ui/primitives/FormField.jsx';
import { InlineConfirmation } from '../src/ui/primitives/InlineConfirmation.jsx';
import { PanelCard } from '../src/ui/primitives/PanelCard.jsx';
import { PanelTabs } from '../src/ui/primitives/PanelTabs.jsx';
import { SelectMenu } from '../src/ui/primitives/SelectMenu.jsx';
import { SidePanel } from '../src/ui/primitives/SidePanel.jsx';

afterEach(cleanup);

describe('SelectMenu', () => {
  const options = [{ value: 'alice', label: 'Alice' }, { value: 'bob', label: 'Bob' }, { value: 'blocked', label: 'Blocked', disabled: true }];

  it('通过真实展开和点击选择值', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectMenu ariaLabel="选择用户" value="" placeholder="请选择" options={options} onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: '选择用户' }));
    expect(screen.getByRole('listbox', { name: '选择用户选项' })).toBeTruthy();
    await user.click(screen.getByRole('option', { name: 'Alice' }));
    expect(onChange).toHaveBeenCalledWith('alice');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('支持方向键、Enter、Escape 和 disabled 选项', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectMenu ariaLabel="选择用户" value="" options={options} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('alice');
    await user.keyboard('{Enter}{End}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('bob');
    await user.keyboard('{Enter}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('PanelTabs', () => {
  it('按实际标签数量渲染并支持方向键切换', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const tabs = [{ id: 'one', label: '一' }, { id: 'two', label: '二' }, { id: 'three', label: '三', disabled: true }];
    const { rerender } = render(<PanelTabs label="区域" tabs={tabs} activeTab="one" onChange={onChange} />);
    const first = screen.getByRole('tab', { name: '一' });
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('two');
    rerender(<PanelTabs label="区域" tabs={tabs} activeTab="two" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: '二' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('SidePanel 与表单 primitives', () => {
  it('无标签时仍只有一个明确滚动区', () => {
    render(<SidePanel ariaLabel="自动化" eyebrow="LOCAL" title="定时动作" onClose={() => {}}><p>内容</p></SidePanel>);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelectorAll('.side-panel-scroll')).toHaveLength(1);
    expect(screen.getByText('内容')).toBeTruthy();
  });

  it('FormField 关联 label、说明和错误', () => {
    render(<FormField label="名称" description="公开显示" error="不能为空" required><input /></FormField>);
    const input = screen.getByLabelText(/^名称/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('-description');
    expect(input.getAttribute('aria-describedby')).toContain('-error');
  });

  it('PanelCard 支持语义元素而不拥有业务状态', () => {
    render(<PanelCard as="form" title="创建频道"><button type="submit">提交</button></PanelCard>);
    expect(screen.getByRole('heading', { name: '创建频道' })).toBeTruthy();
    expect(document.querySelector('form.panel-card')).toBeTruthy();
  });
});

describe('InlineConfirmation', () => {
  it('进入时聚焦取消，Escape 取消并在卸载后返回焦点', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const openerRef = createRef();
    const { rerender } = render(<><button ref={openerRef}>移除</button><InlineConfirmation title="确认移除？" onConfirm={() => {}} onCancel={onCancel} returnFocusRef={openerRef} /></>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    rerender(<button ref={openerRef}>移除</button>);
    expect(document.activeElement).toBe(openerRef.current);
  });
});
