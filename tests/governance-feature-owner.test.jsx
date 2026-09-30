// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

describe('Governance UI owner contracts', () => {
  it('keeps overview facts and child directory on the read side of the channel port', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const readChannel = vi.fn();
    render(<ChannelAdministrationPanel
      channel={{
        id: 'c0',
        qualified_name: 'c0',
        parent_id: null,
        owner_principal: 'root',
        open: true,
      }}
      initialTab="overview"
      port={{
        children: [{ id: 'c1', name: 'Project', open: true }],
        commands: { refresh, readChannel },
      }}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('CHANNEL CONTEXT')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '频道详情' })).toBeTruthy();
    // 概览这一页现在叫「设置」。
    expect(screen.getByRole('tab', { name: '设置' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('无（空间根）')).toBeTruthy();
    expect(screen.getByText(/Project/)).toBeTruthy();
    expect(screen.getAllByText('服务中').length).toBeGreaterThan(0);
    // 频道状态按需读：打开面板不发 system.channel.get。
    expect(readChannel).not.toHaveBeenCalled();
    expect(screen.getByText(/点「读取」发一条 system.channel.get/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '刷新目录事实' }));
    expect(refresh).toHaveBeenCalledWith('directory');
  });

  it('reads the channel on demand and shows only the registry\'s facts: the description and its revision', async () => {
    // Even a reply that still carried the old runtime fields shows none of
    // them: the card has no health, no channel build, no member builds.
    const view = {
      id: 'c0.project',
      health: 'broken',
      health_reason: 'the channel is not open on this node',
      description: { revision: 3, body: { members: [], description: '项目频道', serving: 1, devices: ['laptop'] } },
      build: { object: { kind: 'channel', channel: 'c0.project' }, description: { channel_revision: 3 }, attempt: 1, result: 'ok', state: 'serving' },
      members: [
        { object: { kind: 'member', channel: 'c0.project', name: 'writer' }, description: { channel_revision: 3, actor: 'writer@1' }, attempt: 4, result: 'failed', state: 'stopped', reason: 'service.api_key is a placeholder still unfilled' },
      ],
    };
    const readChannel = vi.fn().mockResolvedValue(view);
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0.project', qualified_name: 'c0.project', open: true }}
      initialTab="overview"
      port={{ children: [], roster: [], commands: { readChannel, selectActor: vi.fn() } }}
      onClose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await screen.findByText('第 3 版');
    expect(readChannel).toHaveBeenCalledWith('c0.project');
    expect(screen.getByText('项目频道', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByLabelText('频道说明').value).toBe('项目频道');
    const card = document.querySelector('.channel-runtime');
    expect(card.textContent).not.toContain('健康');
    expect(card.textContent).not.toContain('损坏');
    expect(card.textContent).not.toContain('频道自身');
    expect(card.querySelector('.build-line')).toBeNull();
    expect(screen.queryByLabelText('成员构建摘要')).toBeNull();
    expect(card.textContent).not.toContain('service.api_key is a placeholder still unfilled');
  });

  it('writes description and serving through update_profile and re-reads the channel', async () => {
    const readChannel = vi.fn()
      .mockResolvedValueOnce({ description: { revision: 2, body: { members: [], description: '旧说明', serving: 0 } } })
      .mockResolvedValueOnce({ description: { revision: 3, body: { members: [], description: '新说明', serving: 1 } } });
    const submit = vi.fn().mockResolvedValue({ channel_id: 'c0.project', revision: 3 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0.project', qualified_name: 'c0.project' }}
      initialTab="overview"
      port={{ children: [], commands: { readChannel, submit, refresh } }}
      onClose={vi.fn()}
    />);
    // 没读到描述之前，没有能写的表单。
    expect(screen.queryByLabelText('频道说明')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    const text = await screen.findByLabelText('频道说明');
    expect(text.value).toBe('旧说明');
    expect(screen.getByLabelText('对外服务').checked).toBe(false);
    fireEvent.change(text, { target: { value: '新说明' } });
    fireEvent.click(screen.getByLabelText('对外服务'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel', action: 'update_profile',
      payload: { channelId: 'c0.project', description: '新说明', serving: true },
    }));
    await screen.findByText('第 3 版');
    expect(refresh).toHaveBeenCalledWith('directory');
    expect(readChannel).toHaveBeenCalledTimes(2);
  });

  it('attaches and detaches space devices through the channel description, never local-device', async () => {
    const readChannel = vi.fn().mockResolvedValue({ description: { revision: 2, body: { members: [], serving: 0, devices: ['laptop'] } } });
    const submit = vi.fn().mockResolvedValue({ revision: 3 });
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0.project', qualified_name: 'c0.project' }}
      initialTab="overview"
      port={{
        children: [],
        spaceDevices: [
          { id: 'local-device', name: 'local-device', online: true },
          { id: 'laptop', name: 'Laptop', online: true },
          { id: 'nas', name: 'NAS', online: false },
        ],
        channelDevices: [{ id: 'local-device' }, { id: 'laptop' }],
        commands: { readChannel, submit },
      }}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await screen.findByText('第 2 版');
    const rows = [...document.querySelectorAll('.channel-devices .device-row[data-device-id]')];
    expect(rows.map((row) => row.dataset.deviceId)).toEqual(['laptop', 'nas']);
    expect(rows[0].textContent).toContain('已挂载');
    expect(rows[1].textContent).toContain('离线 · 未挂载');
    expect(document.querySelector('.channel-devices .device-row.default').textContent).toContain('默认 · 不需要挂载');

    fireEvent.click(within(rows[1]).getByRole('button', { name: '挂到本频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ scope: 'channel', action: 'attach_device', payload: { channelId: 'c0.project', deviceId: 'nas' } }));
    fireEvent.click(within(rows[0]).getByRole('button', { name: '卸载' }));
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith({ scope: 'channel', action: 'detach_device', payload: { channelId: 'c0.project', deviceId: 'laptop' } }));
    // 每次写完重新读频道。
    await waitFor(() => expect(readChannel).toHaveBeenCalledTimes(3));
  });

  it('says a platform-built channel has no description and offers no description form', async () => {
    const readChannel = vi.fn().mockResolvedValue({ id: 'c0' });
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0' }}
      initialTab="overview"
      port={{ children: [], commands: { readChannel } }}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await screen.findByText('这个频道由平台搭建，没有频道描述；成员固定。');
    expect(screen.queryByText('正常')).toBeNull();
    expect(screen.queryByText('还没有成员构建记录。')).toBeNull();
    expect(screen.queryByLabelText('频道说明')).toBeNull();
  });

  it('uses optional lifecycle ports for bind and restart, while keeping owner protected', async () => {
    const bindActor = vi.fn().mockResolvedValue({ accepted: true });
    const restartActor = vi.fn().mockResolvedValue({ accepted: true });
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ChannelAdministrationPanel
      channel={{ id: 'c1', owner_principal: 'root' }}
      port={{
        selfId: 'root',
        roster: [
          { id: 'worker', name: 'Worker', kind: 'agent', principal: 'worker-principal', bound: false },
          { id: 'root', name: 'Root', kind: 'human', principal: 'root', bound: true },
        ],
        commands: { bindActor, restartActor, refresh },
      }}
      onClose={vi.fn()}
    />);

    const worker = screen.getByText('Worker').closest('.managed-actor');
    expect(worker).toBeTruthy();
    expect(within(worker).getByText('未绑定')).toBeTruthy();
    fireEvent.click(within(worker).getByRole('button', { name: '绑定' }));
    await waitFor(() => expect(bindActor).toHaveBeenCalledWith({ channelId: 'c1', actorId: 'worker' }));
    expect(refresh).toHaveBeenCalledWith('members');

    fireEvent.click(within(worker).getByRole('button', { name: '重启' }));
    fireEvent.click(screen.getByRole('button', { name: '确认操作' }));
    await waitFor(() => expect(restartActor).toHaveBeenCalledWith({ channelId: 'c1', actorId: 'worker', reason: 'governance' }));
    expect(within(screen.getByText('Root').closest('.managed-actor')).getByRole('button', { name: 'Owner' }).disabled).toBe(true);
  });

  it('states the backend root protection instead of exposing a retire control', () => {
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0' }}
      initialTab="danger"
      port={{ commands: {} }}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('空间根频道 c0 受后端保护，不能退役。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '退役当前频道' })).toBeNull();
  });

  it('keeps a null channel projection renderable during directory handoff', () => {
    render(<ChannelAdministrationPanel
      channel={null}
      initialTab="overview"
      port={{ children: [], commands: {} }}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('heading', { name: '频道详情' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '当前频道' })).toBeTruthy();
    expect(screen.getAllByText('状态未知').length).toBeGreaterThan(0);
  });
});
