// @vitest-environment jsdom
// 恢复对应：tests/f6-accessibility.test.jsx（master，已删除）。旧结构
// src/ui/GlobalSearch.jsx / src/ui/TaskCreateModal.jsx 已被
// src/ui/features/search/SearchFeature.jsx / src/ui/features/tasks/TasksFeature.jsx::TaskCreationDialog
// 取代，两者共用同一个模态无障碍契约 src/ui/primitives/useModalFocus.js（此前零测试覆盖）。
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCreationDialog } from '../src/ui/features/tasks/TasksFeature.jsx';
import { SearchFeature } from '../src/ui/features/search/SearchFeature.jsx';

afterEach(cleanup);

function TaskHarness() {
  const [open, setOpen] = useState(false);
  const port = { creation: { providers: [{ actorId: 'agent-1', name: '助手' }] }, commands: { createTask: vi.fn() } };
  return <>
    <button type="button" onClick={() => setOpen(true)}>打开任务</button>
    {open && <TaskCreationDialog port={port} onClose={() => setOpen(false)} />}
  </>;
}

describe('F6 模态焦点契约（恢复自 tests/f6-accessibility.test.jsx）', () => {
  it('任务弹窗进入后聚焦首字段、Tab 不逃逸并在关闭后恢复来源', async () => {
    const user = userEvent.setup();
    render(<TaskHarness />);
    const opener = screen.getByRole('button', { name: '打开任务' });
    await user.click(opener);
    const title = screen.getByRole('textbox', { name: '任务内容' });
    expect(document.activeElement).toBe(title);
    expect(opener.inert).toBe(true);

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭新建任务' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.inert).toBe(false);
  });

  it('全局搜索将背景设为 inert，Escape 关闭并恢复焦点', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setOpen(true)}>搜索</button>
        {open && <SearchFeature port={{ index: [], commands: { open: vi.fn(), close: () => setOpen(false) } }} />}
      </>;
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '搜索' });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /搜索频道/ }));
    expect(opener.inert).toBe(true);
    expect(opener.getAttribute('aria-hidden')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener.inert).toBe(false);
    expect(opener.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
