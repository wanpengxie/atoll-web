import React from 'react';
import { FEATURE_COMMAND_STATE, FEATURE_TASK_ACTION } from '../../../model/feature-tasks.js';
import { SidePanel } from '../../primitives/SidePanel.jsx';

const LABELS = Object.freeze({
  [FEATURE_TASK_ACTION.approve]: '批准',
  [FEATURE_TASK_ACTION.reject]: '拒绝',
  [FEATURE_TASK_ACTION.retry]: '使用原编号重试',
  [FEATURE_TASK_ACTION.cancel]: '取消请求',
});

function stateFor(port, item, action) {
  const key = `${item.key}:${action}`;
  if (port.commandStates instanceof Map) return port.commandStates.get(key) || null;
  return port.commandStates?.[key] || null;
}

function commandFor(commands, action) {
  if (action === FEATURE_TASK_ACTION.approve && typeof commands.resolveApproval === 'function') {
    return (item) => commands.resolveApproval({ item, decision: 'approve' });
  }
  if (action === FEATURE_TASK_ACTION.reject && typeof commands.resolveApproval === 'function') {
    return (item) => commands.resolveApproval({ item, decision: 'reject' });
  }
  if (action === FEATURE_TASK_ACTION.retry && typeof commands.retryRecovery === 'function') {
    return (item) => commands.retryRecovery({ item, submission: item.submission });
  }
  if (action === FEATURE_TASK_ACTION.cancel && typeof commands.cancelRequest === 'function') {
    return (item) => commands.cancelRequest({ item });
  }
  return null;
}

export function TaskDetailPanel({ port = {}, onClose }) {
  const item = port.selectedItem;
  if (!item) return null;
  const commands = port.commands || {};
  return <SidePanel ariaLabel="任务详情" eyebrow="WORK ITEM" title={item.title || '任务详情'} onClose={onClose}>
    <div className={`work-item-context-state state-${item.state || 'active'}`}><span>{item.kind || 'task'}</span><strong>{item.state || 'active'}</strong></div>
    <dl className="work-item-metadata"><dt>负责人</dt><dd>{item.ownerName || item.ownerId || (item.assigneeActorIds || []).join('、') || '未指定'}</dd><dt>来源频道</dt><dd>{item.channelName || item.channelId || '当前频道'}</dd><dt>创建时间</dt><dd>{item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '未知'}</dd></dl>
    {item.description && <section className="work-item-detail"><h3>说明</h3><p>{item.description}</p></section>}
    {item.waitingFor && <section className="work-item-detail"><h3>正在等待</h3><p>{item.waitingFor}</p></section>}
    <section className="work-item-detail"><h3>操作</h3><div className="work-item-actions">{(item.actions || []).map((action) => {
      const command = commandFor(commands, action);
      const commandState = stateFor(port, item, action);
      const disabled = !command
        || [FEATURE_COMMAND_STATE.submitting, FEATURE_COMMAND_STATE.disabled, FEATURE_COMMAND_STATE.unsupported].includes(commandState?.state);
      return <button type="button" className={action === FEATURE_TASK_ACTION.reject || action === FEATURE_TASK_ACTION.cancel ? 'danger' : action === FEATURE_TASK_ACTION.approve ? 'approve' : ''} disabled={disabled} title={commandState?.reason || (command ? '' : '该命令未接入')} key={action} onClick={() => command(item)}>{LABELS[action] || action}</button>;
    })}{!(item.actions || []).length && <p>当前事实没有声明可用操作。</p>}</div>{(item.actions || []).map((action) => { const commandState = stateFor(port, item, action); return commandState?.state === FEATURE_COMMAND_STATE.failed ? <p className="governance-error" role="alert" key={`${action}:error`}>{commandState.error || commandState.reason || '操作失败'}</p> : null; })}</section>
  </SidePanel>;
}
