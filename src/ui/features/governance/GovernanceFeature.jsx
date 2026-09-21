import React, { useEffect, useRef, useState } from 'react';
import { actorDisplayName } from '../../../model/actor-display.js';
import { isManageableDeclaration, isVisibleActor } from '../../../model/actor-visibility.js';
import { TERMINAL_RESULT_UNAVAILABLE } from '../../../model/terminal-result.js';
import { InlineConfirmation } from '../../primitives/InlineConfirmation.jsx';
import { PanelCard } from '../../primitives/PanelCard.jsx';
import { SelectMenu } from '../../primitives/SelectMenu.jsx';
import { SidePanel } from '../../primitives/SidePanel.jsx';
import { useModalFocus } from '../../primitives/useModalFocus.js';

function errorMessage(error) {
  return error?.message || String(error);
}

function useCommand(commands, scope) {
  const [error, setError] = useState('');
  const [operation, setOperation] = useState(null);
  const submit = async (action, payload = {}, options = {}) => {
    setError('');
    setOperation({ state: 'pending', message: options.pending || '正在提交命令…' });
    try {
      if (typeof commands?.submit !== 'function') throw new TypeError(`${scope} 治理命令不可用`);
      const result = await commands.submit({ scope, action, payload });
      let message = options.submitted || '命令已进入提交队列；最终状态以账本与目录投影为准。';
      let state = 'submitted';
      if (options.refresh) {
        try {
          if (typeof commands?.refresh !== 'function') throw new TypeError('目录刷新命令不可用');
          await commands.refresh(options.refresh);
        } catch (refreshFailure) {
          state = 'partial';
          message = `${message} 目录刷新失败：${errorMessage(refreshFailure)}`;
        }
      }
      setOperation({ state, message });
      return result;
    }
    catch (failure) {
      const message = errorMessage(failure);
      setError(message);
      setOperation({ state: 'failed', message });
      return undefined;
    }
  };
  return { busy: operation?.state === 'pending', error, operation, submit };
}

const TERMINAL_OPERATION_STATES = new Set(['submitted', 'completed', 'uncertain']);

function terminalResultPhase(operation, terminal) {
  if (!terminal || !operation) return '';
  if (operation.resultPhase === 'unavailable' || operation.resultUnavailable === true) return 'unavailable';
  if (operation.resultPhase === 'available') return 'available';
  // A terminal projection without a result phase is the compact receipt shape:
  // its ledger state is observable, but no business-result body is available.
  // Keep this classification at the public terminal boundary; local command
  // operations do not use this path and remain ordinary submitted/failed UI.
  const hasResultBody = operation.result != null || operation.resultBody != null;
  if (TERMINAL_OPERATION_STATES.has(operation.state) && !hasResultBody) return 'unavailable';
  return '';
}

function OperationState({ operation, terminal = false, onRefresh, onReenter }) {
  if (!operation) return null;
  const resultPhase = terminalResultPhase(operation, terminal);
  const unavailable = resultPhase === 'unavailable';
  const state = unavailable ? 'unavailable' : operation.state || 'pending';
  return <>
    <p className={`operation-state state-${state}`} role="status">
      {unavailable ? TERMINAL_RESULT_UNAVAILABLE : operation.message || '命令已提交'}
    </p>
    {unavailable && (onRefresh || onReenter) && <div className="operation-recovery" aria-label="终态恢复">
      {onRefresh && <button type="button" className="secondary-button" onClick={onRefresh}>刷新结果</button>}
      {onReenter && <button type="button" className="text-button" onClick={onReenter}>重新进入频道</button>}
    </div>}
  </>;
}

function declarationKind(row) {
  const declaration = row?.declared || row || {};
  const explicit = declaration.kind || declaration.actor_kind;
  if (explicit === 'agent' || explicit === 'tool') return explicit;
  const className = String(declaration.default_class || declaration.class || '').toLowerCase();
  if (className.includes('agent') || className.includes('codex') || className.includes('claude')) return 'agent';
  // Directory projections normally carry `kind`; the id fallback keeps a
  // sparse declaration row observable without inventing a second source of
  // authority. The command still sends only the declaration id.
  const id = String(declaration.id || '');
  return /(^|[:._-])(agent|assistant)([:._-]|$)/i.test(id) ? 'agent' : 'tool';
}

function participantTypeLabel(kind) {
  return kind === 'human' ? '用户' : kind === 'agent' ? 'Agent' : '工具';
}

function displayChannelName(channel = {}) {
  return channel.qualified_name || channel.name || channel.id || '当前频道';
}

function channelStatusLabel(channel = {}) {
  if (channel.open === true || channel.serving === true) return '服务中';
  if (channel.open === false || channel.serving === false) return '未服务';
  return channel.status || '状态未知';
}

function actorRuntime(row = {}) {
  if (row.deviceOnline === true) return ['online', '在线'];
  if (row.bound === true) return ['bound', '已绑定'];
  if (row.bound === false) return ['waiting', '未绑定'];
  return ['waiting', '等待状态'];
}

function eligiblePrincipal(row = {}) {
  // WorkspaceApp already narrows the directory projection. Keep the feature
  // boundary defensive for direct public ports and fixtures: an explicit
  // non-human or retired row is never presented as a human admission target.
  return (!row.kind || row.kind === 'human')
    && (!row.status || row.status === 'present')
    && Boolean(row.id);
}

