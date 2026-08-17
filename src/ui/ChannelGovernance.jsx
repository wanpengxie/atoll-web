import React, { useMemo, useState } from 'react';
import { actorCommand, actorConvergence, createChannelCommand, creationConvergence, GOVERNANCE_TYPES, isProtectedActor, registryCommand, usableDeclarations, usablePrincipals, validateChannelName } from '../model/channel-governance.js';
import { isMemberAccess } from '../model/channel-access.js';

const STEP_LABELS = [
  ['ledger', '账本确认'],
  ['observable', '频道可观察'],
  ['membership', '成员关系'],
  ['serving', '服务就绪'],
];

function actorLabel(row) {
  return row.name || row.principal || row.id;
}

export function ChannelGovernance({ channel, channels, roster, state, principals, declarations, disabled, onSubmit, onRefresh, onClose }) {
  const [section, setSection] = useState('overview');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [template, setTemplate] = useState('');
  const [createRequest, setCreateRequest] = useState(null);
  const [kind, setKind] = useState('human');
  const [principal, setPrincipal] = useState('');
  const [declId, setDeclId] = useState('');
  const [agentPrincipal, setAgentPrincipal] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [retireText, setRetireText] = useState('');
  const [formError, setFormError] = useState('');
  const [actorRequest, setActorRequest] = useState(null);

  const principalRows = useMemo(() => usablePrincipals(principals, roster), [principals, roster]);
  const declarationRows = useMemo(() => usableDeclarations(declarations, kind), [declarations, kind]);
  const childChannels = channels.filter((row) => row.parent_id === channel?.id);
  const expectedName = createRequest ? `${channel.qualified_name || channel.id}.${createRequest.name}` : '';
  const convergence = createRequest ? creationConvergence({
    turn: state.turns.get(createRequest.id), expectedQualifiedName: expectedName, channels,
    membership: (id) => isMemberAccess(channels.find((row) => row.id === id)?.access),
  }) : null;
  const actorProgress = actorRequest ? actorConvergence({ turn: state.turns.get(actorRequest.id), type: actorRequest.type, actorId: actorRequest.actorId, roster }) : null;

  const submit = async (command, after) => {
    setFormError('');
    try {
      const id = await onSubmit(command);
      after?.(id);
    } catch (error) {
      setFormError(error.message || String(error));
    }
  };

  const create = async (event) => {
    event.preventDefault();
    const error = validateChannelName(name);
    if (error) { setFormError(error); return; }
    const command = createChannelCommand({ parentId: channel.id, name, purpose, template, roster });
    await submit(command, (id) => setCreateRequest({ id, name: name.trim() }));
  };

  const introduce = async (event) => {
    event.preventDefault();
    let payload;
    if (kind === 'human') payload = { kind, principal };
    else payload = { kind, decl_id: declId, ...(kind === 'agent' && agentPrincipal ? { principal: agentPrincipal } : {}) };
    if ((kind === 'human' && !principal) || (kind !== 'human' && !declId)) { setFormError('请选择要添加的 principal 或声明'); return; }
    await submit(actorCommand({ channelId: channel.id, type: GOVERNANCE_TYPES.introduce, payload, roster }), (id) => {
      setActorRequest({ id, type: GOVERNANCE_TYPES.introduce, actorId: '' });
      setPrincipal(''); setDeclId(''); setAgentPrincipal('');
    });
  };

  const performConfirmed = async () => {
    if (!confirmAction) return;
    const command = actorCommand({ channelId: channel.id, type: confirmAction.type, payload: { instance_id: confirmAction.actor.id }, roster });
    await submit(command, (id) => { setActorRequest({ id, type: confirmAction.type, actorId: confirmAction.actor.id }); setConfirmAction(null); });
  };

  const retire = async () => {
    if (retireText !== (channel.qualified_name || channel.name || channel.id)) return;
    await submit(registryCommand({ channelId: channel.id, type: GOVERNANCE_TYPES.retire, payload: { channel_id: channel.id }, roster }), () => setRetireText(''));
  };

  return (
    <aside className="governance-panel" aria-label={`频道管理 ${channel?.qualified_name || channel?.id}`}>
      <header>
        <div><p className="eyebrow">CHANNEL CONTROL</p><h2>频道管理</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭频道管理">×</button>
      </header>
      <nav aria-label="频道管理区域">
        {[['overview', '概览'], ['members', '成员'], ['danger', '危险操作']].map(([id, label]) => (
          <button type="button" key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>
        ))}
      </nav>
      <div className="governance-scroll">
        {formError && <p className="governance-error" role="alert">{formError}</p>}
        {section === 'overview' && <>
          <section className="governance-card channel-facts">
            <header><h3>{channel.qualified_name || channel.name}</h3><span className={channel.open ? 'fact-ok' : 'fact-warn'}>{channel.open ? '服务中' : '未服务'}</span></header>
            <dl><dt>ID</dt><dd>{channel.id}</dd><dt>父级</dt><dd>{channel.parent_id || '无（空间根）'}</dd><dt>Owner</dt><dd>{channel.owner_principal || '—'}</dd><dt>状态</dt><dd>{channel.status || 'present'}</dd></dl>
            <button type="button" className="secondary-button" disabled={disabled} onClick={() => submit(registryCommand({ channelId: channel.id, type: GOVERNANCE_TYPES.get, payload: { channel_id: channel.id }, roster }))}>读取完整详情到账本</button>
          </section>
          <section className="governance-card">
            <h3>子频道 <small>{childChannels.length}</small></h3>
            {childChannels.map((child) => <div className="child-channel" key={child.id}><span># {child.name}</span><small>{child.open ? '服务中' : '等待服务'}</small></div>)}
            {!childChannels.length && <p className="governance-empty">还没有子频道</p>}
          </section>
          <form className="governance-card governance-form" onSubmit={create}>
            <h3>创建子频道</h3>
            <p>父级固定为当前频道；创建请求和最终状态都会写入当前账本。</p>
            <label>频道名称<input aria-label="新频道名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 backend" /></label>
            <label>用途<input aria-label="频道用途" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="这个频道用于什么" /></label>
            <label>模板 ID（可选）<input aria-label="频道模板 ID" value={template} onChange={(event) => setTemplate(event.target.value)} placeholder="已登记的 channel template ID" /></label>
            <button className="primary-button" type="submit" disabled={disabled || Boolean(validateChannelName(name))}>创建频道</button>
          </form>
          {convergence && <section className="governance-card convergence" aria-label="频道创建进度">
            <h3>{createRequest.name} 创建进度</h3>
            {STEP_LABELS.map(([key, label]) => <div key={key} className={convergence[key] ? 'done' : 'waiting'}><span>{convergence[key] ? '✓' : '·'}</span><strong>{label}</strong><small>{convergence[key] ? '已确认' : '等待投影'}</small></div>)}
            {convergence.failed && <p className="governance-error">账本失败：{convergence.error}</p>}
            {convergence.ready && <p className="ready-message">频道已经可以打开和协作。</p>}
          </section>}
        </>}

        {section === 'members' && <>
          <section className="governance-card">
            <header><h3>当前成员与 Actor</h3><button type="button" className="text-button" onClick={onRefresh}>刷新</button></header>
            {roster.filter((row) => !isProtectedActor(row)).map((row) => {
              const ownerActor = row.principal && row.principal === channel.owner_principal;
              return <div className="managed-actor" key={row.id}>
              <div><strong>{actorLabel(row)}</strong><small>{row.kind}{row.principal ? ` · principal ${row.principal}` : ''} · {row.id}</small></div>
              <span className={row.deviceOnline === true ? 'actor-runtime online' : row.bound === true ? 'actor-runtime bound' : 'actor-runtime waiting'}>{row.deviceOnline === true ? '在线' : row.bound === true ? '已绑定' : row.bound === false ? '未绑定' : '等待状态'}</span>
              <button type="button" disabled={disabled || row.kind === 'human' || ownerActor} onClick={() => setConfirmAction({ type: GOVERNANCE_TYPES.restart, actor: row })}>重启</button>
              <button type="button" className="danger-text" disabled={disabled || ownerActor} onClick={() => setConfirmAction({ type: GOVERNANCE_TYPES.remove, actor: row })}>{ownerActor ? 'Owner' : '移除'}</button>
            </div>;
            })}
            {!roster.some((row) => !isProtectedActor(row)) && <p className="governance-empty">暂无可管理的业务 Actor</p>}
            <p className="protected-note">标准系统 Actor 与维持频道关系的 foundation Actor 已隐藏并受后端保护。</p>
          </section>
          <form className="governance-card governance-form" onSubmit={introduce}>
            <h3>添加参与者</h3>
            <div className="kind-switch">{['human', 'agent', 'tool'].map((value) => <button type="button" key={value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setDeclId(''); }}>{value}</button>)}</div>
            {kind === 'human' ? <label>Principal<select aria-label="选择 Principal" value={principal} onChange={(event) => setPrincipal(event.target.value)}><option value="">选择用户</option>{principalRows.map((row) => <option key={row.id} value={row.id}>{row.display_name || row.email || row.id}</option>)}</select></label>
              : <><label>Actor 声明<select aria-label="选择 Actor 声明" value={declId} onChange={(event) => setDeclId(event.target.value)}><option value="">选择声明</option>{declarationRows.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}</select></label>{kind === 'agent' && <label>归属 Principal（可选）<select aria-label="Agent Principal" value={agentPrincipal} onChange={(event) => setAgentPrincipal(event.target.value)}><option value="">使用声明 owner</option>{principals.map((item) => item.declared || item).filter((row) => row.status === 'present').map((row) => <option key={row.id} value={row.id}>{row.display_name || row.email || row.id}</option>)}</select></label>}</>}
            <button className="primary-button" type="submit" disabled={disabled}>添加到频道</button>
          </form>
          {actorProgress && <section className="governance-card convergence" aria-label="成员操作进度">
            <h3>成员操作进度</h3>
            <div className={actorProgress.ledger ? 'done' : 'waiting'}><span>{actorProgress.ledger ? '✓' : '·'}</span><strong>账本确认</strong><small>{actorProgress.ledger ? '已确认' : '等待终态'}</small></div>
            <div className={actorProgress.rosterConverged ? 'done' : 'waiting'}><span>{actorProgress.rosterConverged ? '✓' : '·'}</span><strong>名册与 serving</strong><small>{actorProgress.rosterConverged ? '已收敛' : '等待 OBS'}</small></div>
            {actorProgress.failed && <p className="governance-error">账本失败：{actorProgress.error}</p>}
          </section>}
          {confirmAction && <section className="governance-card confirmation" role="alertdialog" aria-label="确认 Actor 操作">
            <h3>确认{confirmAction.type === GOVERNANCE_TYPES.remove ? '移除' : '重启'} {actorLabel(confirmAction.actor)}？</h3>
            <p>{confirmAction.type === GOVERNANCE_TYPES.remove ? '该 Actor 将立即失去频道身份；历史账本仍然保留。' : '当前运行中的工作可能被中断，重启结果以账本和 presence 收敛为准。'}</p>
            <div><button type="button" onClick={() => setConfirmAction(null)}>取消</button><button type="button" className="danger-button" onClick={performConfirmed}>确认操作</button></div>
          </section>}
        </>}

        {section === 'danger' && <section className="governance-card danger-zone">
          <h3>退役频道</h3>
          {channel.id === 'c0' ? <p>空间根频道 c0 受后端保护，不能退役。</p> : <>
            <p>退役后频道停止写入，但已有账本和文件不会被前端删除。存在活动子频道时后端会拒绝。</p>
            <label>输入 <strong>{channel.qualified_name || channel.name || channel.id}</strong> 确认<input aria-label="退役确认" value={retireText} onChange={(event) => setRetireText(event.target.value)} /></label>
            <button type="button" className="danger-button" disabled={disabled || retireText !== (channel.qualified_name || channel.name || channel.id)} onClick={retire}>退役当前频道</button>
          </>}
        </section>}
      </div>
    </aside>
  );
}
