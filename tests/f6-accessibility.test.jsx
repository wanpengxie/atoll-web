// @vitest-environment jsdom
// Current-owner successor for the deleted GlobalSearch/TaskCreateModal
// focus tests.  Both surfaces now use useModalFocus through SearchFeature and
// TaskCreationDialog; no legacy modal aliases are restored.
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchFeature } from '../src/ui/features/search/SearchFeature.jsx';
import { TaskCreationDialog } from '../src/ui/features/tasks/TasksFeature.jsx';

afterEach(cleanup);

function TaskHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>打开任务</button>
    {open && <TaskCreationDialog
      port={{
        creation: { providers: [{ actorId: 'agent-1', name: '助手' }] },
        commands: { createTask: async () => {} },
      }}
      onClose={() => setOpen(false)}
    />}
  </>;
}

function SearchHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>打开搜索</button>
    {open && <SearchFeature port={{ index: [], commands: { close: () => setOpen(false) } }} />}
  </>;
}

describe('F6 current modal focus contract', () => {
  it('moves focus into TaskCreationDialog, traps reverse Tab, and restores its opener', async () => {
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

  it('makes the background inert while SearchFeature is open and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<SearchHarness />);
    const opener = screen.getByRole('button', { name: '打开搜索' });
    await user.click(opener);

    const input = screen.getByRole('textbox', { name: '搜索频道、消息、文件、任务或成员' });
    expect(document.activeElement).toBe(input);
    expect(opener.inert).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.inert).toBe(false);
  });
});
