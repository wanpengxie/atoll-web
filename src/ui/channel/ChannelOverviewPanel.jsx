import React, { useState } from 'react';
import { createChannelCommand, creationConvergence, GOVERNANCE_TYPES, registryCommand, validateChannelName } from '../../model/channel-governance.js';
import { isMemberAccess } from '../../model/channel-access.js';
import { PanelCard } from '../primitives/PanelCard.jsx';

const STEP_LABELS = [
  ['ledger', '账本确认'],
  ['observable', '频道可观察'],
  ['membership', '成员关系'],
  ['serving', '服务就绪'],
];

export function ChannelOverviewPanel({ channel, channels, roster, selfId = '', state, disabled, onSubmit, mode = 'manage' }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [template, setTemplate] = useState('');
  const [createRequest, setCreateRequest] = useState(null);
  const [error, setError] = useState('');
  const childChannels = channels.filter((row) => row.parent_id === channel?.id);
  const expectedName = createRequest ? `${channel.qualified_name || channel.id}.${createRequest.name}` : '';
  const convergence = createRequest ? creationConvergence({
    turn: state.turns.get(createRequest.id), expectedQualifiedName: expectedName, channels,
    membership: (id) => isMemberAccess(channels.find((row) => row.id === id)?.access),
  }) : null;

  async function run(command, after) {
    setError('');
    try {
      const id = await onSubmit(command);
      after?.(id);
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  async function create(event) {
    event.preventDefault();
    const validation = validateChannelName(name);
    if (validation) { setError(validation); return; }
		if (!selfId) { setError('尚未确认你在当前频道中的 Actor 身份'); return; }
    await run(createChannelCommand({ parentId: channel.id, name, purpose, recipe: template || null, initialActorIds: [selfId], roster }), (id) => setCreateRequest({ id, name: name.trim() }));
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    {mode === 'manage' && <PanelCard className="channel-facts">
      <header><h3>{channel.qualified_name || channel.name}</h3><span className={channel.open ? 'fact-ok' : 'fact-warn'}>{channel.open ? '服务中' : '未服务'}</span></header>
      <dl><dt>ID</dt><dd>{channel.id}</dd><dt>父级</dt><dd>{channel.parent_id || '无（空间根）'}</dd><dt>Owner</dt><dd>{channel.owner_principal || '—'}</dd><dt>状态</dt><dd>{channel.status || 'present'}</dd></dl>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => run(registryCommand({ channelId: channel.id, type: GOVERNANCE_TYPES.get, payload: { channel_id: channel.id }, roster }))}>读取完整详情到账本</button>
    </PanelCard>}
    {mode === 'manage' && <PanelCard title="子频道" titleMeta={String(childChannels.length)}>
      {childChannels.map((child) => <div className="child-channel" key={child.id}><span># {child.name}</span><small>{child.open ? '服务中' : '等待服务'}</small></div>)}
      {!childChannels.length && <p className="governance-empty">还没有子频道</p>}
    </PanelCard>}
    {mode === 'create' && <PanelCard as="form" className="governance-form" title="频道信息" onSubmit={create}>
      <p>将在 <strong>{channel.qualified_name || channel.name || channel.id}</strong> 下创建子频道；请求和最终状态都会写入当前账本。</p>
      <label>频道名称<input aria-label="新频道名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 backend" /></label>
      <label>用途<input aria-label="频道用途" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="这个频道用于什么" /></label>
      <label>模板 ID（可选）<input aria-label="频道模板 ID" value={template} onChange={(event) => setTemplate(event.target.value)} placeholder="已登记的 channel template ID" /></label>
      <button className="primary-button" type="submit" disabled={disabled || Boolean(validateChannelName(name))}>创建频道</button>
    </PanelCard>}
    {mode === 'create' && convergence && <PanelCard className="convergence" aria-label="频道创建进度" title={`${createRequest.name} 创建进度`}>
      {STEP_LABELS.map(([key, label]) => <div key={key} className={convergence[key] ? 'done' : 'waiting'}><span>{convergence[key] ? '✓' : '·'}</span><strong>{label}</strong><small>{convergence[key] ? '已确认' : '等待投影'}</small></div>)}
      {convergence.failed && <p className="governance-error">账本失败：{convergence.error}</p>}
      {convergence.ready && <p className="ready-message">频道已经可以打开和协作。</p>}
    </PanelCard>}
  </>;
}
