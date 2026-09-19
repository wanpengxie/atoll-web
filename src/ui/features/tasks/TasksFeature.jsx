import React, { useMemo, useState } from 'react';
import { actorNameFromMap, actorNameMap } from '../../../model/actor-display.js';
import { featureTaskGroup, featureWaitingActions, filterFeatureTasks } from '../../../model/feature-tasks.js';
import { PanelTabs } from '../../primitives/PanelTabs.jsx';

const KIND_LABELS = { task: '任务', approval: '审批', agent_run: 'Agent 回合', recovery: '恢复事项', automation: '自动动作' };
const STATE_LABELS = { active: '进行中', running: '运行中', queued: '排队中', held: '已暂停', waiting: '等待中', blocked: '受阻', uncertain: '待确认', completed: '已完成', failed: '失败', cancelled: '已取消', expired: '已过期' };
const GROUP_LABELS = { needs_you: '需要你处理', active: '进行中', recovery: '恢复事项', automation: '自动动作 · 本设备', history: '历史' };
const ACTION_LABELS = { steer: '插入指令', interrupt: '停止', hold: '暂停', unhold: '继续', replace: '修改', remove: '移出等待区', retry: '重试' };

function TaskRow({ item, names, onOpen }) {
  const assigneeIds = item.assigneeActorIds || item.assignees || [];
  const assignees = assigneeIds.map((id) => actorNameFromMap(id, names)).join('、');
  return <button type="button" className={`work-item-row kind-${item.kind || 'task'} state-${item.state || 'active'}`} onClick={() => onOpen?.(item)}>
    <span className="work-item-kind">{KIND_LABELS[item.kind] || item.kind || '任务'}</span>
    <span className="work-item-copy"><strong>{item.title || item.text || '未命名任务'}</strong><small>{assignees || item.ownerName || '未指定负责人'} · {STATE_LABELS[item.state] || item.state || '进行中'}</small>{item.waitingFor && <small>{item.waitingFor}</small>}</span>
    <span className="work-item-status">{item.localScope === 'this_device' && <em>本设备</em>}{STATE_LABELS[item.state] || item.state || '进行中'}<b aria-hidden="true">›</b></span>
  </button>;
}

function WaitingRow({ item, commands }) {
  const actions = featureWaitingActions(item);
  return <article className={`work-item-row kind-agent_run state-${item.state || 'queued'}`}>
    <span className="work-item-kind">等待</span>
    <span className="work-item-copy"><strong>{item.title || item.text || item.request?.payload?.text || '排队指令'}</strong><small>{item.actorName || item.actorId || item.target || 'Agent'} · {STATE_LABELS[item.state] || item.state || '排队中'}</small></span>
    <span className="work-item-actions">{actions.map((action) => <button type="button" className={action === 'interrupt' || action === 'remove' ? 'danger' : ''} disabled={item.busy || item.disabled} key={action} onClick={() => commands.control?.({ action, itemId: item.id || item.requestId || item.key, item })}>{ACTION_LABELS[action] || action}</button>)}</span>
  </article>;
}

export function TasksFeature({ port = {} }) {
  const [tab, setTab] = useState('tasks');
  const [scope, setScope] = useState('me');
  const [status, setStatus] = useState('active');
  const [kind, setKind] = useState('all');
  const commands = port.commands || {};
  const names = useMemo(() => actorNameMap(port.roster || []), [port.roster]);
  const visible = useMemo(() => filterFeatureTasks(port.items || [], { scope, status, kind, selfId: port.selfId || '' }), [kind, port.items, port.selfId, scope, status]);
  const groups = useMemo(() => {
    const grouped = new Map();
    for (const item of visible) {
      const group = featureTaskGroup(item);
      grouped.set(group, [...(grouped.get(group) || []), item]);
    }
    return grouped;
  }, [visible]);
  const waiting = port.waiting || [];
  return <section id="workspace-panel-tasks" className="workspace-view tasks-view" role="region" aria-label="任务与等待区">
    <header className="workspace-view-header tasks-header"><div><p className="eyebrow">WORK ITEMS</p><h2>任务与等待区</h2><p>共享工作项来自频道事实；控制动作通过 Workspace 命令端口提交。</p></div><div className="tasks-header-actions"><button type="button" onClick={() => commands.createAutomation?.()}>安排自动动作</button><button type="button" className="primary-button" disabled={!port.canWrite || port.providers?.length === 0} onClick={() => commands.create?.(null)}>新建任务</button></div></header>
    <PanelTabs label="任务区域" tabs={[{ id: 'tasks', label: `任务 ${port.items?.length || 0}` }, { id: 'waiting', label: `等待区 ${waiting.length}` }]} activeTab={tab} onChange={setTab} />
    {tab === 'tasks' && <>
      <div className="task-filters" aria-label="任务筛选">
        <div className="task-scope" role="group" aria-label="责任范围"><button type="button" className={scope === 'me' ? 'active' : ''} onClick={() => setScope('me')}>与我相关</button><button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全部</button></div>
        <select aria-label="任务状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">待处理</option><option value="completed">已完成</option><option value="failed">失败或取消</option></select>
        <select aria-label="任务类型" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">全部类型</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      </div>
      <div className="workspace-view-scroll task-collection">
        {['needs_you', 'active', 'recovery', 'automation', 'history'].map((group) => groups.has(group) && <section className="work-item-group" key={group}><h3>{GROUP_LABELS[group]} <span>{groups.get(group).length}</span></h3>{groups.get(group).map((item) => <TaskRow item={item} names={names} onOpen={commands.open} key={item.key || item.id} />)}</section>)}
        {!visible.length && <div className="tasks-empty"><strong>没有符合当前筛选的项目</strong><p>任务列表只呈现上层 owner 提供的频道事实，不会在浏览器里伪造共享任务。</p></div>}
      </div>
    </>}
    {tab === 'waiting' && <div className="workspace-view-scroll task-collection">
      {waiting.map((item) => <WaitingRow item={item} commands={commands} key={item.key || item.id || item.requestId} />)}
      {!waiting.length && <div className="tasks-empty"><strong>等待区为空</strong><p>排队或暂停的 Agent 指令会显示在这里。</p></div>}
    </div>}
  </section>;
}
