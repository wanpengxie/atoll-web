import React, { useMemo, useRef, useState } from 'react';
import { actorNameFromMap, actorNameMap } from '../../../model/actor-display.js';
import { FEATURE_COMMAND_STATE, FEATURE_TASK_ACTION, featureTaskGroup, featureWaitingActions, filterFeatureTasks } from '../../../model/feature-tasks.js';
import { PanelTabs } from '../../primitives/PanelTabs.jsx';
import { useModalFocus } from '../../primitives/useModalFocus.js';

const KIND_LABELS = { task: '任务', approval: '审批', agent_run: 'Agent 回合', recovery: '恢复事项', automation: '自动动作' };
const STATE_LABELS = { active: '进行中', running: '运行中', queued: '排队中', held: '已暂停', waiting: '等待中', blocked: '受阻', uncertain: '待确认', completed: '已完成', failed: '失败', cancelled: '已取消', expired: '已过期' };
const GROUP_LABELS = { needs_you: '需要你处理', active: '进行中', recovery: '恢复事项', automation: '自动动作 · 本设备', history: '历史' };
const ACTION_LABELS = {
  'agent.steer': '插入指令',
  'agent.interrupt': '停止',
  'agent.hold': '暂停',
  'agent.unhold': '继续',
  'agent.replace': '修改',
  'agent.dismiss': '取消',
  [FEATURE_TASK_ACTION.cancel]: '撤回请求',
};

function stateFor(port, item, action) {
  const facts = port.commandStates;
  const key = `${item.key}:${action}`;
  if (facts instanceof Map) return facts.get(key) || null;
  return facts?.[key] || null;
}

function TaskRow({ item, names, onOpen }) {
  const assigneeIds = item.assigneeActorIds || item.assignees || [];
  const assignees = assigneeIds.map((id) => actorNameFromMap(id, names)).join('、');
  return <button type="button" className={`work-item-row kind-${item.kind || 'task'} state-${item.state || 'active'}`} disabled={!onOpen} title={onOpen ? '' : '详情命令未接入'} onClick={() => onOpen(item)}>
    <span className="work-item-kind">{KIND_LABELS[item.kind] || item.kind || '任务'}</span>
    <span className="work-item-copy"><strong>{item.title || item.text || '未命名任务'}</strong><small>{assignees || item.ownerName || '未指定负责人'} · {STATE_LABELS[item.state] || item.state || '进行中'}</small>{item.waitingFor && <small>{item.waitingFor}</small>}</span>
    <span className="work-item-status">{item.localScope === 'this_device' && <em>本设备</em>}{STATE_LABELS[item.state] || item.state || '进行中'}<b aria-hidden="true">›</b></span>
  </button>;
}

function WaitingRow({ item, port }) {
  const actions = featureWaitingActions(item);
  const supportedControls = port.supportedWaitingControls instanceof Set
    ? port.supportedWaitingControls
    : new Set(port.supportedWaitingControls || []);
  const failures = actions.map((action) => stateFor(port, item, action)).filter((state) => state?.state === FEATURE_COMMAND_STATE.failed);
  return <article className={`work-item-row kind-agent_run state-${item.state || 'queued'}`}>
    <span className="work-item-kind">等待</span>
    <span className="work-item-copy"><strong>{item.title || item.text || item.request?.payload?.text || '排队指令'}</strong><small>{item.actorName || item.actorId || item.target || 'Agent'} · {STATE_LABELS[item.state] || item.state || '排队中'}</small></span>
    <span className="work-item-actions">{actions.map((action) => {
      const commandState = stateFor(port, item, action);
      const callerCancel = action === FEATURE_TASK_ACTION.cancel;
      const execute = callerCancel ? port.commands?.cancelRequest : port.commands?.controlWaiting;
      const supported = callerCancel || supportedControls.has(action);
      const disabled = typeof execute !== 'function'
        || !supported
        || [FEATURE_COMMAND_STATE.submitting, FEATURE_COMMAND_STATE.disabled, FEATURE_COMMAND_STATE.unsupported].includes(commandState?.state);
      return <button type="button" className={action === 'agent.interrupt' || action === 'agent.dismiss' || callerCancel ? 'danger' : ''} disabled={disabled} title={commandState?.reason || (!execute ? '等待区控制命令未接入' : !supported ? '此控制词没有已接入的安全命令' : '')} key={action} onClick={() => callerCancel ? execute({ item }) : execute({ item, type: action })}>{ACTION_LABELS[action] || action}</button>;
    })}{!actions.length && <span className="task-provider-note">当前账本未声明可用控制</span>}{failures.map((failure, index) => <span className="governance-error" role="alert" key={`error:${index}`}>{failure.error || failure.reason || '控制命令失败'}</span>)}</span>
  </article>;
}

