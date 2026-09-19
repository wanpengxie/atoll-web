import React from 'react';
import { actorNameFromMap, actorNameMap } from '../../../model/actor-display.js';
import { FEATURE_COMMAND_STATE, FEATURE_TASK_ACTION } from '../../../model/feature-tasks.js';
import { SidePanel } from '../../primitives/SidePanel.jsx';

const KIND_LABELS = Object.freeze({ task: '任务', approval: '审批', agent_run: 'Agent 回合', recovery: '恢复事项', automation: '自动动作' });
const STATE_LABELS = Object.freeze({ active: '进行中', running: '运行中', queued: '排队中', held: '已暂停', waiting: '等待中', blocked: '受阻', uncertain: '待确认', completed: '已完成', failed: '失败', cancelled: '已取消', expired: '已过期' });
const ACTION_LABELS = Object.freeze({
  [FEATURE_TASK_ACTION.approve]: '批准',
  [FEATURE_TASK_ACTION.reject]: '拒绝',
  [FEATURE_TASK_ACTION.retry]: '使用原编号重试',
  [FEATURE_TASK_ACTION.cancel]: '取消请求',
  [FEATURE_TASK_ACTION.cancelAutomation]: '取消本设备自动动作',
});

function date(value) {
  return value ? new Date(value).toLocaleString('zh-CN') : '未设置';
}

function stateFor(port, item, action) {
  const key = `${item.key}:${action}`;
  if (port.commandStates instanceof Map) return port.commandStates.get(key) || null;
  return port.commandStates?.[key] || null;
}

function commandFor(commands, item, action) {
  if (action === FEATURE_TASK_ACTION.approve && typeof commands.resolveApproval === 'function') {
    return () => commands.resolveApproval({ item, decision: 'approve' });
  }
  if (action === FEATURE_TASK_ACTION.reject && typeof commands.resolveApproval === 'function') {
    return () => commands.resolveApproval({ item, decision: 'reject' });
  }
  if (action === FEATURE_TASK_ACTION.retry && typeof commands.retryRecovery === 'function') {
    return () => commands.retryRecovery({ item, submission: item.submission });
  }
  if (action === FEATURE_TASK_ACTION.cancelAutomation && typeof commands.cancelAutomation === 'function') {
    return () => commands.cancelAutomation({ item, timerId: item.nativeId || item.id });
  }
  if (action === FEATURE_TASK_ACTION.cancel && typeof commands.cancelRequest === 'function') {
    return () => commands.cancelRequest({ item });
  }
  if (typeof commands.executeTaskAction === 'function') return () => commands.executeTaskAction({ item, action });
  return null;
}

function ActionButtons({ item, port }) {
  const commands = port.commands || {};
  const actions = item.actions || [];
  if (!actions.length) return <p>当前事实没有声明可用操作。</p>;
  return <><div className="work-item-actions">{actions.map((action) => {
    const command = commandFor(commands, item, action);
    const commandState = stateFor(port, item, action);
    const disabled = !command
      || [FEATURE_COMMAND_STATE.submitting, FEATURE_COMMAND_STATE.disabled, FEATURE_COMMAND_STATE.unsupported].includes(commandState?.state);
    return <button type="button" className={action === FEATURE_TASK_ACTION.reject || action === FEATURE_TASK_ACTION.cancel || action === FEATURE_TASK_ACTION.cancelAutomation ? 'danger' : action === FEATURE_TASK_ACTION.approve ? 'approve' : ''} disabled={disabled} title={commandState?.reason || (command ? '' : '该动作的命令端口尚未接入')} key={action} onClick={command || undefined}>{commandState?.state === FEATURE_COMMAND_STATE.submitting ? '正在提交…' : ACTION_LABELS[action] || action}</button>;
  })}</div>{actions.map((action) => {
    const commandState = stateFor(port, item, action);
    return commandState?.state === FEATURE_COMMAND_STATE.failed
      ? <p className="governance-error" role="alert" key={`${action}:error`}>{commandState.error || commandState.reason || '操作失败'}</p>
      : null;
  })}</>;
}

