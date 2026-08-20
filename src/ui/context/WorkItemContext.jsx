import React from 'react';
import { actorNameFromMap, actorNameMap } from '../../model/actor-display.js';
import { SidePanel } from '../primitives/SidePanel.jsx';

const KIND_LABELS = { task: '任务', approval: '审批', agent_run: 'Agent 回合', recovery: '恢复事项', automation: '自动动作' };
const STATE_LABELS = { active: '进行中', waiting: '等待中', blocked: '受阻', uncertain: '待确认', completed: '已完成', failed: '失败', cancelled: '已取消', expired: '已过期' };

function date(value) { return value ? new Date(value).toLocaleString('zh-CN') : '未设置'; }

export function WorkItemContext({ item, roster = [], onSource, onResolve, onOpenTurn, onRetry, onCancelAutomation, onClose }) {
  if (!item) return null;
  const names = actorNameMap(roster);
  const assignees = item.assigneeActorIds.map((id) => actorNameFromMap(id, names)).join('、') || '未指定';
  return <SidePanel className={`work-item-context kind-${item.kind}`} ariaLabel="工作项详情" eyebrow={KIND_LABELS[item.kind]} title={item.title} closeLabel="关闭工作项详情" onClose={onClose}>
    {item.localScope === 'this_device' && <section className="local-fact"><strong>本设备记录</strong><p>这个对象来自当前浏览器保存的记录，不代表频道共享或跨设备的完整事实。</p></section>}
    <section className={`work-item-context-state state-${item.state}`}><span>{STATE_LABELS[item.state] || item.state}</span>{item.actionableBySelf && <strong>需要你处理</strong>}</section>
    <dl className="work-item-metadata"><dt>类型</dt><dd>{KIND_LABELS[item.kind]}</dd><dt>负责人</dt><dd>{assignees}</dd><dt>创建者</dt><dd>{actorNameFromMap(item.requesterActorId, names, '未知')}</dd><dt>{item.kind === 'approval' ? '到期' : '截止/触发'}</dt><dd>{date(item.dueAt)}</dd><dt>事实来源</dt><dd>{item.provenance === 'ledger' ? '频道账本' : '本设备持久记录'}</dd></dl>
    {item.waitingFor && <section className="work-item-detail"><h3>当前等待</h3><p>{item.waitingFor}</p></section>}
    {item.kind === 'approval' && <section className="work-item-detail"><h3>影响</h3><p>{item.diagnostic?.impact || '来源请求未提供影响说明。'}</p>{item.actionableBySelf && <div className="work-item-actions"><button type="button" className="approve" onClick={() => onResolve(item, 'approved')}>批准</button><button type="button" className="danger" onClick={() => onResolve(item, 'rejected')}>拒绝</button></div>}</section>}
    {item.kind === 'agent_run' && <section className="work-item-detail"><h3>运行状态</h3><p>{item.waitingFor || '等待进一步的账本状态。'}</p><button type="button" onClick={() => onOpenTurn(item.nativeId)}>打开完整回合与控制</button></section>}
    {item.kind === 'recovery' && <section className="work-item-detail"><h3>已经确认</h3><p>{item.state === 'uncertain' ? '发送结果尚未由频道账本确认。使用原编号重试不会产生新的业务编号。' : '上一次提交明确失败，可以检查原因后安全重试。'}</p>{item.actionableBySelf && <button type="button" onClick={() => onRetry(item)}>使用原编号重试</button>}</section>}
    {item.kind === 'automation' && <section className="work-item-detail"><h3>自动动作</h3><p>消息类型：{item.diagnostic?.msgType || '未知'}</p><pre>{JSON.stringify(item.diagnostic?.payload ?? {}, null, 2)}</pre>{item.actionableBySelf && <button type="button" className="danger" onClick={() => onCancelAutomation(item.nativeId)}>取消本设备自动动作</button>}</section>}
    {item.kind === 'task' && <section className="work-item-detail"><h3>正式任务</h3><p>编号：{item.nativeId}</p><p>该任务由 {actorNameFromMap(item.diagnostic?.providerActorId, names, '能力提供者')} 返回稳定任务编号；更新动作只会在 provider 声明对应能力时出现。</p></section>}
    <div className="work-item-source-actions"><button type="button" onClick={() => onSource(item.source)}>返回来源</button></div>
    <details className="work-item-diagnostics"><summary>诊断信息</summary><pre>{JSON.stringify(item.diagnostic || {}, null, 2)}</pre></details>
  </SidePanel>;
}
