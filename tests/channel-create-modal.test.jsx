// @vitest-environment jsdom
import React, { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChannelCreateModal } from '../src/ui/ChannelCreateModal.jsx';

afterEach(cleanup);

const channel = { id: 'c0', name: 'c0', qualified_name: 'c0' };
const roster = [
	{ id: 'system', name: 'system', kind: 'system' },
	{ id: 'human:root:1', name: 'root', kind: 'human', principal: 'root' },
	{ id: 'agent:steward:2', name: 'steward', kind: 'agent', decl_id: 'mock:steward' },
];
const emptyState = () => ({ turns: new Map() });

function completedTurn(channelId = 'new-id') {
  return { terminal: { payload: { status: 'completed', value: { channel_id: channelId } } } };
}

describe('ChannelCreateModal', () => {
  it('作为独立对话框提交真实创建命令并首先聚焦名称', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue('request-1');
    render(<ChannelCreateModal channel={channel} channels={[]} roster={roster} selfId="human:root:1" state={emptyState()} onSubmit={onSubmit} onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('新频道名称'));
    await user.type(screen.getByLabelText('新频道名称'), 'research');
    await user.type(screen.getByLabelText('频道用途'), '分析资料');
    await user.click(screen.getByRole('button', { name: '创建频道' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'c0',
      msgType: 'system.channel.create',
      audience: ['system'],
			payload: { name: 'research', recipe: { declarations: [], profile: { description: '分析资料' } }, initial_actor_ids: ['human:root:1'] },
    }));
    expect(await screen.findByRole('region', { name: '频道创建进度' })).toBeTruthy();
  });

  it('可以把当前频道的 Agent 作为真实 Actor seat 一并带入', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue('request-1');
    render(<ChannelCreateModal channel={channel} channels={[]} roster={roster} selfId="human:root:1" state={emptyState()} onSubmit={onSubmit} onClose={() => {}} />);

    await user.type(screen.getByLabelText('新频道名称'), 'agent-room');
    await user.click(screen.getByRole('checkbox', { name: /steward/ }));
    await user.click(screen.getByRole('button', { name: '创建频道' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ initial_actor_ids: ['human:root:1', 'agent:steward:2'] }),
    }));
  });

  it('明确展示四步收敛，ready 后将新频道交给进入回调', async () => {
    const user = userEvent.setup();
    const onEnterChannel = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue('request-1');
    const { rerender } = render(<ChannelCreateModal channel={channel} channels={[]} roster={roster} selfId="human:root:1" state={emptyState()} onSubmit={onSubmit} onClose={() => {}} onEnterChannel={onEnterChannel} />);
    await user.type(screen.getByLabelText('新频道名称'), 'research');
    await user.click(screen.getByRole('button', { name: '创建频道' }));

    rerender(<ChannelCreateModal channel={channel} channels={[{ id: 'new-id', qualified_name: 'c0.research', open: false, access: 'member_active' }]} roster={roster} selfId="human:root:1" state={{ turns: new Map([['request-1', completedTurn()]]) }} onSubmit={onSubmit} onClose={() => {}} onEnterChannel={onEnterChannel} />);
    expect(screen.getByText('服务就绪').closest('div').className).toContain('waiting');
    expect(screen.getAllByText('已确认')).toHaveLength(3);

    const readyChannel = { id: 'new-id', qualified_name: 'c0.research', open: true, access: 'member_active' };
    rerender(<ChannelCreateModal channel={channel} channels={[readyChannel]} roster={roster} selfId="human:root:1" state={{ turns: new Map([['request-1', completedTurn()]]) }} onSubmit={onSubmit} onClose={() => {}} onEnterChannel={onEnterChannel} />);
    await user.click(screen.getByRole('button', { name: '进入新频道' }));
    expect(onEnterChannel).toHaveBeenCalledWith(readyChannel);
  });

  it('提交失败与账本失败都保留输入并允许重试', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce('request-2');
    const { rerender } = render(<ChannelCreateModal channel={channel} channels={[]} roster={roster} selfId="human:root:1" state={emptyState()} onSubmit={onSubmit} onClose={() => {}} />);
    await user.type(screen.getByLabelText('新频道名称'), 'backend');
    await user.type(screen.getByLabelText('频道用途'), '后端协作');
    await user.click(screen.getByRole('button', { name: '创建频道' }));
    expect((await screen.findByRole('alert')).textContent).toContain('网络不可用');
    expect(screen.getByLabelText('新频道名称').value).toBe('backend');

    await user.click(screen.getByRole('button', { name: '创建频道' }));
    rerender(<ChannelCreateModal channel={channel} channels={[]} roster={roster} selfId="human:root:1" state={{ turns: new Map([['request-2', { terminal: { payload: { status: 'failed', reason: '名称已存在' } } }]]) }} onSubmit={onSubmit} onClose={() => {}} />);
    expect(screen.getByText(/账本失败：名称已存在/)).toBeTruthy();
    expect(screen.getByLabelText('频道用途').value).toBe('后端协作');
    expect(screen.getByRole('button', { name: '重新创建' })).toBeTruthy();
  });

  it('支持 Escape、遮罩关闭、焦点闭环和关闭后的焦点归还', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const openerRef = createRef();
    const { rerender } = render(<><button ref={openerRef}>打开创建</button><ChannelCreateModal channel={channel} roster={roster} selfId="human:root:1" state={emptyState()} onSubmit={() => {}} onClose={onClose} returnFocusRef={openerRef} /></>);
    const close = screen.getByRole('button', { name: '关闭新建频道' });
    close.focus();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByLabelText('新频道名称'));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();

    await user.click(document.querySelector('.channel-create-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<button ref={openerRef}>打开创建</button>);
    expect(document.activeElement).toBe(openerRef.current);
  });
});