function participantCandidateName(candidate) {
  const row = candidate?.row || {};
  return String(row.display_name || row.email || row.name || row.id || '');
}

function compareParticipantCandidates(left, right) {
  return participantCandidateName(left).localeCompare(participantCandidateName(right), 'zh-CN')
    || String(left?.row?.id || '').localeCompare(String(right?.row?.id || ''), 'zh-CN')
    || String(left?.value || '').localeCompare(String(right?.value || ''), 'zh-CN');
}

function ChannelOverview({ channel, port }) {
  const [description, setDescription] = useState(channel?.description || '');
  const [child, setChild] = useState({ name: '', purpose: '', templateId: '' });
  const action = useCommand(port.commands, 'channel');
  useEffect(() => setDescription(channel?.description || ''), [channel?.description, channel?.id]);
  const children = port.children || [];
  // Channel governance consumes only its canonical Workspace projection. The
  // space port is a separate owner and must never be read as a compatibility
  // fallback for a channel creation decision.
  const templates = port.channelTemplates || [];
  const refreshDirectory = typeof port.commands?.refresh === 'function'
    ? () => port.commands.refresh('directory')
    : undefined;
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <OperationState operation={action.operation} />
    {port.candidatesUnavailable && <p className="governance-error" role="status">成员候选目录当前不可用；已有名册仍可查看和刷新。</p>}
    <PanelCard className="channel-facts">
      <header><h3>{displayChannelName(channel)}</h3><span className={channel.open === true || channel.serving === true ? 'fact-ok' : 'fact-warn'}>{channelStatusLabel(channel)}</span></header>
      <dl>
        <dt>ID</dt><dd>{channel?.id || '—'}</dd>
        <dt>父级</dt><dd>{channel?.parent_id || '无（空间根）'}</dd>
        <dt>Owner</dt><dd>{channel?.owner_principal || '—'}</dd>
        <dt>状态</dt><dd>{channelStatusLabel(channel)}</dd>
        <dt>说明</dt><dd>{channel?.description || '—'}</dd>
      </dl>
      {refreshDirectory && <button type="button" className="secondary-button" disabled={action.busy} onClick={refreshDirectory}>刷新目录事实</button>}
    </PanelCard>
    <PanelCard title="子频道" titleMeta={String(children.length)} action={refreshDirectory && <button type="button" className="text-button" disabled={action.busy} onClick={refreshDirectory}>刷新</button>}>
      {children.map((row) => <div className="child-channel" key={row.id}><span># {row.name || row.qualified_name || row.id}</span><small>{row.open === true ? '服务中' : row.status || '等待服务'}</small></div>)}
      {!children.length && <p className="governance-empty">还没有子频道。</p>}
    </PanelCard>
    <PanelCard className="governance-form" title="编辑频道说明"><label>说明<textarea rows="3" value={description} onChange={(event) => setDescription(event.target.value)} /></label><button type="button" className="primary-button" disabled={port.disabled || action.busy} onClick={() => action.submit('update_profile', { channelId: channel?.id, description }, { refresh: 'directory', submitted: '频道资料已进入提交队列，并已请求目录刷新；最终以账本与目录投影为准。' })}>保存频道资料</button></PanelCard>
    <PanelCard className="governance-form" title="创建子频道"><p>在 {displayChannelName(channel)} 下创建；提交后最终状态以账本和目录投影为准。</p><label>名称<input value={child.name} onChange={(event) => setChild({ ...child, name: event.target.value })} /></label><label>用途<textarea rows="3" value={child.purpose} onChange={(event) => setChild({ ...child, purpose: event.target.value })} /></label><label>频道模板<SelectMenu ariaLabel="频道模板" value={child.templateId} options={templates.map((row) => ({ value: row.id, label: row.name || row.id }))} onChange={(templateId) => setChild({ ...child, templateId })} /></label>{!templates.length && <p className="field-hint">当前目录没有可用的频道模板；创建仍可使用空配方。</p>}<button type="button" className="primary-button" disabled={port.disabled || action.busy || !child.name.trim()} onClick={() => action.submit('create_child', { ...child, parentId: channel?.id }, { refresh: 'directory', submitted: '子频道创建已进入提交队列，并已请求目录刷新；最终以账本与目录投影为准。' })}>创建子频道</button></PanelCard>
  </>;
}

function ChannelMembers({ channel, port }) {
  const [candidate, setCandidate] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [directOperation, setDirectOperation] = useState(null);
  const [submittedMember, setSubmittedMember] = useState(null);
  const action = useCommand(port.commands, 'channel');
  const commandPort = port.commands || {};
  const roster = (port.roster || []).filter(isVisibleActor);
  // A submitted command is only a ledger-side receipt.  Readiness is a
  // separate projection: the canonical roster owner must report a complete
  // authority for this channel and the requested actor must be present in
  // that projection.  In particular, do not infer readiness from the
  // command promise or from the combined waiting authority (which also
  // depends on history control).
  const rosterCurrent = port.rosterAuthority?.current === true
    && port.rosterAuthority?.channelId === channel?.id;
  const submittedMemberPresent = Boolean(submittedMember && roster.some((row) => (
    row.id === submittedMember.id
      || (submittedMember.kind === 'principal' && row.principal === submittedMember.id)
      || (submittedMember.kind === 'declaration' && row.decl_id === submittedMember.id)
  )));
  const memberReady = Boolean(
    submittedMember
      && action.operation?.state === 'submitted'
      && rosterCurrent
      && submittedMemberPresent,
  );
  const currentPrincipals = new Set(roster.map((row) => row.principal).filter(Boolean));
  const principalCandidates = (port.principals || []).map((entry) => entry?.declared || entry)
    .filter((row) => eligiblePrincipal(row) && !currentPrincipals.has(row.id))
    .map((row) => ({ value: `principal:${row.id}`, label: `${row.display_name || row.email || row.id} · 用户`, row, kind: 'principal', participantKind: 'human' }))
    .sort(compareParticipantCandidates);
  const declarationCandidates = (port.declarations || []).filter(isManageableDeclaration)
    .map((entry) => entry?.declared || entry)
    .map((row) => {
      const participantKind = declarationKind(row);
      return { value: `declaration:${row.id}`, label: `${row.name || row.id} · ${participantTypeLabel(participantKind)}`, row, kind: 'declaration', participantKind };
    })
    .sort(compareParticipantCandidates);
  const candidates = [
    ...principalCandidates,
    ...declarationCandidates,
  ];
  const selected = candidates.find((row) => row.value === candidate);
  const restartCommand = commandPort.restartActor || commandPort.restart;
  const bindCommand = commandPort.bindActor || commandPort.bind;
  const unbindCommand = commandPort.unbindActor || commandPort.unbind;
  const hasLifecycleCommands = typeof restartCommand === 'function' || typeof bindCommand === 'function' || typeof unbindCommand === 'function';
  const runDirectCommand = async (label, command, row, payload = {}) => {
    if (typeof command !== 'function') return;
    setDirectOperation({ state: 'pending', message: `正在${label}…` });
    try {
      await command({ channelId: channel?.id, actorId: row.id, ...payload });
      if (typeof commandPort.refresh === 'function') await commandPort.refresh('members');
      setDirectOperation({ state: 'submitted', message: `${label}已提交；最终状态以账本和名册投影为准。` });
    } catch (failure) {
      setDirectOperation({ state: 'failed', message: errorMessage(failure) });
    }
  };
  const introduce = (event) => {
    event.preventDefault();
    if (!selected) return;
    setSubmittedMember({ id: selected.row.id, kind: selected.kind });
    action.submit('introduce_actor', { channelId: channel?.id, candidateType: selected.kind, candidateId: selected.row.id });
  };
  const confirmActor = () => {
    if (!confirm) return;
    const { row, kind } = confirm;
    setConfirm(null);
    if (kind === 'restart') {
      runDirectCommand('重启', restartCommand, row, { reason: 'governance' });
      return;
    }
    action.submit('remove_actor', { channelId: channel?.id, actorId: row.id });
  };
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <OperationState operation={action.operation || directOperation} />
    <PanelCard title="当前成员与 Actor" action={<button type="button" className="text-button" onClick={() => commandPort.refresh?.('members')}>刷新</button>}>
      {roster.map((row) => {
        const [runtimeState, runtimeLabel] = actorRuntime(row);
        const ownerActor = row.principal && row.principal === channel?.owner_principal;
        const canRestart = typeof restartCommand === 'function' && row.kind !== 'human' && !ownerActor;
        const canBind = typeof bindCommand === 'function' && row.bound === false;
        const canUnbind = typeof unbindCommand === 'function' && row.bound === true;
        return <div className="managed-actor" key={row.id}>
          <div><strong>{actorDisplayName(row)}{row.id === port.selfId && <em>我</em>}</strong><small>{row.kind || 'actor'}{row.principal ? ` · principal ${row.principal}` : ''} · {row.id}</small></div>
          <span className={`actor-runtime ${runtimeState}`}>{runtimeLabel}</span>
          <button type="button" disabled={typeof commandPort.selectActor !== 'function'} onClick={() => commandPort.selectActor?.(row)} aria-label={`查看 ${actorDisplayName(row)}`}>查看</button>
          {canBind || canUnbind ? <button type="button" disabled={port.disabled || directOperation?.state === 'pending'} onClick={() => runDirectCommand(row.bound ? '解绑' : '绑定', row.bound ? unbindCommand : bindCommand, row)}>{row.bound ? '解绑' : '绑定'}</button> : <button type="button" disabled title="当前治理端口未提供绑定命令">绑定</button>}
          {canRestart ? <button type="button" disabled={port.disabled || directOperation?.state === 'pending'} onClick={() => setConfirm({ kind: 'restart', row })}>重启</button> : <button type="button" disabled title={row.kind === 'human' ? '用户成员不支持 Agent 重启' : '当前治理端口未提供重启命令'}>重启</button>}
          <button type="button" className="danger-text" disabled={port.disabled || row.id === port.selfId || ownerActor || row.protected} onClick={() => setConfirm({ kind: 'remove', row })}>{ownerActor ? 'Owner' : '移除'}</button>
        </div>;
      })}
      {!roster.length && <p className="governance-empty">暂无可管理的业务 Actor</p>}
      {port.identityPending && <p className="roster-identity-pending" role="status">正在确认你在本频道中的 Actor 身份</p>}
      {memberReady && <p className="roster-ready" role="status">成员已就绪</p>}
      <p className="protected-note">标准系统 Actor 与维持频道关系的 foundation Actor 已隐藏并受后端保护。</p>
      {!hasLifecycleCommands && <p className="protected-note">当前治理端口未提供绑定或重启命令；这里仅展示目录事实、查看与已有移除入口。</p>}
    </PanelCard>
    <PanelCard as="form" className="governance-form" title="添加参与者" onSubmit={introduce}>
      <p>先选择业务参与者；系统会根据对象类型显示必要配置。标准 Actor 不会出现在候选项中。</p>
      <label>参与者<SelectMenu ariaLabel="选择参与者" placeholder="搜索用户、Agent 或工具" value={candidate} options={candidates} onChange={(value) => setCandidate(value)} /></label>
      {selected && <div className="participant-selection" role="status" data-participant-id={selected.row.id} data-participant-kind={selected.participantKind}><span>{participantTypeLabel(selected.participantKind)}</span><strong>{selected.row.display_name || selected.row.email || selected.row.name || selected.row.id}</strong><small>{selected.row.id}</small></div>}
      {selected && selected.kind === 'declaration' && <p className="field-hint">Actor 的归属 principal 由声明本身决定；要改归属请编辑声明。</p>}
      <button className="primary-button" type="submit" disabled={port.disabled || action.busy || !selected}>添加到频道</button>
    </PanelCard>
    {confirm && <InlineConfirmation title={`确认${confirm.kind === 'restart' ? '重启' : '移除'} ${actorDisplayName(confirm.row)}？`} description={confirm.kind === 'restart' ? '重启结果以账本和 presence 收敛为准；当前页面不会猜测成功。' : '该操作将通过频道治理命令提交，最终状态以频道事实为准。'} tone="danger" onCancel={() => setConfirm(null)} onConfirm={confirmActor} />}
  </>;
}

function ChannelDanger({ channel, port }) {
  const [confirmation, setConfirmation] = useState('');
  const action = useCommand(port.commands, 'channel');
  const expected = displayChannelName(channel);
  const protectedRoot = channel?.id === 'c0' || channel?.is_root === true || channel?.root === true;
  return <PanelCard className="danger-zone" title="退役频道">
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    {protectedRoot ? <p>空间根频道 {channel?.id || 'c0'} 受后端保护，不能退役。</p> : <><p>退役后频道停止写入，但已有账本和文件不会被前端删除；存在活动子频道时由后端拒绝。</p><label>输入 <strong>{expected}</strong> 确认<input aria-label="退役确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button type="button" className="danger-button" disabled={port.disabled || confirmation !== expected} onClick={() => action.submit('retire', { channelId: channel?.id })}>退役当前频道</button></>}
  </PanelCard>;
}

const CHANNEL_CREATE_STEPS = Object.freeze([
  ['ledger', '账本确认', '等待创建请求写入频道账本'],
  ['observable', '频道可观察', '等待 OBS 返回新频道'],
  ['membership', '成员关系', '等待当前账户获得成员关系'],
  ['serving', '服务就绪', '等待频道开放服务'],
]);

function validateChannelName(value) {
  const name = String(value || '').trim();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)
    ? ''
    : '名称须为 1–63 位小写字母、数字或连字符，且不能以连字符开头或结尾';
}

function isMemberChannel(row) {
  const relationship = row?.accessState?.relationship || row?.access_state?.relationship;
  if (relationship) return relationship === 'member';
  const mode = String(row?.access || row?.accessMode || '').toLowerCase();
  if (mode) return mode === 'member_active' || mode === 'member_stale';
  // Direct feature fixtures may expose only the channel projection. The real
  // governance port always includes access/accessState, so a bare child row is
  // accepted only for that narrow presentation boundary.
  return true;
}

function createdChildFor(channel, children, name) {
  const expectedId = `${channel?.id || ''}.${name}`;
  return (children || []).find((row) => (
    row?.id === expectedId
      || row?.qualified_name === expectedId
      || (row?.parent_id === channel?.id && row?.name === name)
  )) || null;
}

function templateRecipeBody(value) {
  const body = value?.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function isUnavailableTemplateDetail(error) {
  const code = String(error?.code || '');
  return code === 'template_body_invalid'
    || code === 'governance_terminal_unavailable'
    || code === 'terminal_result_unavailable'
    || error?.resultPhase === 'unavailable'
    || error?.resultUnavailable === true;
}

// The Shell must provide one read-only, typed creation projection for the
// request returned by `commands.submit`.  A submission id is only a locator;
// it is not proof of acceptance or a ledger terminal.  The projection is
// intentionally narrow so this feature cannot infer lifecycle facts from the
// child directory (or from the local command promise):
//
//   port.creation = {
//     requestId, accepted, ledger, observable, membership, serving,
//     channel, error?
//   }
//
// `children` remains useful only for resolving the authoritative channel row
// after the projection explicitly says that OBS has observed it.
function creationConvergence(channel, children, request, creation = null) {
  if (!request) return null;
  const facts = creation?.requestId === request.id ? creation : null;
  const child = facts?.observable === true
    ? (facts.channel || createdChildFor(channel, children, request.name))
    : null;
  const accepted = facts?.accepted === true;
  const ledger = facts?.ledger === true;
  const observable = facts?.observable === true;
  const membership = facts?.membership === true;
  const serving = facts?.serving === true;
  return {
    accepted,
    ledger,
    observable,
    membership,
    serving,
    channel: child,
    failed: facts?.failed === true,
    error: String(facts?.error || ''),
    ready: Boolean(facts && accepted && ledger && observable && membership && serving && child),
  };
}

// The rail entry is a real modal owned by GovernanceFeature. The command,
// channel directory and access projection remain the existing Workspace
// owners; this component only keeps the local request and renders their
// convergence without a second store or a private protocol API.
export function ChannelCreateModal({ channel, port = {}, onClose, returnFocusRef = null }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [initialAgentIds, setInitialAgentIds] = useState([]);
  const [createRequest, setCreateRequest] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const templateListRequestedRef = useRef(false);
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const commands = port.commands || {};
  const children = Array.isArray(port.children) ? port.children : [];
  const templatesKnown = Array.isArray(port.channelTemplates);
  const templates = templatesKnown ? port.channelTemplates : [];
  const validation = validateChannelName(name);
  const convergence = creationConvergence(channel, children, createRequest, port.creation);
  const tracking = Boolean(createRequest && !convergence?.ready && !convergence?.failed);
  const locked = port.disabled || submitting || tracking || convergence?.ready;
  const parentName = displayChannelName(channel);
  const shellEnter = typeof commands.enterChannel === 'function';
  const initialAgents = (Array.isArray(port.roster) ? port.roster : [])
    .filter((row) => row?.kind === 'agent' && row.id && isVisibleActor(row));
  const selectedInitialAgentIds = initialAgentIds.filter((id) => initialAgents.some((row) => row.id === id));

  // Registrar templates are not part of the OBS directory.  Ask the existing
  // command owner for the list when this public create owner opens, then use
  // the typed projection it publishes; never read a space port or invent rows.
  useEffect(() => {
    if (templatesKnown || templateListRequestedRef.current || typeof commands.listTemplates !== 'function') return undefined;
    templateListRequestedRef.current = true;
    Promise.resolve(commands.listTemplates()).catch(() => {});
    return undefined;
  }, [commands.listTemplates, templatesKnown]);

  function retryCreate() {
    setCreateRequest(null);
    setError('');
  }

  useModalFocus({
    dialogRef,
    initialFocusRef: nameRef,
    returnFocusRef,
    onClose,
    closeDisabled: submitting,
  });

  async function submit(event) {
    event.preventDefault();
    const normalized = String(name || '').trim();
    const nameError = validateChannelName(normalized);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (typeof commands.submit !== 'function') {
      setError('频道治理命令不可用');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      let body = null;
      if (templateId) {
        if (typeof commands.getTemplate !== 'function') {
          throw Object.assign(new Error(TERMINAL_RESULT_UNAVAILABLE), { code: 'template_body_invalid' });
        }
        const template = await commands.getTemplate(templateId);
        body = templateRecipeBody(template);
        if (!body) throw Object.assign(new Error(TERMINAL_RESULT_UNAVAILABLE), { code: 'template_body_invalid' });
      }
      const messageId = await commands.submit({
        scope: 'channel',
        action: 'create_child',
        payload: {
          name: normalized,
          purpose: String(purpose || '').trim(),
          parentId: channel?.id,
          ...(templateId ? { templateId, templateBody: body } : {}),
          ...(selectedInitialAgentIds.length ? { initialActorIds: selectedInitialAgentIds } : {}),
        },
      });
      if (!messageId) throw new Error('创建命令没有返回可追踪的请求编号');
      setCreateRequest({ id: String(messageId), name: normalized });
    } catch (failure) {
      setError(isUnavailableTemplateDetail(failure) ? TERMINAL_RESULT_UNAVAILABLE : errorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  async function enterChannel() {
    const target = convergence?.channel?.id || convergence?.channel?.qualified_name;
    if (!convergence?.ready || !target) return;
    if (!shellEnter) {
      setError('频道已就绪，但 Shell navigation port 尚未连接，当前不能进入新频道。');
      return;
    }
    try {
      const result = await commands.enterChannel({ channelId: target, view: 'conversation' });
      if (result === false) setError('频道已就绪，但 Shell navigation port 未接受进入请求。');
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return <div
    className="modal-backdrop channel-create-backdrop"
    data-modal-layer
    role="presentation"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onClose?.();
    }}
  >
    <section ref={dialogRef} tabIndex={-1} className="task-create-modal channel-create-modal" role="dialog" aria-modal="true" aria-labelledby="channel-create-title" aria-describedby="channel-create-description">
      <header>
        <div><p className="eyebrow">NEW CHANNEL</p><h2 id="channel-create-title">新建频道</h2></div>
        <button type="button" onClick={onClose} disabled={submitting} aria-label="关闭新建频道">×</button>
      </header>
      <form className="channel-create-form" onSubmit={submit}>
        <p id="channel-create-description">在 <strong>{parentName}</strong> 下创建子频道。提交后会持续核对账本、可观察性、成员关系和服务状态。</p>
        <label><span>频道名称</span><input ref={nameRef} aria-label="新频道名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 backend" disabled={locked} aria-invalid={Boolean(name && validation)} required /></label>
        {name && validation && <small className="field-error">{validation}</small>}
        <label><span>用途</span><input aria-label="频道用途" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="这个频道用于什么" disabled={locked} /></label>
        <label><span>频道模板</span><SelectMenu
          ariaLabel="频道模板"
          value={templateId}
          options={templates.map((row) => ({ value: row.id, label: row.name || row.id }))}
          onChange={setTemplateId}
          disabled={locked || !templatesKnown}
        /></label>
        {!templatesKnown && <small className="field-hint">正在读取频道模板…</small>}
        {templatesKnown && !templates.length && <small className="field-hint">当前没有可用的频道模板；创建仍可使用空配方。</small>}
        <section className="channel-create-members" aria-labelledby="channel-create-members-title">
          <header><strong id="channel-create-members-title">初始成员</strong><small>你会自动加入，也可以带入当前频道的 Agent</small></header>
          {port.selfId && <div className="channel-create-member pinned"><span>✓</span><div><strong>我</strong><small>{port.selfId}</small></div></div>}
          {initialAgents.map((row) => <label className="channel-create-member" key={row.id}>
            <input
              type="checkbox"
              aria-label={`初始 Agent ${actorDisplayName(row)}`}
              checked={selectedInitialAgentIds.includes(row.id)}
              disabled={locked}
              onChange={(event) => setInitialAgentIds((current) => (
                event.target.checked
                  ? [...new Set([...current, row.id])]
                  : current.filter((id) => id !== row.id)
              ))}
            />
            <div><strong>{actorDisplayName(row)}</strong><small>Agent · {row.id}</small></div>
          </label>)}
          {!initialAgents.length && <small className="field-hint">当前没有可管理的 Agent。</small>}
        </section>
        {error && <p className="governance-error" role="alert">{error}</p>}
        {convergence && <section className="convergence channel-create-progress" aria-label="频道创建进度" aria-live="polite">
          <header><strong>{createRequest.name}</strong><small>{convergence.failed ? '创建失败' : convergence.ready ? '已就绪' : '正在收敛'}</small></header>
          {CHANNEL_CREATE_STEPS.map(([key, label, waiting]) => <div key={key} className={convergence[key] ? 'done' : 'waiting'}>
            <span aria-hidden="true">{convergence[key] ? '✓' : '·'}</span>
            <strong>{label}</strong>
            <small>{convergence[key] ? '已确认' : waiting}</small>
          </div>)}
          {convergence.error && <p className="governance-error" role="alert">{convergence.error}</p>}
          {convergence.ready && <p className="ready-message">{shellEnter ? '频道已经可以打开和协作。' : '频道已经就绪，但 Shell navigation port 尚未连接。'}</p>}
        </section>}
        <footer>
          <button type="button" onClick={onClose} disabled={submitting}>取消</button>
          {convergence?.ready
            ? <button type="button" className="primary-button" disabled={!shellEnter} title={shellEnter ? '' : 'Shell navigation port 尚未连接'} onClick={enterChannel}>进入新频道</button>
            : convergence?.failed
              ? <button type="button" className="primary-button" onClick={retryCreate}>重新创建</button>
            : <button type="submit" className="primary-button" disabled={locked || Boolean(validation)}>{submitting ? '正在提交…' : tracking ? '等待频道就绪…' : '创建频道'}</button>}
        </footer>
      </form>
    </section>
  </div>;
}

export function ChannelAdministrationPanel({ channel, port = {}, initialTab = 'members', onClose }) {
  const resolvedInitialTab = ['overview', 'info'].includes(initialTab) ? 'overview' : ['members', 'danger'].includes(initialTab) ? initialTab : 'members';
  const [tab, setTab] = useState(resolvedInitialTab);
  useEffect(() => setTab(resolvedInitialTab), [resolvedInitialTab]);
  // Directory/member refresh is not an operation-result refresh. Only an
  // explicitly typed operation receipt port may offer that action; the
  // Workspace channel owner currently has no reliable one, so unavailable
  // terminal results expose the canonical re-entry path only.
  const refreshOperation = typeof port.commands?.refreshOperation === 'function'
    ? () => port.commands.refreshOperation()
    : undefined;
  const reenterChannel = typeof port.commands?.enterChannel === 'function' && channel?.id
    ? () => port.commands.enterChannel({ channelId: channel.id, view: 'conversation' })
    : undefined;
  return <SidePanel className="channel-governance" ariaLabel="频道治理" eyebrow="CHANNEL CONTEXT" title="频道详情" tabs={[{ id: 'members', label: '成员' }, { id: 'overview', label: '概览' }, { id: 'danger', label: '危险操作' }]} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    <OperationState operation={port.operation} terminal onRefresh={refreshOperation} onReenter={reenterChannel} />
    <div hidden={tab !== 'overview'}><ChannelOverview channel={channel} port={port} /></div>
    <div hidden={tab !== 'members'}><ChannelMembers channel={channel} port={port} /></div>
    <div hidden={tab !== 'danger'}><ChannelDanger channel={channel} port={port} /></div>
  </SidePanel>;
}

function parsePayload(text) {
  const value = JSON.parse(text || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Payload 必须是 JSON 对象');
  return value;
}

function timerId(row) {
  return String(row?.timerId || row?.timer_id || '');
}

function timerChannelId(row) {
  return String(row?.channelId || row?.channel_id || '');
}

function timerStateLabel(state) {
  return ({ scheduled: '已安排', cancelled: '已取消', fired: '已触发' })[state] || state || '状态未知';
}

export function ChannelAutomationPanel({ channel, port = {}, onClose }) {
  const [duration, setDuration] = useState('5000');
  const [msgType, setMsgType] = useState('agent.ask');
  const [payloadText, setPayloadText] = useState('{"text":"定时提醒"}');
  const [cancelId, setCancelId] = useState('');
  const [operation, setOperation] = useState(null);
  const [error, setError] = useState('');
  const busy = operation?.state === 'pending';
  const rows = (port.records || []).filter((row) => !timerChannelId(row) || timerChannelId(row) === channel?.id);
  const execute = async (message, command) => {
    setError('');
    setOperation({ state: 'pending', message });
    try {
      const result = await command();
      setOperation({ state: 'completed', message: result?.message || '操作回执已确认。' });
      return result;
    } catch (failure) {
      const detail = errorMessage(failure);
      setError(detail);
      setOperation({ state: 'failed', message: detail });
      return undefined;
    }
  };
  const create = () => execute('正在创建定时动作…', async () => {
    const durationMs = Number(duration);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new TypeError('延迟必须是正整数毫秒');
    if (!msgType.trim()) throw new TypeError('消息类型不能为空');
    if (typeof port.commands?.after !== 'function') throw new TypeError('timer.after owner 尚未连接');
    const result = await port.commands.after({ channelId: channel?.id, durationMs, msgType: msgType.trim(), payload: parsePayload(payloadText) });
    const id = timerId(result);
    if (!id) throw new TypeError('服务端没有返回 timer_id');
    setCancelId(id);
    return { ...result, message: `已安排 ${id}；该回执只证明本次操作，不代表跨设备完整清单。` };
  });
  const cancel = (row = {}) => execute('正在取消定时动作…', async () => {
    if (typeof port.commands?.cancel !== 'function') throw new TypeError('timer.cancel owner 尚未连接');
    const id = timerId(row) || cancelId.trim();
    if (!id) throw new TypeError('timer_id 不能为空');
    const result = await port.commands.cancel({ channelId: timerChannelId(row) || channel?.id, timerId: id });
    return { ...result, message: `已确认取消 ${id}。` };
  });
  const list = () => execute('正在刷新本浏览器记录…', async () => {
    if (typeof port.commands?.list !== 'function') throw new TypeError('服务端没有 timer list/OBS；当前 owner 也未提供本浏览器记录投影');
    await port.commands.list({ channelId: channel?.id });
    return { message: '本浏览器会话的定时记录已刷新。' };
  });
  return <SidePanel className="automation-panel" ariaLabel="定时动作" eyebrow="LOCAL AUTOMATION" title="定时动作" onClose={onClose}>
    <PanelCard className="local-fact" title="可观测边界"><p>服务端没有 timer list/OBS。此处只展示当前浏览器会话 owner 已收到的 after/cancel 回执，不代表跨设备完整清单。</p></PanelCard>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <OperationState operation={operation?.state === 'pending' ? operation : port.operation || operation} />
    <PanelCard className="governance-form" title="安排消息">
      <label>延迟（毫秒）<input aria-label="定时延迟毫秒" type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
      <label>消息类型<input aria-label="定时消息类型" value={msgType} onChange={(event) => setMsgType(event.target.value)} /></label>
      <label>Payload JSON<textarea aria-label="定时 Payload JSON" rows="7" value={payloadText} onChange={(event) => setPayloadText(event.target.value)} /></label>
      <button type="button" className="primary-button" disabled={port.disabled || busy || !channel?.id} onClick={create}>创建定时动作</button>
    </PanelCard>
    <PanelCard className="governance-form" title="取消已知动作">
      <label>timer_id<input aria-label="待取消 timer ID" value={cancelId} onChange={(event) => setCancelId(event.target.value)} /></label>
      <button type="button" disabled={port.disabled || busy || !cancelId.trim()} onClick={() => cancel()}>取消定时动作</button>
    </PanelCard>
    <PanelCard title="本浏览器会话的动作" action={<button type="button" className="text-button" disabled={busy || typeof port.commands?.list !== 'function'} onClick={list}>刷新</button>}>
      {rows.map((row) => <div className="timer-row" key={timerId(row)}><div><strong>{row.msgType || row.msg_type || '未知类型'}</strong><small>{timerId(row)}</small>{(row.dueAt || row.due_at) && <small>{new Date(row.dueAt || row.due_at).toLocaleString('zh-CN')} · {row.provenance || '本会话回执'}</small>}</div><span className={`timer-state state-${row.state || 'scheduled'}`}>{timerStateLabel(row.state || 'scheduled')}</span>{(row.state || 'scheduled') === 'scheduled' && <button type="button" disabled={port.disabled || busy} onClick={() => cancel(row)}>取消</button>}</div>)}
      {!rows.length && <p className="governance-empty">当前浏览器会话还没有可追踪的定时动作。</p>}
    </PanelCard>
  </SidePanel>;
}

function JsonEditor({ title, value, actions, disabled, onSubmit }) {
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2));
  const [error, setError] = useState('');
  const act = (action) => {
    setError('');
    try { onSubmit(action, JSON.parse(text || '{}')); }
    catch (failure) { setError(errorMessage(failure)); }
  };
  return <PanelCard className="governance-form" title={title}><label>JSON<textarea rows="12" value={text} onChange={(event) => setText(event.target.value)} /></label>{error && <p className="governance-error" role="alert">{error}</p>}<div className="form-actions">{actions.map((entry) => <button type="button" className={entry.primary ? 'primary-button' : entry.danger ? 'danger-text' : ''} disabled={disabled} key={entry.id} onClick={() => act(entry.id)}>{entry.label}</button>)}</div></PanelCard>;
}

function TemplateList({ rows, empty }) {
  return <PanelCard title="已登记项目">{rows.map((row) => <div className="template-row" key={row.id}><strong>{row.name || row.id}</strong><small>{row.id}</small>{row.protected && <span>系统保护</span>}</div>)}{!rows.length && <p className="governance-empty">{empty}</p>}</PanelCard>;
}

function SpaceTemplates({ kind, port }) {
  const isActor = kind === 'actor_templates';
  const rows = isActor ? port.actorTemplates || [] : port.channelTemplates || [];
  const action = useCommand(port.commands, 'space');
  return <>{action.error && <p className="governance-error" role="alert">{action.error}</p>}<TemplateList rows={rows} empty="尚未读取模板。" /><JsonEditor title={isActor ? '登记或编辑 Actor 模板' : '登记或编辑频道模板'} value={{ id: '', name: '', description: '', ...(isActor ? { class: 'agent', config: {} } : { body: {} }) }} disabled={port.disabled} actions={[{ id: 'upsert', label: '保存', primary: true }, { id: 'retire', label: '退役', danger: true }, { id: 'list', label: '重新读取' }]} onSubmit={(actionName, payload) => action.submit(`${isActor ? 'actor_template' : 'channel_template'}_${actionName}`, payload)} /></>;
}

function SpaceDevices({ channel, port }) {
  const action = useCommand(port.commands, 'space');
  const [name, setName] = useState('');
  const refreshDevices = typeof port.commands?.refresh === 'function'
    ? () => port.commands.refresh('devices')
    : undefined;
  const refreshAfter = refreshDevices ? { refresh: 'devices' } : {};
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <PanelCard className="governance-form" title="创建设备身份">
      <p>只有当前空间命令端口提供写能力时才会提交创建设备；列表始终只显示已收到的目录事实。</p>
      <label>设备名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button type="button" className="primary-button" disabled={port.disabled || action.busy || !name.trim()} onClick={() => action.submit('create_device', { name }, refreshAfter)}>创建设备</button>
    </PanelCard>
    <PanelCard title="空间设备列表" action={refreshDevices && <button type="button" className="text-button" disabled={action.busy} onClick={refreshDevices}>刷新</button>}>
      <p className="governance-empty">绑定状态来自当前空间目录；它不代表频道已经完成挂载或服务收敛。</p>
      {(port.devices || []).map((row) => <div className="device-row" key={row.id}><div><strong>{row.name || row.id}</strong><small>{row.id} · {row.online === true ? '在线' : row.online === false ? '离线' : '未知'} · {row.attached ? '已绑定' : '未绑定'}</small></div><div><button type="button" disabled={port.disabled || action.busy || row.attached} onClick={() => action.submit('attach_device', { channelId: channel?.id, deviceId: row.id }, refreshAfter)}>绑定当前频道</button><button type="button" disabled={port.disabled || action.busy || !row.attached} onClick={() => action.submit('detach_device', { channelId: channel?.id, deviceId: row.id }, refreshAfter)}>解绑</button><button type="button" className="danger-text" disabled={port.disabled || action.busy || row.protected} onClick={() => action.submit('retire_device', { deviceId: row.id }, refreshAfter)}>退役</button></div></div>)}
      {!port.devices?.length && <p className="governance-empty">当前空间目录没有可展示的设备。</p>}
    </PanelCard>
  </>;
}

export function SpaceAdministrationPanel({ channel, port = {}, onClose }) {
  const [tab, setTab] = useState('actor_templates');
  const action = useCommand(port.commands, 'space');
  const tabs = [{ id: 'actor_templates', label: 'Actor 模板' }, { id: 'channel_templates', label: '频道模板' }, { id: 'configuration', label: '频道配置' }, { id: 'devices', label: '设备' }];
  return <SidePanel className="space-administration" ariaLabel="空间管理" eyebrow="SPACE CONTROL" title="空间管理" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    {port.unsupported && <p className="governance-error" role="status">{port.unsupported}</p>}
    {port.operation && <p className={`operation-state state-${port.operation.state || 'pending'}`} role="status">{port.operation.message || '空间命令已提交'}</p>}
    {tab === 'actor_templates' && <SpaceTemplates kind={tab} port={port} />}
    {tab === 'channel_templates' && <SpaceTemplates kind={tab} port={port} />}
    {tab === 'configuration' && <><JsonEditor title="频道资料与声明覆盖" value={port.configuration || { channelId: channel?.id, profile: {}, overlays: [] }} disabled={port.disabled} actions={[{ id: 'save_configuration', label: '保存配置', primary: true }, { id: 'refresh_configuration', label: '刷新' }]} onSubmit={(name, payload) => action.submit(name, { channelId: channel?.id, ...payload })} />{action.error && <p className="governance-error" role="alert">{action.error}</p>}</>}
    {tab === 'devices' && <SpaceDevices channel={channel} port={port} />}
  </SidePanel>;
}
