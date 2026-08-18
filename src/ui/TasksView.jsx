import React, { useEffect, useMemo, useState } from 'react';
import { filterWorkItems, workItemGroup } from '../model/work-items.js';
import { boundedPage } from '../model/list-window.js';

const KIND_LABELS = { task: '任务', approval: '审批', agent_run: 'Agent 回合', recovery: '恢复事项', automation: '自动动作' };
const STATE_LABELS = { active: '进行中', waiting: '等待中', blocked: '受阻', uncertain: '待确认', completed: '已完成', failed: '失败', cancelled: '已取消', expired: '已过期' };
const GROUP_LABELS = { needs_you: '需要你处理', active: '进行中', recovery: '恢复事项', automation: '自动动作 · 本设备', history: '历史' };

function WorkItemRow({ item, names, onOpen }) {
  const assignees = item.assigneeActorIds.map((id) => names.get(id) || id).join('、');
  return <button type="button" className={`work-item-row kind-${item.kind} state-${item.state}`} onClick={() => onOpen(item)}>
    <span className="work-item-kind">{KIND_LABELS[item.kind]}</span>
    <span className="work-item-copy"><strong>{item.title}</strong><small>{assignees || (item.kind === 'automation' ? '本设备' : '未指定负责人')} · {STATE_LABELS[item.state] || item.state}</small>{item.waitingFor && <small>{item.waitingFor}</small>}</span>
    <span className="work-item-status">{item.localScope === 'this_device' && <em>本设备</em>}{STATE_LABELS[item.state] || item.state}<b aria-hidden="true">›</b></span>
  </button>;
}

export function TasksView({ items, roster = [], selfId = '', providers = [], canWrite = false, onNewTask, onOpen, onNewAutomation }) {
  const [scope, setScope] = useState('me');
  const [status, setStatus] = useState('active');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(0);
  const names = useMemo(() => new Map(roster.map((row) => [row.id, row.name || row.id])), [roster]);
  const visible = filterWorkItems(items, { scope, status, kind, selfId });
  const windowed = boundedPage(visible, page);
  useEffect(() => {
    if (windowed.page !== page) setPage(windowed.page);
  }, [page, windowed.page]);
  const groups = new Map();
  for (const item of windowed.items) {
    const group = workItemGroup(item);
    groups.set(group, [...(groups.get(group) || []), item]);
  }
  const noProvider = providers.length === 0;
  return <section id="workspace-panel-tasks" className="workspace-view tasks-view" role="tabpanel" aria-labelledby="workspace-tab-tasks">
    <header className="workspace-view-header tasks-header"><div><p className="eyebrow">WORK ITEMS</p><h2>任务</h2><p>审批、运行中回合、恢复事项和自动动作在这里按真实来源汇总。</p></div><div className="tasks-header-actions"><button type="button" onClick={onNewAutomation}>安排自动动作</button>{!noProvider && <button type="button" className="primary-button" disabled={!canWrite} onClick={() => onNewTask(null)}>新建任务</button>}</div></header>
    <div className="task-filters" aria-label="任务筛选">
      <div className="task-scope" role="group" aria-label="责任范围"><button type="button" className={scope === 'me' ? 'active' : ''} onClick={() => { setScope('me'); setPage(0); }}>与我相关</button><button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => { setScope('all'); setPage(0); }}>全部</button></div>
      <select aria-label="任务状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="active">待处理</option><option value="completed">已完成</option><option value="failed">失败</option></select>
      <select aria-label="任务类型" value={kind} onChange={(event) => { setKind(event.target.value); setPage(0); }}><option value="all">全部类型</option><option value="task">任务</option><option value="approval">审批</option><option value="agent_run">Agent 回合</option><option value="recovery">恢复事项</option><option value="automation">自动动作</option></select>
    </div>
    <div className="workspace-view-scroll task-collection">
      {windowed.hasOlder && <button type="button" className="bounded-list-control" onClick={() => setPage((value) => value + 1)}>查看更早任务</button>}
      {visible.length > 0 ? ['needs_you', 'active', 'recovery', 'automation', 'history'].map((group) => groups.has(group) && <section className="work-item-group" key={group}><h3>{GROUP_LABELS[group]} <span>{groups.get(group).length}</span></h3>{groups.get(group).map((item) => <WorkItemRow key={item.key} item={item} names={names} onOpen={onOpen} />)}</section>) : <div className="tasks-empty"><strong>{kind !== 'all' || status !== 'active' || scope !== 'me' ? '没有符合当前筛选的项目' : noProvider ? '当前频道没有正式任务能力' : '还没有任务'}</strong><p>{noProvider ? '不会在浏览器本地伪造共享任务；审批、运行中回合、恢复事项和本设备自动动作出现后仍会汇总到这里。' : '可以新建任务，或从动态中的消息和终态创建。'}</p>{!noProvider && canWrite && <button type="button" onClick={() => onNewTask(null)}>新建任务</button>}</div>}
      {windowed.hasNewer && <button type="button" className="bounded-list-control" onClick={() => setPage((value) => Math.max(0, value - 1))}>查看更新任务</button>}
      {noProvider && visible.length > 0 && <p className="task-provider-note">当前频道没有声明 task.create 的成员，因此不提供新建任务入口；已有工作项仍来自频道账本或本设备明确记录。</p>}
    </div>
  </section>;
}
