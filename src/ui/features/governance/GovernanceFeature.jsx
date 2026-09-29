import React, { useEffect, useRef, useState } from 'react';
import { actorDisplayName } from '../../../model/actor-display.js';
import { actorDescriptionRef, actorMemberName, isVisibleActor } from '../../../model/actor-visibility.js';
import { memberLayerIssue } from '../../../model/member-config.js';
import { LOCAL_DEVICE_ID } from '../../../protocol/vocab.js';
import { TERMINAL_RESULT_UNAVAILABLE } from '../../../model/terminal-result.js';
import { InlineConfirmation } from '../../primitives/InlineConfirmation.jsx';
import { PanelCard } from '../../primitives/PanelCard.jsx';
import { SelectMenu } from '../../primitives/SelectMenu.jsx';
import { SidePanel } from '../../primitives/SidePanel.jsx';
import { useModalFocus } from '../../primitives/useModalFocus.js';
import { BuildLine } from './BuildLine.jsx';
import { GlobalKeysPanel } from './GlobalKeysPanel.jsx';

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

function participantTypeLabel(kind) {
  return kind === 'human' ? '用户' : kind === 'agent' ? 'Agent' : '工具';
}

function displayChannelName(channel = {}) {
  const current = channel || {};
  return current.qualified_name || current.name || current.id || '当前频道';
}