export function TaskDetailPanel({ port = {}, onClose }) {
  const item = port.selectedItem;
  if (!item) return null;
  const commands = port.commands || {};
  const names = actorNameMap(port.roster || []);
  const assignees = (item.assigneeActorIds || item.assignees || [])
    .map((id) => actorNameFromMap(id, names))
    .join('、') || '未指定';
  const sourceCommand = typeof commands.openSource === 'function'
    ? () => commands.openSource({ item, source: item.source })
    : null;
  const openTurn = typeof commands.openTurn === 'function'
    ? () => commands.openTurn({ item, requestId: item.requestId || item.nativeId || item.id })
    : null;
  return <SidePanel className={`work-item-context kind-${item.kind || 'task'}`} ariaLabel="工作项详情" eyebrow={KIND_LABELS[item.kind] || 'WORK ITEM'} title={item.title || '任务详情'} closeLabel="关闭工作项详情" onClose={onClose}>
    {item.localScope === 'this_device' && <section className="local-fact"><strong>本设备记录</strong><p>这个对象来自当前浏览器保存的记录，不代表频道共享或跨设备的完整事实。</p></section>}
    <section className={`work-item-context-state state-${item.state || 'active'}`}><span>{STATE_LABELS[item.state] || item.state || '进行中'}</span>{(item.actionableBySelf || item.needsYou) && <strong>需要你处理</strong>}</section>
    <dl className="work-item-metadata">
      <dt>类型</dt><dd>{KIND_LABELS[item.kind] || item.kind || '任务'}</dd>
      <dt>负责人</dt><dd>{assignees}</dd>
      <dt>创建者</dt><dd>{actorNameFromMap(item.requesterActorId || item.ownerId, names, '未知')}</dd>
      <dt>{item.kind === 'approval' ? '到期' : '截止/触发'}</dt><dd>{date(item.dueAt)}</dd>
      <dt>事实来源</dt><dd>{item.provenance === 'ledger' ? '频道账本' : item.provenance === 'local_durable' ? '本设备持久记录' : item.channelName || item.channelId || '当前频道'}</dd>
    </dl>
    {item.description && <section className="work-item-detail"><h3>说明</h3><p>{item.description}</p></section>}
    {item.waitingFor && <section className="work-item-detail"><h3>当前等待</h3><p>{item.waitingFor}</p></section>}
    {item.kind === 'approval' && <section className="work-item-detail"><h3>影响</h3><p>{item.diagnostic?.impact || '来源请求未提供影响说明。'}</p></section>}
    {item.kind === 'agent_run' && <section className="work-item-detail"><h3>运行状态</h3><p>{item.waitingFor || '等待进一步的账本状态。'}</p><button type="button" disabled={!openTurn} title={openTurn ? '' : '完整回合定位端口尚未接入'} onClick={openTurn || undefined}>打开完整回合与控制</button></section>}
    {item.kind === 'recovery' && <section className="work-item-detail"><h3>已经确认</h3><p>{item.state === 'uncertain' ? '发送结果尚未由频道账本确认。使用原编号重试不会产生新的业务编号。' : '上一次提交明确失败，可以检查原因后安全重试。'}</p></section>}
    {item.kind === 'automation' && <section className="work-item-detail"><h3>自动动作</h3><p>消息类型：{item.diagnostic?.msgType || '未知'}</p><pre>{JSON.stringify(item.diagnostic?.payload ?? {}, null, 2)}</pre></section>}
    {item.kind === 'task' && <section className="work-item-detail"><h3>正式任务</h3><p>编号：{item.nativeId || item.id}</p><p>该任务由 {actorNameFromMap(item.diagnostic?.providerActorId, names, '能力提供者')} 返回稳定任务编号；更新动作只会在 provider 声明对应能力时出现。</p></section>}
    <section className="work-item-detail"><h3>操作</h3><ActionButtons item={item} port={port} /></section>
    <div className="work-item-source-actions"><button type="button" disabled={!sourceCommand} title={sourceCommand ? '' : '来源定位端口尚未接入'} onClick={sourceCommand || undefined}>返回来源</button></div>
    <details className="work-item-diagnostics"><summary>诊断信息</summary><pre>{JSON.stringify(item.diagnostic || {}, null, 2)}</pre></details>
  </SidePanel>;
}
