// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalSearch } from '../src/ui/GlobalSearch.jsx';
import { TaskCreateModal } from '../src/ui/TaskCreateModal.jsx';

afterEach(cleanup);

function TaskHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>打开任务</button>
    {open && <TaskCreateModal providers={[{ actorId: 'agent-1', name: '助手' }]} onSubmit={vi.fn()} onClose={() => setOpen(false)} />}
  </>;
}

describe('F6 模态焦点契约', () => {
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
      return <><button type="button" onClick={() => setOpen(true)}>搜索</button>{open && <GlobalSearch index={[]} onOpen={() => {}} onClose={() => setOpen(false)} />}</>;
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '搜索' });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /搜索频道/ }));
    expect(opener.getAttribute('aria-hidden')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
