// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

describe('Governance UI owner contracts', () => {
  it('keeps overview facts and child directory on the read side of the channel port', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ChannelAdministrationPanel
      channel={{
        id: 'c0',
        qualified_name: 'c0',
        parent_id: null,
        owner_principal: 'root',
        open: true,
        description: '空间根频道',
      }}
      initialTab="overview"
      port={{
        children: [{ id: 'c1', name: 'Project', open: true }],
        commands: { refresh },
      }}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('CHANNEL CONTEXT')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '频道详情' })).toBeTruthy();
    expect(screen.getAllByText('空间根频道').length).toBeGreaterThan(0);
    expect(screen.getByText(/Project/)).toBeTruthy();
    expect(screen.getAllByText('服务中').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '刷新目录事实' }));
    expect(refresh).toHaveBeenCalledWith('directory');
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
});
