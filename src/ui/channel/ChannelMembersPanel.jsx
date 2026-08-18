import React, { useMemo, useState } from 'react';
import { actorCommand, actorConvergence, declarationKind, GOVERNANCE_TYPES, isProtectedActor, usableDeclarations, usablePrincipals } from '../../model/channel-governance.js';
import { InlineConfirmation } from '../primitives/InlineConfirmation.jsx';
import { PanelCard } from '../primitives/PanelCard.jsx';
import { SelectMenu } from '../primitives/SelectMenu.jsx';

function actorLabel(row) {
  return row.name || row.principal || row.id;
}

export function ChannelMembersPanel({ channel, roster, state, principals, declarations, selfId = '', identityPending = false, disabled, onSubmit, onRefresh, onSelectActor }) {
  const [candidateKey, setCandidateKey] = useState('');
  const [agentPrincipal, setAgentPrincipal] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [error, setError] = useState('');
  const [actorRequest, setActorRequest] = useState(null);
  const principalRows = useMemo(() => usablePrincipals(principals, roster), [principals, roster]);
  const declarationRows = useMemo(() => usableDeclarations(declarations), [declarations]);
  const candidates = useMemo(() => [
    ...principalRows.map((row) => ({ value: `principal:${row.id}`, label: `${row.display_name || row.email || row.id} · 用户`, kind: 'human', row })),
    ...declarationRows.map((row) => ({ value: `declaration:${row.id}`, label: `${row.name || row.id} · ${declarationKind(row) === 'agent' ? 'Agent' : '工具'}`, kind: declarationKind(row), row })),
  ], [declarationRows, principalRows]);
  const candidate = candidates.find((row) => row.value === candidateKey) || null;
  const actorProgress = actorRequest ? actorConvergence({ turn: state.turns.get(actorRequest.id), type: actorRequest.type, actorId: actorRequest.actorId, roster }) : null;

  async function run(command, after) {
    setError('');
    try {
      const id = await onSubmit(command);
      after?.(id);
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  async function introduce(event) {
    event.preventDefault();
    if (!candidate) { setError('请先选择要添加的参与者'); return; }
    const payload = candidate.kind === 'human'
      ? { kind: 'human', principal: candidate.row.id }
      : { kind: candidate.kind, decl_id: candidate.row.id, ...(candidate.kind === 'agent' && agentPrincipal ? { principal: agentPrincipal } : {}) };
    await run(actorCommand({ channelId: channel.id, type: GOVERNANCE_TYPES.introduce, payload, roster }), (id) => {
      setActorRequest({ id, type: GOVERNANCE_TYPES.introduce, actorId: '' });
      setCandidateKey(''); setAgentPrincipal('');
    });
  }

  async function performConfirmed() {
    if (!confirmAction) return;
    const command = actorCommand({ channelId: channel.id, type: confirmAction.type, payload: { instance_id: confirmAction.actor.id }, roster });
    await run(command, (id) => { setActorRequest({ id, type: confirmAction.type, actorId: confirmAction.actor.id }); setConfirmAction(null); });
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <PanelCard title="当前成员与 Actor" action={<button type="button" className="text-button" onClick={onRefresh}>刷新</button>}>
      {roster.filter((row) => !isProtectedActor(row)).map((row) => {
        const ownerActor = row.principal && row.principal === channel.owner_principal;
        return <div className="managed-actor" key={row.id}>
          <div><strong>{actorLabel(row)}{row.id === selfId && <em>我</em>}</strong><small>{row.kind}{row.principal ? ` · principal ${row.principal}` : ''} · {row.id}</small></div>
          <span className={row.deviceOnline === true ? 'actor-runtime online' : row.bound === true ? 'actor-runtime bound' : 'actor-runtime waiting'}>{row.deviceOnline === true ? '在线' : row.bound === true ? '已绑定' : row.bound === false ? '未绑定' : '等待状态'}</span>
          <button type="button" onClick={() => onSelectActor?.(row)} aria-label={`查看 ${actorLabel(row)}`}>查看</button>
          <button type="button" disabled={disabled || row.kind === 'human' || ownerActor} onClick={() => setConfirmAction({ type: GOVERNANCE_TYPES.restart, actor: row })}>重启</button>
          <button type="button" className="danger-text" disabled={disabled || ownerActor} onClick={() => setConfirmAction({ type: GOVERNANCE_TYPES.remove, actor: row })}>{ownerActor ? 'Owner' : '移除'}</button>
        </div>;
      })}
      {!roster.some((row) => !isProtectedActor(row)) && <p className="governance-empty">暂无可管理的业务 Actor</p>}
      {identityPending && <p className="roster-identity-pending" role="status">正在确认你在本频道中的 Actor 身份</p>}
      <p className="protected-note">标准系统 Actor 与维持频道关系的 foundation Actor 已隐藏并受后端保护。</p>
    </PanelCard>
    <PanelCard as="form" className="governance-form" title="添加参与者" onSubmit={introduce}>
      <p>先选择业务参与者；系统会根据对象类型显示必要配置。标准 Actor 不会出现在候选项中。</p>
      <label>参与者<SelectMenu ariaLabel="选择参与者" value={candidateKey} placeholder="搜索用户、Agent 或工具" options={candidates} onChange={(value) => { setCandidateKey(value); setAgentPrincipal(''); setError(''); }} /></label>
      {candidate && <div className="participant-selection" role="status"><span>{candidate.kind === 'human' ? '用户' : candidate.kind === 'agent' ? 'Agent' : '工具'}</span><strong>{candidate.row.display_name || candidate.row.email || candidate.row.name || candidate.row.id}</strong><small>{candidate.row.id}</small></div>}
      {candidate?.kind === 'agent' && <label>归属 Principal（可选）<SelectMenu ariaLabel="Agent Principal" value={agentPrincipal} placeholder="使用声明 owner" options={principals.map((item) => item.declared || item).filter((row) => row.status === 'present').map((row) => ({ value: row.id, label: row.display_name || row.email || row.id }))} onChange={setAgentPrincipal} /></label>}
      <button className="primary-button" type="submit" disabled={disabled || !candidate}>添加到频道</button>
    </PanelCard>
    {actorProgress && <PanelCard className="convergence" aria-label="成员操作进度" title="成员操作进度">
      <div className={actorProgress.ledger ? 'done' : 'waiting'}><span>{actorProgress.ledger ? '✓' : '·'}</span><strong>账本确认</strong><small>{actorProgress.ledger ? '已确认' : '等待终态'}</small></div>
      <div className={actorProgress.rosterConverged ? 'done' : 'waiting'}><span>{actorProgress.rosterConverged ? '✓' : '·'}</span><strong>名册与 serving</strong><small>{actorProgress.rosterConverged ? '已收敛' : '等待 OBS'}</small></div>
      {actorProgress.failed && <p className="governance-error">账本失败：{actorProgress.error}</p>}
    </PanelCard>}
    {confirmAction && <InlineConfirmation
      title={`确认${confirmAction.type === GOVERNANCE_TYPES.remove ? '移除' : '重启'} ${actorLabel(confirmAction.actor)}？`}
      description={confirmAction.type === GOVERNANCE_TYPES.remove ? '该 Actor 将立即失去频道身份；历史账本仍然保留。' : '当前运行中的工作可能被中断，重启结果以账本和 presence 收敛为准。'}
      tone="danger"
      onCancel={() => setConfirmAction(null)}
      onConfirm={performConfirmed}
    />}
  </>;
}