function channelStatusLabel(channel = {}) {
  const current = channel || {};
  if (current.open === true || current.serving === true) return '服务中';
  if (current.open === false || current.serving === false) return '未服务';
  return current.status || '状态未知';
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

// channel.get 的 health：空 = 正常；broken = 频道打不开（原因在 health_reason）。
const HEALTH_LABELS = Object.freeze({ broken: '损坏' });

// 频道设置：说明文字、是否对外服务（channel.set）；外挂设备（device.attach /
// detach）；频道的健康、它自己和每个成员最近一次构建（channel.get）。频道
// 状态按需读——打开面板不发任何请求。
function ChannelSettings({ channel, port }) {
  const currentChannel = channel || {};
  const commands = port.commands || {};
  const [view, setView] = useState(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [description, setDescription] = useState('');
  const [serving, setServing] = useState(false);
  const action = useCommand(port.commands, 'channel');
  const channelIdRef = useRef(channel?.id);
  channelIdRef.current = channel?.id;
  useEffect(() => { setView(null); setReadError(''); setDescription(''); setServing(false); }, [channel?.id]);
  const children = port.children || [];
  const refreshDirectory = typeof commands.refresh === 'function'
    ? () => commands.refresh('directory')
    : undefined;
  const readable = typeof commands.readChannel === 'function';
  const body = view?.description?.body || null;
  const platformChannel = Boolean(view) && !view.description;
  const read = async () => {
    if (!readable) return;
    const target = channel?.id;
    setReading(true);
    setReadError('');
    try {
      const value = await commands.readChannel(target);
      if (channelIdRef.current !== target) return;
      setView(value || {});
      setDescription(String(value?.description?.body?.description || ''));
      setServing(Number(value?.description?.body?.serving || 0) === 1);
    } catch (failure) {
      if (channelIdRef.current === target) setReadError(errorMessage(failure));
    } finally {
      if (channelIdRef.current === target) setReading(false);
    }
  };
  const describedDevices = new Set(Array.isArray(body?.devices) ? body.devices : []);
  const usable = new Set((port.channelDevices || []).map((row) => row.id));
  const spaceDevices = (port.spaceDevices || []).filter((row) => row.id && row.id !== LOCAL_DEVICE_ID);
  const saveProfile = async () => {
    await action.submit('update_profile', { channelId: channel?.id, description, serving }, { refresh: 'directory', submitted: '频道描述已写入；构建结果重新读取频道状态查看。' });
    if (readable) await read();
  };
  const toggleDevice = async (row, attach) => {
    await action.submit(attach ? 'attach_device' : 'detach_device', { channelId: channel?.id, deviceId: row.id }, { refresh: 'directory', submitted: attach ? '设备已写进频道描述。' : '设备已从频道描述移除。' });
    if (readable) await read();
  };
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <OperationState operation={action.operation} />
    <PanelCard className="channel-facts">
      <header><h3>{displayChannelName(currentChannel)}</h3><span className={currentChannel.open === true || currentChannel.serving === true ? 'fact-ok' : 'fact-warn'}>{channelStatusLabel(currentChannel)}</span></header>
      <dl>
        <dt>ID</dt><dd>{channel?.id || '—'}</dd>
        <dt>父级</dt><dd>{channel?.parent_id || '无（空间根）'}</dd>
        <dt>Owner</dt><dd>{channel?.owner_principal || '—'}</dd>
        <dt>状态</dt><dd>{channelStatusLabel(channel)}</dd>
      </dl>
      {refreshDirectory && <button type="button" className="secondary-button" disabled={action.busy} onClick={refreshDirectory}>刷新目录事实</button>}
    </PanelCard>
    <PanelCard className="channel-runtime" title="频道状态" action={<button type="button" className="text-button" disabled={!readable || reading} onClick={read}>{reading ? '读取中…' : view ? '刷新' : '读取'}</button>}>
      {!readable && <p className="governance-empty">当前会话不能读取频道状态。</p>}
      {readable && !view && !reading && !readError && <p className="governance-empty">频道的描述、健康和构建结果按需读取：点「读取」发一条 system.channel.get。</p>}
      {readError && <p className="governance-error" role="alert">{readError}</p>}
      {view && <>
        <dl className="channel-health">
          <dt>健康</dt><dd className={`health-${view.health || 'ok'}`}>{view.health ? HEALTH_LABELS[view.health] || view.health : '正常'}{view.health_reason ? `：${view.health_reason}` : ''}</dd>
          {body && <><dt>描述版本</dt><dd>第 {view.description.revision} 版</dd></>}
          {body && <><dt>说明</dt><dd>{body.description || '—'}</dd></>}
          {body && <><dt>对外服务</dt><dd>{Number(body.serving || 0) === 1 ? '是' : '否'}</dd></>}
        </dl>
        {platformChannel && <p className="governance-empty">这个频道由平台搭建，没有频道描述；成员固定。</p>}
        {view.build && <BuildLine record={view.build} label="频道自身" />}
        <div className="member-builds" aria-label="成员构建摘要">
          {(view.members || []).map((record, index) => <BuildLine key={`${record?.object?.name || index}`} record={record} />)}
          {!(view.members || []).length && <p className="governance-empty">还没有成员构建记录。</p>}
        </div>
      </>}
    </PanelCard>
    {body && <PanelCard className="governance-form" title="说明与服务">
      <label>说明<textarea aria-label="频道说明" rows="3" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label className="checkbox-row"><input type="checkbox" aria-label="对外服务" checked={serving} onChange={(event) => setServing(event.target.checked)} /> 对外服务（频道的服务门接受外部请求）</label>
      <button type="button" className="primary-button" disabled={port.disabled || action.busy} onClick={saveProfile}>保存</button>
    </PanelCard>}
    {body && <PanelCard className="channel-devices" title="设备">
      <p className="field-hint">频道的文件和成员默认在 local-device 上；这里挂上的设备是另外几个可选的位置，成员在自己的配置里选 desired_host 才会去那里。</p>
      <div className="device-row default"><div><strong>local-device</strong><small>默认 · 不需要挂载</small></div></div>
      {spaceDevices.map((row) => {
        const attached = describedDevices.has(row.id);
        return <div className="device-row" key={row.id} data-device-id={row.id}>
          <div><strong>{row.name || row.id}</strong><small>{row.id} · {row.online === true ? '在线' : row.online === false ? '离线' : '未知'} · {attached ? (usable.has(row.id) ? '已挂载' : '已写入描述') : '未挂载'}</small></div>
          <button type="button" disabled={port.disabled || action.busy} onClick={() => toggleDevice(row, !attached)}>{attached ? '卸载' : '挂到本频道'}</button>
        </div>;
      })}
      {!spaceDevices.length && <p className="governance-empty">空间里还没有别的设备；可在「空间管理 → 设备」创建。</p>}
    </PanelCard>}
    <PanelCard title="子频道" titleMeta={String(children.length)} action={refreshDirectory && <button type="button" className="text-button" disabled={action.busy} onClick={refreshDirectory}>刷新</button>}>
      {children.map((row) => <div className="child-channel" key={row.id}><span># {row.name || row.qualified_name || row.id}</span><small>{row.open === true ? '服务中' : row.status || '等待服务'}</small></div>)}
      {!children.length && <p className="governance-empty">还没有子频道。</p>}
    </PanelCard>
  </>;
}

function ChannelMembers({ channel, port }) {
  const [candidate, setCandidate] = useState('');
  const [memberName, setMemberName] = useState('');
  const [className, setClassName] = useState('');
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
      || (submittedMember.kind !== 'principal' && actorMemberName(row.id) === submittedMember.name)
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
  const descriptionCandidates = (port.actorDescriptions || [])
    .map((row) => ({ value: `description:${actorDescriptionRef(row)}`, label: `${actorDescriptionRef(row)} · Actor 描述（class ${row.class || '?'}）`, row: { ...row, id: actorDescriptionRef(row) }, kind: 'description', participantKind: 'actor' }))
    .sort(compareParticipantCandidates);
  const candidates = [
    ...principalCandidates,
    ...descriptionCandidates,
    { value: 'class:', label: '直接按 Class 新建…', row: { id: '' }, kind: 'class', participantKind: 'actor' },
  ];
  const selected = candidates.find((row) => row.value === candidate);
  const needsName = selected && selected.kind !== 'principal';
  const trimmedName = memberName.trim();
  const nameError = needsName && trimmedName && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmedName)
    ? '成员名须为 1–63 位小写字母、数字或连字符' : '';
  const ready = selected && (!needsName || (trimmedName && !nameError))
    && (selected.kind !== 'class' || className.trim());
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
  const choose = (value) => {
    setCandidate(value);
    const next = candidates.find((row) => row.value === value);
    if (next?.kind === 'description') setMemberName(String(next.row.name || ''));
    else if (next?.kind === 'class') setMemberName('');
  };
  const introduce = (event) => {
    event.preventDefault();
    if (!ready) return;
    if (selected.kind === 'principal') {
      setSubmittedMember({ id: selected.row.id, kind: 'principal' });
      action.submit('introduce_actor', { channelId: channel?.id, candidateType: 'principal', candidateId: selected.row.id });
      return;
    }
    setSubmittedMember({ name: trimmedName, kind: selected.kind });
    action.submit('introduce_actor', {
      channelId: channel?.id,
      candidateType: selected.kind,
      candidateId: selected.kind === 'class' ? className.trim() : selected.row.id,
      name: trimmedName,
    }, { submitted: '成员条目已写进频道描述；成员构建好后出现在名册里，构建结果在成员详情和时间线上。' });
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
        // 没就绪的成员说出是哪一层、为什么；就绪的行保持原样。
        const issue = memberLayerIssue(row);
        const [runtimeState, runtimeLabel] = issue ? [`layer-${issue.state}`, issue.label] : actorRuntime(row);
        const ownerActor = row.principal && row.principal === channel?.owner_principal;
        const canRestart = typeof restartCommand === 'function' && row.kind !== 'human' && !ownerActor;
        const canBind = typeof bindCommand === 'function' && row.bound === false;
        const canUnbind = typeof unbindCommand === 'function' && row.bound === true;
        return <div className="managed-actor" key={row.id}>
          <div><strong>{actorDisplayName(row)}{row.id === port.selfId && <em>我</em>}</strong><small>{row.kind || 'actor'}{row.principal ? ` · principal ${row.principal}` : ''}{row.body ? ` · ${row.body}` : ''} · {row.id}</small>{issue && <small className={`member-layer-issue layer-${issue.state}`} title={issue.text}>{issue.text}</small>}</div>
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
      <p className="protected-note">运行时自己生成的成员（服务门、peer、handle）不在频道描述里，已隐藏。</p>
      {!hasLifecycleCommands && <p className="protected-note">当前治理端口未提供绑定或重启命令；这里仅展示目录事实、查看与已有移除入口。</p>}
    </PanelCard>
    <PanelCard as="form" className="governance-form" title="添加参与者" onSubmit={introduce}>
      <p>人直接邀请进来；Agent 和工具是在频道描述里写一个成员条目：从一个 Actor 描述（名字@版本）或直接从一个 Class 造。</p>
      <label>参与者<SelectMenu ariaLabel="选择参与者" placeholder="搜索用户或 Actor 描述" value={candidate} options={candidates} onChange={choose} /></label>
      {selected && selected.kind !== 'class' && <div className="participant-selection" role="status" data-participant-id={selected.row.id} data-participant-kind={selected.participantKind}><span>{selected.kind === 'principal' ? '用户' : 'Actor 描述'}</span><strong>{selected.row.display_name || selected.row.email || selected.row.id}</strong><small>{selected.kind === 'principal' ? selected.row.id : `class ${selected.row.class || '?'}${selected.row.description ? ` · ${selected.row.description}` : ''}`}</small></div>}
      {selected?.kind === 'class' && <label>Class<input aria-label="成员 Class" value={className} onChange={(event) => setClassName(event.target.value)} placeholder="例如 claude、codex" /></label>}
      {needsName && <label>成员名<input aria-label="成员名" value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="在这个频道里叫什么" /></label>}
      {nameError && <small className="field-error">{nameError}</small>}
      <button className="primary-button" type="submit" disabled={port.disabled || action.busy || !ready}>添加到频道</button>
    </PanelCard>
    {confirm && <InlineConfirmation title={`确认${confirm.kind === 'restart' ? '重启' : '移除'} ${actorDisplayName(confirm.row)}？`} description={confirm.kind === 'restart' ? '重启结果以账本和 presence 收敛为准；当前页面不会猜测成功。' : '成员条目会从频道描述里删掉，它这一台的配置一起删；该操作通过频道治理命令提交，最终状态以频道事实为准。'} tone="danger" onCancel={() => setConfirm(null)} onConfirm={confirmActor} />}
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

const CREATE_STARTS = Object.freeze([
  ['blank', '空白', '从一份空描述开始，之后再加成员'],
  ['copy', '复制一个频道', '照抄另一个频道的描述（成员条目、服务、说明、设备）；被复制频道的成员配置不跟过来'],
  ['pick', '从本频道挑成员', '把本频道描述里的几个成员条目抄进新频道'],
]);

// The rail entry is a real modal owned by GovernanceFeature. The command,
// channel directory and access projection remain the existing Workspace
// owners; this component only keeps the local request and renders their
// convergence without a second store or a private protocol API.
export function ChannelCreateModal({ channel, port = {}, onClose, returnFocusRef = null }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [start, setStart] = useState('blank');
  const [copyFrom, setCopyFrom] = useState('');
  const [entries, setEntries] = useState(null);
  const [entriesError, setEntriesError] = useState('');
  const [readingEntries, setReadingEntries] = useState(false);
  const [pickedNames, setPickedNames] = useState([]);
  const [humanIds, setHumanIds] = useState([]);
  const [createRequest, setCreateRequest] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const commands = port.commands || {};
  const children = Array.isArray(port.children) ? port.children : [];
  const validation = validateChannelName(name);
  const convergence = creationConvergence(channel, children, createRequest, port.creation);
  const tracking = Boolean(createRequest && !convergence?.ready && !convergence?.failed);
  const locked = port.disabled || submitting || tracking || convergence?.ready;
  const parentName = displayChannelName(channel);
  const shellEnter = typeof commands.enterChannel === 'function';
  const copyable = (Array.isArray(port.copyableChannels) ? port.copyableChannels : [])
    .map((row) => ({ value: row.id, label: row.qualified_name || row.name || row.id }));
  const humans = (Array.isArray(port.principals) ? port.principals : [])
    .map((entry) => entry?.declared || entry)
    .filter(eligiblePrincipal);
  const selectedHumans = humanIds.filter((id) => humans.some((row) => row.id === id));
  const picked = (entries || []).filter((entry) => pickedNames.includes(entry.name));
  const startReady = start === 'blank' || (start === 'copy' && copyFrom) || (start === 'pick' && picked.length > 0);

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

  // 挑成员要先读本频道的描述：一次真人点击发一条 system.channel.description.get。
  async function readEntries() {
    if (typeof commands.readDescription !== 'function') {
      setEntriesError('当前会话不能读取频道描述');
      return;
    }
    setReadingEntries(true);
    setEntriesError('');
    try {
      const value = await commands.readDescription(channel?.id);
      const members = Array.isArray(value?.body?.members) ? value.body.members : [];
      setEntries(members.filter((entry) => entry?.name));
    } catch (failure) {
      setEntriesError(errorMessage(failure));
    } finally {
      setReadingEntries(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const normalized = String(name || '').trim();
    const nameError = validateChannelName(normalized);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (!startReady) {
      setError(start === 'copy' ? '请选择要复制的频道' : '请至少挑一个成员条目');
      return;
    }
    if (typeof commands.submit !== 'function') {
      setError('频道治理命令不可用');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const messageId = await commands.submit({
        scope: 'channel',
        action: 'create_child',
        payload: {
          name: normalized,
          parentId: channel?.id,
          humans: selectedHumans,
          ...(start === 'copy'
            ? { copyFrom }
            : {
              purpose: String(purpose || '').trim(),
              ...(start === 'pick' ? { members: picked } : {}),
            }),
        },
      });
      if (!messageId) throw new Error('创建命令没有返回可追踪的请求编号');
      setCreateRequest({ id: String(messageId), name: normalized });
    } catch (failure) {
      setError(errorMessage(failure));
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
        <fieldset className="channel-create-start" disabled={locked}>
          <legend>起点</legend>
          {CREATE_STARTS.map(([value, label, hint]) => <label key={value} className="channel-create-start-option">
            <input type="radio" name="channel-create-start" aria-label={`起点 ${label}`} value={value} checked={start === value} onChange={() => setStart(value)} />
            <div><strong>{label}</strong><small>{hint}</small></div>
          </label>)}
        </fieldset>
        {start !== 'copy' && <label><span>说明</span><input aria-label="频道用途" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="这个频道用于什么" disabled={locked} /></label>}
        {start === 'copy' && <>
          <label><span>复制哪个频道</span><SelectMenu ariaLabel="复制的频道" value={copyFrom} options={copyable} onChange={setCopyFrom} disabled={locked} /></label>
          {!copyable.length && <small className="field-hint">你还不是任何可复制频道的成员。</small>}
          <small className="field-hint">说明随被复制频道的描述一起过来，创建后可在频道设置里改。</small>
        </>}
        {start === 'pick' && <section className="channel-create-members" aria-labelledby="channel-create-entries-title">
          <header><strong id="channel-create-entries-title">成员条目</strong><button type="button" className="text-button" disabled={locked || readingEntries} onClick={readEntries}>{readingEntries ? '读取中…' : entries ? '重新读取' : `读取 ${parentName} 的成员条目`}</button></header>
          {entriesError && <p className="governance-error" role="alert">{entriesError}</p>}
          {entries && !entries.length && <small className="field-hint">本频道的描述里还没有成员条目。</small>}
          {(entries || []).map((entry) => <label className="channel-create-member" key={entry.name}>
            <input
              type="checkbox"
              aria-label={`抄成员条目 ${entry.name}`}
              checked={pickedNames.includes(entry.name)}
              disabled={locked}
              onChange={(event) => setPickedNames((current) => (
                event.target.checked ? [...new Set([...current, entry.name])] : current.filter((value) => value !== entry.name)
              ))}
            />
            <div><strong>{entry.name}</strong><small>{entry.body?.actor ? `actor ${entry.body.actor}` : `class ${entry.body?.class || '?'}`}</small></div>
          </label>)}
          <small className="field-hint">抄的是条目（从什么造、参数）；这些成员在新频道里各自的配置从空开始。</small>
        </section>}
        <section className="channel-create-members" aria-labelledby="channel-create-humans-title">
          <header><strong id="channel-create-humans-title">带进来的人</strong><small>你会自动加入，也可以带上别的用户</small></header>
          {port.selfId && <div className="channel-create-member pinned"><span>✓</span><div><strong>我</strong><small>{port.selfId}</small></div></div>}
          {humans.map((row) => <label className="channel-create-member" key={row.id}>
            <input
              type="checkbox"
              aria-label={`带上用户 ${row.display_name || row.email || row.id}`}
              checked={selectedHumans.includes(row.id)}
              disabled={locked}
              onChange={(event) => setHumanIds((current) => (
                event.target.checked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id)
              ))}
            />
            <div><strong>{row.display_name || row.email || row.id}</strong><small>用户 · {row.id}</small></div>
          </label>)}
          {!humans.length && <small className="field-hint">目录里没有别的用户。</small>}
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
          {convergence.ready && <p className="ready-message">{shellEnter ? '频道已经可以打开和协作。成员的构建结果在频道设置和时间线上。' : '频道已经就绪，但 Shell navigation port 尚未连接。'}</p>}
        </section>}
        <footer>
          <button type="button" onClick={onClose} disabled={submitting}>取消</button>
          {convergence?.ready
            ? <button type="button" className="primary-button" disabled={!shellEnter} title={shellEnter ? '' : 'Shell navigation port 尚未连接'} onClick={enterChannel}>进入新频道</button>
            : convergence?.failed
              ? <button type="button" className="primary-button" onClick={retryCreate}>重新创建</button>
            : <button type="submit" className="primary-button" disabled={locked || Boolean(validation) || !startReady}>{submitting ? '正在提交…' : tracking ? '等待频道就绪…' : '创建频道'}</button>}
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
  return <SidePanel className="channel-governance" ariaLabel="频道治理" eyebrow="CHANNEL CONTEXT" title="频道详情" tabs={[{ id: 'members', label: '成员' }, { id: 'overview', label: '设置' }, { id: 'danger', label: '危险操作' }]} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    <OperationState operation={port.operation} terminal onRefresh={refreshOperation} onReenter={reenterChannel} />
    <div hidden={tab !== 'overview'}><ChannelSettings channel={channel} port={port} /></div>
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

function parseParams(text) {
  const value = JSON.parse(String(text || '').trim() || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('参数必须是 JSON 对象');
  return value;
}

// Actor 描述：不可变的 名字@版本。新建同名的就是下一个版本；退役只让它不能再被
// 新成员引用，已经引用它的成员照旧。
function SpaceActorDescriptions({ port }) {
  const action = useCommand(port.commands, 'space');
  const [name, setName] = useState('');
  const [klass, setKlass] = useState('');
  const [description, setDescription] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [formError, setFormError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const rows = Array.isArray(port.actorDescriptions) ? port.actorDescriptions : [];
  const groups = new Map();
  for (const row of rows) {
    if (!row?.name) continue;
    if (!groups.has(row.name)) groups.set(row.name, []);
    groups.get(row.name).push(row);
  }
  const names = [...groups.keys()].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const nextVersion = (groups.get(name.trim()) || []).reduce((highest, row) => Math.max(highest, Number(row.version || 0)), 0) + 1;
  const refresh = typeof port.commands?.refresh === 'function' ? () => port.commands.refresh() : undefined;
  const create = async (event) => {
    event.preventDefault();
    setFormError('');
    let params;
    try { params = parseParams(paramsText); }
    catch (failure) { setFormError(errorMessage(failure)); return; }
    const reply = await action.submit('actor_description_create', { name: name.trim(), class: klass.trim(), description, params }, { submitted: 'Actor 描述已新建。' });
    if (reply) { setDescription(''); setParamsText('{}'); }
  };
  const retire = async () => {
    const row = confirm;
    setConfirm(null);
    if (row) await action.submit('actor_description_retire', { name: row.name, version: row.version }, { submitted: `${actorDescriptionRef(row)} 已退役。` });
  };
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <OperationState operation={action.operation} />
    <PanelCard title="Actor 描述" titleMeta={String(rows.length)} action={refresh && <button type="button" className="text-button" disabled={action.busy} onClick={refresh}>刷新</button>}>
      {port.actorDescriptionsUnavailable && <p className="governance-error" role="status">Actor 描述目录当前不可用。</p>}
      {names.map((entryName) => {
        const versions = [...groups.get(entryName)].sort((left, right) => Number(right.version) - Number(left.version));
        return <section className="actor-description" key={entryName} aria-label={`Actor 描述 ${entryName}`}>
          <header><strong>{entryName}</strong><small>{versions.length} 个版本</small></header>
          {versions.map((row) => <div className={`actor-description-version status-${row.status || 'present'}`} key={actorDescriptionRef(row)} data-ref={actorDescriptionRef(row)}>
            <div>
              <strong>{actorDescriptionRef(row)}</strong>
              <small>class {row.class || '?'} · {row.status === 'retired' ? '已退役' : '可用'}{row.owner ? ` · ${row.owner}` : ''}</small>
              {row.description && <p>{row.description}</p>}
              {row.params && Object.keys(row.params).length > 0 && <details><summary>参数</summary><pre>{JSON.stringify(row.params, null, 2)}</pre></details>}
            </div>
            {row.status !== 'retired' && <button type="button" className="danger-text" disabled={port.disabled || action.busy} onClick={() => setConfirm(row)}>退役</button>}
          </div>)}
        </section>;
      })}
      {!names.length && <p className="governance-empty">还没有 Actor 描述。</p>}
    </PanelCard>
    <PanelCard as="form" className="governance-form" title="新建 Actor 描述" onSubmit={create}>
      <p>同名再建就是它的下一个版本；已有版本不会被改。</p>
      <label>名字<input aria-label="Actor 描述名字" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 research-claude" /></label>
      {name.trim() && <small className="field-hint">将建成 {name.trim()}@{nextVersion}</small>}
      <label>Class<input aria-label="Actor 描述 Class" value={klass} onChange={(event) => setKlass(event.target.value)} placeholder="例如 claude" /></label>
      <label>说明<input aria-label="Actor 描述说明" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>参数 JSON<textarea aria-label="Actor 描述参数 JSON" rows="6" spellCheck={false} value={paramsText} onChange={(event) => setParamsText(event.target.value)} /></label>
      <small className="field-hint">值写 <code>"$required:说明"</code> 表示要由用到它的成员在自己的配置里填；写 <code>"$global.名称"</code> 引用全局 key。</small>
      {formError && <p className="field-error" role="alert">{formError}</p>}
      <button type="submit" className="primary-button" disabled={port.disabled || action.busy || !name.trim() || !klass.trim()}>新建</button>
    </PanelCard>
    {confirm && <InlineConfirmation title={`退役 ${actorDescriptionRef(confirm)}？`} description="退役后新成员不能再引用这个版本；已经引用它的成员照旧运行。" tone="danger" onCancel={() => setConfirm(null)} onConfirm={retire} />}
  </>;
}

function SpaceDevices({ port }) {
  const action = useCommand(port.commands, 'space');
  const [name, setName] = useState('');
  const refreshDevices = typeof port.commands?.refresh === 'function'
    ? () => port.commands.refresh('devices')
    : undefined;
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <OperationState operation={action.operation} />
    <PanelCard className="governance-form" title="创建设备身份">
      <label>设备名称<input aria-label="设备名称" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button type="button" className="primary-button" disabled={port.disabled || action.busy || !name.trim()} onClick={() => action.submit('create_device', { name }, { submitted: '设备已创建。' })}>创建设备</button>
    </PanelCard>
    <PanelCard title="空间设备列表" action={refreshDevices && <button type="button" className="text-button" disabled={action.busy} onClick={refreshDevices}>刷新</button>}>
      <p className="governance-empty">把设备挂到某个频道，在那个频道的「频道详情 → 设置」里做。</p>
      {(port.devices || []).map((row) => <div className="device-row" key={row.id}><div><strong>{row.name || row.id}</strong><small>{row.id} · {row.online === true ? '在线' : row.online === false ? '离线' : '未知'}</small></div><div><button type="button" className="danger-text" disabled={port.disabled || action.busy || row.protected || row.id === LOCAL_DEVICE_ID} onClick={() => action.submit('retire_device', { deviceId: row.id }, { submitted: '设备已退役。' })}>退役</button></div></div>)}
      {!port.devices?.length && <p className="governance-empty">当前空间目录没有可展示的设备。</p>}
    </PanelCard>
  </>;
}

export function SpaceAdministrationPanel({ port = {}, onClose }) {
  const [tab, setTab] = useState('actor_descriptions');
  const tabs = [{ id: 'actor_descriptions', label: 'Actor 描述' }, { id: 'devices', label: '设备' }, { id: 'global_keys', label: '全局 key' }];
  // 全局 key 走资源面，不走空间治理结果投影；那条"不支持"的说明只属于其余几页。
  const governanceTab = tab !== 'global_keys';
  return <SidePanel className="space-administration" ariaLabel="空间管理" eyebrow="SPACE CONTROL" title="空间管理" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    {governanceTab && port.unsupported && <p className="governance-error" role="status">{port.unsupported}</p>}
    {tab === 'actor_descriptions' && <SpaceActorDescriptions port={port} />}
    {tab === 'devices' && <SpaceDevices port={port} />}
    {tab === 'global_keys' && <GlobalKeysPanel port={port.globalKeys} />}
  </SidePanel>;
}
