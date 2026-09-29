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
      payload: { name: 'research', purpose: '分析资料', parentId: 'c0', humans: [] },
    })));

    expect(screen.getByRole('region', { name: '频道创建进度' }).textContent).toContain('正在收敛');
    expect(screen.queryByRole('button', { name: '进入新频道' })).toBeNull();
  });

  it('[AD-151] copies another channel\'s description with copy_from and brings the chosen humans', async () => {
    const submit = vi.fn().mockResolvedValue('request-copy');
    render(<WorkspaceRightPanel
      panel={{ kind: 'channel-administration', initialTab: 'overview' }}
      channel={{ id: 'c0', qualified_name: 'c0' }}
      governance={{ channel: {
        commands: { submit },
        children: [],
        selfId: 'human:root:1',
        copyableChannels: [{ id: 'c0.project', qualified_name: 'c0.project' }, { id: 'c0.public', qualified_name: 'c0.public' }],
        principals: [{ id: 'alice', kind: 'human', display_name: 'Alice' }, { id: 'retired', kind: 'human', status: 'retired' }, { declared: { id: 'bob', kind: 'human', email: 'bob@x' } }],
      } }}
      onClose={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'copied-room' } });
    fireEvent.click(screen.getByLabelText('起点 复制一个频道'));
    // 复制时说明随源频道的描述一起来，不再单独填。
    expect(screen.queryByLabelText('频道用途')).toBeNull();
    // 还没选源频道：不能提交。
    expect(screen.getByRole('button', { name: '创建频道' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('combobox', { name: '复制的频道' }));
    fireEvent.click(screen.getByRole('option', { name: 'c0.project' }));

    // 带进来的人：自己恒在（固定一行），退役的人不列出。
    const humans = screen.getByRole('region', { name: '带进来的人' });
    expect(within(humans).getByText('human:root:1')).toBeTruthy();
    expect(within(humans).queryByLabelText(/retired/)).toBeNull();
    fireEvent.click(within(humans).getByLabelText('带上用户 bob@x'));
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel', action: 'create_child',
      payload: { name: 'copied-room', parentId: 'c0', humans: ['bob'], copyFrom: 'c0.project' },
    }));
  });

  it('[AD-152] reads this channel\'s description on demand and submits only the picked member entries', async () => {
    const entries = [
      { name: 'writer', body: { actor: 'writer@1' }, params: { temperature: 0.3 } },
      { name: 'helper', body: { class: 'codex' } },
    ];
    const readDescription = vi.fn()
      .mockRejectedValueOnce(new Error('this channel is built by the platform and has no description'))
      .mockResolvedValueOnce({ body: { members: entries }, revision: 3 });
    const submit = vi.fn().mockResolvedValue('request-pick');
    render(<WorkspaceRightPanel
      panel={{ kind: 'channel-administration', initialTab: 'overview' }}
      channel={{ id: 'c0.project', qualified_name: 'c0.project' }}
      governance={{ channel: { commands: { readDescription, submit }, children: [], principals: [] } }}
      onClose={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'picked' } });
    fireEvent.change(screen.getByLabelText('频道用途'), { target: { value: '挑几个成员' } });
    fireEvent.click(screen.getByLabelText('起点 从本频道挑成员'));
    // 手动挡：选中这个起点不会自己去读描述。
    expect(readDescription).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '创建频道' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '读取 c0.project 的成员条目' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('has no description'));
    fireEvent.click(screen.getByRole('button', { name: '读取 c0.project 的成员条目' }));
    await screen.findByLabelText('抄成员条目 writer');
    expect(readDescription).toHaveBeenCalledWith('c0.project');
    expect(screen.getByText('actor writer@1')).toBeTruthy();
    expect(screen.getByText('class codex')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('抄成员条目 writer'));
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel', action: 'create_child',
      payload: { name: 'picked', parentId: 'c0.project', humans: [], purpose: '挑几个成员', members: [entries[0]] },
    }));
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

  it('keeps the typed ledger code, server detail, and retry draft visible', async () => {
    const submit = vi.fn().mockResolvedValue('request-unauthorized');
    function Harness() {
      const [creation, setCreation] = useState(null);
      const commands = {
        submit: async (command) => {
          const requestId = await submit(command);
          setCreation({
            requestId,
            accepted: true,
            failed: true,
            error: '账本失败：unauthorized_sender（sender is not an active channel member）',
          });
          return requestId;
        },
      };
      return <WorkspaceRightPanel
        panel={{ kind: 'channel-administration', initialTab: 'overview' }}
        channel={{ id: 'c0', qualified_name: 'c0' }}
        governance={{ channel: { commands, children: [], creation } }}
        onClose={vi.fn()}
      />;
    }

    render(<Harness />);
    const name = screen.getByLabelText('新频道名称');
    fireEvent.change(name, { target: { value: 'denied-room' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('账本失败：unauthorized_sender'));
    expect(screen.getByRole('alert').textContent).toContain('sender is not an active channel member');
    expect(screen.getByRole('region', { name: '频道创建进度' }).textContent).toContain('创建失败');
    expect(screen.getByRole('button', { name: '重新创建' }).disabled).toBe(false);
    expect(name.value).toBe('denied-room');
  });
});
