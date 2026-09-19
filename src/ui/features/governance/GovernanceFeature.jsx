import React, { useEffect, useState } from 'react';
import { actorDisplayName } from '../../../model/actor-display.js';
import { InlineConfirmation } from '../../primitives/InlineConfirmation.jsx';
import { PanelCard } from '../../primitives/PanelCard.jsx';
import { SelectMenu } from '../../primitives/SelectMenu.jsx';
import { SidePanel } from '../../primitives/SidePanel.jsx';

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

function OperationState({ operation }) {
  if (!operation) return null;
  return <p className={`operation-state state-${operation.state || 'pending'}`} role="status">{operation.message || '命令已提交'}</p>;
}

function ChannelOverview({ channel, port }) {
  const [description, setDescription] = useState(channel?.description || '');
  const [child, setChild] = useState({ name: '', purpose: '', templateId: '' });
  const action = useCommand(port.commands, 'channel');
  useEffect(() => setDescription(channel?.description || ''), [channel?.description, channel?.id]);
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <OperationState operation={action.operation} />
    {port.candidatesUnavailable && <p className="governance-error" role="status">成员候选目录当前不可用；已有名册仍可查看和刷新。</p>}
    <PanelCard className="governance-form" title="频道资料"><label>频道 ID<input readOnly value={channel?.id || ''} /></label><label>说明<textarea rows="3" value={description} onChange={(event) => setDescription(event.target.value)} /></label><button type="button" className="primary-button" disabled={port.disabled || action.busy} onClick={() => action.submit('update_profile', { channelId: channel?.id, description }, { refresh: 'directory', submitted: '频道资料已进入提交队列，并已请求目录刷新；最终以账本与目录投影为准。' })}>保存频道资料</button></PanelCard>
    <PanelCard className="governance-form" title="创建子频道"><label>名称<input value={child.name} onChange={(event) => setChild({ ...child, name: event.target.value })} /></label><label>用途<textarea rows="3" value={child.purpose} onChange={(event) => setChild({ ...child, purpose: event.target.value })} /></label><label>频道模板<SelectMenu ariaLabel="频道模板" value={child.templateId} options={(port.space?.channelTemplates || []).map((row) => ({ value: row.id, label: row.name || row.id }))} onChange={(templateId) => setChild({ ...child, templateId })} /></label><button type="button" className="primary-button" disabled={port.disabled || action.busy || !child.name.trim()} onClick={() => action.submit('create_child', { ...child, parentId: channel?.id }, { refresh: 'directory', submitted: '子频道创建已进入提交队列，并已请求目录刷新；最终以账本与目录投影为准。' })}>创建子频道</button></PanelCard>
    <PanelCard title="子频道" action={<button type="button" className="text-button" disabled={action.busy} onClick={() => port.commands?.refresh?.('directory')}>刷新</button>}>{(port.children || []).map((row) => <div className="device-row" key={row.id}><div><strong>{row.name || row.id}</strong><small>{row.id} · {row.status || 'present'}</small></div></div>)}{!port.children?.length && <p className="governance-empty">没有子频道。</p>}</PanelCard>
  </>;
}