function TaskCreationDialog({ port, onClose }) {
  const providers = port.creation.providers || [];
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [providerId, setProviderId] = useState(providers[0]?.actorId || '');
  const [dueAt, setDueAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  useModalFocus({ dialogRef, initialFocusRef: titleRef, onClose, closeDisabled: submitting });
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await port.commands.createTask({
        title: title.trim(),
        description: description.trim(),
        providerId,
        dueAt: dueAt ? new Date(dueAt).toISOString() : '',
        source: null,
      });
      onClose();
    } catch (failure) {
      setError(failure?.message || String(failure));
      setSubmitting(false);
    }
  };
  return <div className="modal-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="task-create-modal" role="dialog" aria-modal="true" aria-labelledby="feature-task-create-title">
      <header><div><p className="eyebrow">NEW TASK</p><h2 id="feature-task-create-title">新建任务</h2></div><button type="button" disabled={submitting} onClick={onClose} aria-label="关闭新建任务">×</button></header>
      <form onSubmit={submit}>
        <label><span>任务内容</span><textarea ref={titleRef} rows="4" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        <label><span>补充说明（可选）</span><textarea rows="3" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label><span>执行者</span><select value={providerId} onChange={(event) => setProviderId(event.target.value)} required>{providers.map((provider) => <option value={provider.actorId} key={provider.actorId}>{provider.name}</option>)}</select></label>
        <label><span>截止时间（可选）</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        {error && <p className="task-create-error" role="alert">{error}</p>}
        <footer><button type="button" disabled={submitting} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={submitting || !title.trim() || !providerId}>{submitting ? '正在提交…' : '创建任务'}</button></footer>
      </form>
    </section>
  </div>;
}

export function TasksFeature({ port = {} }) {
  const [tab, setTab] = useState('tasks');
  const [scope, setScope] = useState('me');
  const [status, setStatus] = useState('active');
  const [kind, setKind] = useState('all');
  const [creating, setCreating] = useState(false);
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
  const waitingState = port.waitingState || FEATURE_COMMAND_STATE.unsupported;
  const creation = port.creation || { state: FEATURE_COMMAND_STATE.unsupported, providers: [], reason: '当前 Workspace 未提供 task.create 命令端口' };
  const automation = port.automation || { state: FEATURE_COMMAND_STATE.unsupported, reason: '当前版本没有可靠的自动动作协议' };
  const createReady = creation.state === FEATURE_COMMAND_STATE.ready
    && creation.providers?.length > 0
    && typeof commands.createTask === 'function';
  const automationReady = automation.state === FEATURE_COMMAND_STATE.ready
    && typeof commands.createAutomation === 'function';
  return <section id="workspace-panel-tasks" className="workspace-view tasks-view" role="region" aria-label="任务与等待区">
    <header className="workspace-view-header tasks-header"><div><p className="eyebrow">WORK ITEMS</p><h2>任务与等待区</h2><p>共享工作项来自频道事实；控制动作通过 Workspace 命令端口提交。</p>{[FEATURE_COMMAND_STATE.unsupported, FEATURE_COMMAND_STATE.failed].includes(creation.state) && <p className="task-provider-note" role={creation.state === FEATURE_COMMAND_STATE.failed ? 'alert' : 'status'}>正式任务：{creation.reason || creation.error || '当前 Workspace 未接入 task.create'}</p>}{[FEATURE_COMMAND_STATE.unsupported, FEATURE_COMMAND_STATE.failed].includes(automation.state) && <p className="task-provider-note" role={automation.state === FEATURE_COMMAND_STATE.failed ? 'alert' : 'status'}>自动动作：{automation.reason || automation.error || '当前版本没有可靠协议'}</p>}</div><div className="tasks-header-actions"><button type="button" disabled={!automationReady} title={automation.reason || (automationReady ? '' : '自动动作命令不可用')} onClick={() => commands.createAutomation()}>安排自动动作</button><button type="button" className="primary-button" disabled={!createReady} title={creation.reason || (createReady ? '' : '正式任务命令不可用')} onClick={() => setCreating(true)}>新建任务</button></div></header>
    <PanelTabs label="任务区域" tabs={[{ id: 'tasks', label: `任务 ${port.items?.length || 0}` }, { id: 'waiting', label: `等待区 ${waiting.length}` }]} activeTab={tab} onChange={setTab} />
    <div style={{ display: 'grid', minHeight: 0, gridTemplateRows: tab === 'tasks' ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
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
      {waitingState === FEATURE_COMMAND_STATE.unsupported && <p className="task-provider-note">{port.waitingReason || '当前 Workspace 未提供等待区投影。'}</p>}
      {waiting.map((item) => <WaitingRow item={item} port={port} key={item.key || item.id || item.requestId} />)}
      {!waiting.length && waitingState !== FEATURE_COMMAND_STATE.unsupported && <div className="tasks-empty"><strong>等待区为空</strong><p>排队或暂停的 Agent 指令会显示在这里。</p></div>}
    </div>}
    </div>
    {creating && <TaskCreationDialog port={{ ...port, creation }} onClose={() => setCreating(false)} />}
  </section>;
}
