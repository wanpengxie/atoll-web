// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksView } from '../src/ui/TasksView.jsx';
import { TaskCreateModal } from '../src/ui/TaskCreateModal.jsx';
import { WorkItemContext } from '../src/ui/context/WorkItemContext.jsx';

afterEach(cleanup);

it('没有 provider 时解释真实空态且不显示新建任务', () => {
  render(<TasksView items={[]} providers={[]} selfId="me" canWrite onNewTask={() => {}} onOpen={() => {}} onNewAutomation={() => {}} />);
  expect(screen.getByText('当前频道没有正式任务能力')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '新建任务' })).toBeNull();
  expect(screen.getByRole('button', { name: '安排自动动作' })).toBeTruthy();
});

it('按语义分组并打开工作项', async () => {
  const user = userEvent.setup(); const onOpen = vi.fn();
  const item = { key: 'approval:c1:a1', kind: 'approval', title: '发布生产', state: 'waiting', assigneeActorIds: ['me'], actionableBySelf: true, priority: 'high' };
  render(<TasksView items={[item]} roster={[{ id: 'me', name: '我' }]} providers={[]} selfId="me" canWrite onNewTask={() => {}} onOpen={onOpen} onNewAutomation={() => {}} />);
  expect(screen.getByText('需要你处理')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /发布生产/ }));
  expect(onOpen).toHaveBeenCalledWith(item);
});

it('任务 Modal 保留来源并只提交所选真实 provider', async () => {
  const user = userEvent.setup(); const onSubmit = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn();
  render(<TaskCreateModal providers={[{ actorId: 'agent', name: '研究员' }]} source={{ objectId: 'turn-1', seq: 8 }} onSubmit={onSubmit} onClose={onClose} />);
  expect(screen.getByText('动态 #8')).toBeTruthy();
  await user.type(screen.getByLabelText('任务内容'), '跟进结论');
  await user.click(screen.getByRole('button', { name: '创建任务' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: '跟进结论', providerId: 'agent', source: { objectId: 'turn-1', seq: 8 } }));
});

it('自动动作详情明确本设备范围并提供取消', async () => {
  const user = userEvent.setup(); const onCancel = vi.fn();
  render(<WorkItemContext item={{ key: 'automation:c1:t1', kind: 'automation', nativeId: 't1', title: '周报提醒', state: 'waiting', assigneeActorIds: [], requesterActorId: 'me', dueAt: 1000, actionableBySelf: true, provenance: 'local_durable', localScope: 'this_device', diagnostic: { msgType: 'human.text', payload: { text: '周报' } }, source: { view: 'tasks' } }} roster={[{ id: 'me', name: '我' }]} onCancelAutomation={onCancel} onSource={() => {}} onClose={() => {}} />);
  expect(screen.getByText('本设备记录')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '取消本设备自动动作' }));
  expect(onCancel).toHaveBeenCalledWith('t1');
});