function ChannelMembers({ channel, port }) {
  const [candidate, setCandidate] = useState('');
  const [confirm, setConfirm] = useState(null);
  const action = useCommand(port.commands, 'channel');
  const candidates = [
    ...(port.principals || []).map((row) => ({ value: `principal:${row.id}`, label: `${row.display_name || row.email || row.id} · 用户`, row, kind: 'principal' })),
    ...(port.declarations || []).map((row) => ({ value: `declaration:${row.id}`, label: `${row.name || row.id} · 声明`, row, kind: 'declaration' })),
  ];
  const selected = candidates.find((row) => row.value === candidate);
  return <>
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    <PanelCard className="governance-form" title="引入成员"><label>用户或声明<SelectMenu ariaLabel="待引入成员" value={candidate} options={candidates} onChange={setCandidate} /></label><button type="button" className="primary-button" disabled={port.disabled || !selected} onClick={() => action.submit('introduce_actor', { channelId: channel?.id, candidateType: selected?.kind, candidateId: selected?.row.id })}>引入</button></PanelCard>
    <PanelCard title="频道成员" action={<button type="button" className="text-button" onClick={() => port.commands?.refresh?.('members')}>刷新</button>}>
      {(port.roster || []).map((row) => <div className="device-row" key={row.id}><div><strong>{actorDisplayName(row)}</strong><small>{row.id} · {row.kind || 'actor'}</small></div><div><button type="button" onClick={() => port.commands?.selectActor?.(row)}>详情</button><button type="button" className="danger-text" disabled={port.disabled || row.id === port.selfId || row.protected} onClick={() => setConfirm(row)}>移除</button></div></div>)}
    </PanelCard>
    {confirm && <InlineConfirmation title={`确认移除 ${actorDisplayName(confirm)}？`} description="该操作将通过频道治理命令提交，最终状态以频道事实为准。" tone="danger" onCancel={() => setConfirm(null)} onConfirm={() => { action.submit('remove_actor', { channelId: channel?.id, actorId: confirm.id }); setConfirm(null); }} />}
  </>;
}

function ChannelDanger({ channel, port }) {
  const [confirmation, setConfirmation] = useState('');
  const action = useCommand(port.commands, 'channel');
  const expected = channel?.qualified_name || channel?.name || channel?.id || '';
  return <PanelCard className="danger-zone" title="退役频道">
    {action.error && <p className="governance-error" role="alert">{action.error}</p>}
    {channel?.id === 'c0' ? <p>空间根频道受保护，不能退役。</p> : <><p>退役会停止频道写入；前端不会删除已有账本或文件。</p><label>输入 <strong>{expected}</strong> 确认<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button type="button" className="danger-button" disabled={port.disabled || confirmation !== expected} onClick={() => action.submit('retire', { channelId: channel?.id })}>退役当前频道</button></>}
  </PanelCard>;
}

export function ChannelAdministrationPanel({ channel, port = {}, onClose }) {
  const [tab, setTab] = useState('overview');
  return <SidePanel className="channel-governance" ariaLabel="频道治理" eyebrow="CHANNEL CONTROL" title="频道治理" tabs={[{ id: 'overview', label: '概览' }, { id: 'members', label: '成员' }, { id: 'danger', label: '危险操作' }]} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    <OperationState operation={port.operation} />
    {tab === 'overview' && <ChannelOverview channel={channel} port={port} />}
    {tab === 'members' && <ChannelMembers channel={channel} port={port} />}
    {tab === 'danger' && <ChannelDanger channel={channel} port={port} />}
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
  return <>{action.error && <p className="governance-error" role="alert">{action.error}</p>}<PanelCard className="governance-form" title="创建设备身份"><label>设备名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><button type="button" className="primary-button" disabled={port.disabled || !name.trim()} onClick={() => action.submit('create_device', { name })}>创建设备</button></PanelCard><PanelCard title="空间设备列表">{(port.devices || []).map((row) => <div className="device-row" key={row.id}><div><strong>{row.name || row.id}</strong><small>{row.id} · {row.online === true ? '在线' : row.online === false ? '离线' : '未知'} · {row.attached ? '已绑定' : '未绑定'}</small></div><div><button type="button" disabled={port.disabled || row.attached} onClick={() => action.submit('attach_device', { channelId: channel?.id, deviceId: row.id })}>绑定当前频道</button><button type="button" disabled={port.disabled || !row.attached} onClick={() => action.submit('detach_device', { channelId: channel?.id, deviceId: row.id })}>解绑</button><button type="button" className="danger-text" disabled={port.disabled || row.protected} onClick={() => action.submit('retire_device', { deviceId: row.id })}>退役</button></div></div>)}</PanelCard></>;
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
