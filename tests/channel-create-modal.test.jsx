// @vitest-environment jsdom
// AD-149 migration: the user still opens a real create dialog, receives focus
// in the name field, and submits the public GovernanceFeature command port.
// The command receipt is only a request locator; without the typed creation
// projection the dialog must remain in convergence, not claim ready.
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(cleanup);

describe('创建子频道（GovernanceFeature public owner）', () => {
  it('[AD-149] opens the public dialog, focuses its name field, and submits a real create command', async () => {
    const submit = vi.fn().mockResolvedValue('request-1');
    render(<WorkspaceRightPanel
      panel={{ kind: 'channel-administration', initialTab: 'overview' }}
      channel={{ id: 'c0', qualified_name: 'c0' }}
      governance={{ channel: { commands: { submit }, children: [] } }}
      onClose={vi.fn()}
    />);

    const dialog = screen.getByRole('dialog', { name: '新建频道' });
    const name = screen.getByLabelText('新频道名称');
    expect(dialog).toBeTruthy();
    expect(document.activeElement).toBe(name);

    fireEvent.change(name, { target: { value: 'research' } });
    fireEvent.change(screen.getByLabelText('频道用途'), { target: { value: '分析资料' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: { name: 'research', purpose: '分析资料', parentId: 'c0' },
    })));

    expect(screen.getByRole('region', { name: '频道创建进度' }).textContent).toContain('正在收敛');
    expect(screen.queryByRole('button', { name: '进入新频道' })).toBeNull();
  });
});
