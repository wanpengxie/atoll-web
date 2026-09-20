// @vitest-environment jsdom
// AD-149 migration: the user still opens a real create dialog, receives focus
// in the name field, and submits the public GovernanceFeature command port.
// The command receipt is only a request locator; without the typed creation
// projection the dialog must remain in convergence, not claim ready.
import React, { useState } from 'react';
import {
  act, cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
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

  it('[AD-151] reads the selected template body before submitting the recipe', async () => {
    const getTemplate = vi.fn().mockResolvedValue({
      id: 'team',
      body: { declarations: [{ decl_id: 'mock:steward' }], profile: { serving: 1 } },
    });
    const submit = vi.fn().mockResolvedValue('request-ad151');
    render(<WorkspaceRightPanel
      panel={{ kind: 'channel-administration', initialTab: 'overview' }}
      channel={{ id: 'c0', qualified_name: 'c0' }}
      governance={{ channel: {
        channelTemplates: [{ id: 'team', name: 'Team' }],
        commands: { getTemplate, submit },
        children: [],
      } }}
      onClose={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'templated-room' } });
    fireEvent.click(screen.getByRole('combobox', { name: '频道模板' }));
    fireEvent.click(screen.getByRole('option', { name: 'Team' }));
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));

    await waitFor(() => expect(getTemplate).toHaveBeenCalledWith('team'));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: expect.objectContaining({
        name: 'templated-room', parentId: 'c0', templateId: 'team',
        templateBody: { declarations: [{ decl_id: 'mock:steward' }], profile: { serving: 1 } },
      }),
    })));
    expect(getTemplate.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]);
  });

  it('[AD-152] shows unavailable detail and does not submit when the template body is missing', async () => {
    const getTemplate = vi.fn().mockResolvedValue({ id: 'team', name: 'Team' });
    const submit = vi.fn().mockResolvedValue('should-not-submit');
    render(<WorkspaceRightPanel
      panel={{ kind: 'channel-administration', initialTab: 'overview' }}
      channel={{ id: 'c0', qualified_name: 'c0' }}
      governance={{ channel: {
        channelTemplates: [{ id: 'team', name: 'Team' }],
        commands: { getTemplate, submit },
        children: [],
      } }}
      onClose={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'templated-room' } });
    fireEvent.click(screen.getByRole('combobox', { name: '频道模板' }));
    fireEvent.click(screen.getByRole('option', { name: 'Team' }));
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('终态详情不可用，请刷新或重新进入频道'));
    expect(getTemplate).toHaveBeenCalledWith('team');
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('新频道名称').value).toBe('templated-room');
  });

  it('[AD-153] renders typed convergence and enters only after every fact is ready', async () => {
    const submit = vi.fn().mockResolvedValue('request-ad153');
    const enterChannel = vi.fn().mockResolvedValue(true);
    const harness = { setCreation: null };
    const child = {
      id: 'c0.research',
      name: 'research',
      qualified_name: 'c0.research',
      parent_id: 'c0',
      open: true,
      accessState: { relationship: 'member' },
    };

    function Harness() {
      const [creation, setCreation] = useState(null);
      harness.setCreation = setCreation;
      const commands = {
        submit: async (command) => {
          const requestId = await submit(command);
          setCreation({
            requestId,
            accepted: true,
            ledger: false,
            observable: false,
            membership: false,
            serving: false,
          });
          return requestId;
        },
        enterChannel,
      };
      return <WorkspaceRightPanel
        panel={{ kind: 'channel-administration', initialTab: 'overview' }}
        channel={{ id: 'c0', qualified_name: 'c0' }}
        governance={{ channel: { commands, children: [], creation } }}
        onClose={vi.fn()}
      />;
    }

    render(<Harness />);
    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: expect.objectContaining({ name: 'research', parentId: 'c0' }),
    })));

    const progress = screen.getByRole('region', { name: '频道创建进度' });
    expect(within(progress).getByText('账本确认', { exact: true })).toBeTruthy();
    expect(within(progress).getByText('频道可观察', { exact: true })).toBeTruthy();
    expect(within(progress).getByText('成员关系', { exact: true })).toBeTruthy();
    expect(within(progress).getByText('服务就绪', { exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '进入新频道' })).toBeNull();

    act(() => {
      harness.setCreation({
        requestId: 'request-ad153',
        accepted: true,
        ledger: true,
        observable: true,
        membership: true,
        serving: true,
        channel: child,
      });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '进入新频道' }).disabled).toBe(false));
    expect(within(progress).getAllByText('已确认')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: '进入新频道' }));
    await waitFor(() => expect(enterChannel).toHaveBeenCalledWith({
      channelId: 'c0.research', view: 'conversation',
    }));
  });
});
