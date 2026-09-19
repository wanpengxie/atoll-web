import React, { useState } from 'react';
import { actorDisplayName } from '../../../model/actor-display.js';
import { isVisibleActor } from '../../../model/actor-visibility.js';
import { SidePanel } from '../../primitives/SidePanel.jsx';

function presence(row) {
  if (row.bound === true && row.deviceOnline === true) return ['online', '在线'];
  if (row.bound === true) return ['bound', '已绑定'];
  if (row.bound === false) return ['offline', '未绑定'];
  return ['unknown', '未知'];
}

export function RosterFeature({ port = {}, onClose }) {
  const rows = (port.rows || []).filter(isVisibleActor);
  return <aside className="roster-panel focused" aria-label="频道成员">
    <header><div><p className="eyebrow">MEMBERS</p><h2>成员 <small>{rows.length}</small></h2></div><div className="roster-header-actions"><button type="button" className="icon-button" onClick={() => port.commands?.refresh?.()} disabled={port.busy} aria-label="刷新名册">{port.busy ? '…' : '↻'}</button>{onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="关闭成员面板">×</button>}</div></header>
    <div className="roster-list">
      {rows.map((row) => {
        const [status, label] = presence(row);
        return <button type="button" className={port.selectedActor?.id === row.id ? 'roster-row selected' : 'roster-row'} key={row.id} onClick={() => port.commands?.select?.(row)}>
          <span className={`actor-icon kind-${row.kind || 'unknown'}`}>{String(row.kind || '?').slice(0, 1).toUpperCase()}</span>
          <div><strong title={row.id}>{actorDisplayName(row)}{row.id === port.selfId && <em>我</em>}</strong><span>{row.kind || 'actor'} · {row.decl_id || row.declarationId || 'channel member'}</span></div>
          <span className={`presence ${status}`}>{label}</span>
        </button>;
      })}
      {!rows.length && <p className="roster-empty">暂无业务成员</p>}
      {port.identityPending && <p className="roster-identity-pending" role="status">正在确认你在本频道中的 Actor 身份</p>}
    </div>
    <footer><span className="legend-dot online" />设备在线 <span className="legend-dot bound" />仅绑定</footer>
  </aside>;
}

export function ActorDetailPanel({ port = {}, onClose }) {
  const actor = port.selectedActor;
  const [selectedCapability, setSelectedCapability] = useState('');
  const [argumentsText, setArgumentsText] = useState('{}');
  const [error, setError] = useState('');
  if (!actor) return null;
  const capabilities = port.actorDetail?.capabilities || actor.capabilities || [];
  const describe = async () => {
    setError('');
    try {
      if (typeof port.commands?.describe !== 'function') throw new Error('能力读取当前不可用');
      const result = await port.commands.describe(actor);
      if (result?.error) throw Object.assign(new Error(result.error.detail), { code: result.error.code });
    } catch (failure) {
      setError(failure?.message || String(failure));
    }
  };
  const invoke = async () => {
    setError('');
    try {
      const payload = JSON.parse(argumentsText || '{}');
      if (typeof port.commands?.invoke !== 'function') throw new Error('能力调用当前不可用');
      await port.commands.invoke({
        actor,
        type: selectedCapability,
        payload,
        targetAuthority: port.targetAuthority || null,
      });
    } catch (failure) {
      setError(failure?.message || String(failure));
    }
  };
  return <SidePanel className="actor-details" ariaLabel="Actor 详情" eyebrow={actor.kind || 'ACTOR'} title={actorDisplayName(actor)} onClose={onClose} headerActions={<button type="button" className="text-button" disabled={port.detailBusy} onClick={describe}>{port.detailBusy ? '读取中…' : '刷新能力'}</button>}>
    <dl className="work-item-metadata"><dt>Actor ID</dt><dd>{actor.id}</dd><dt>类型</dt><dd>{actor.kind || '未知'}</dd><dt>声明</dt><dd>{actor.decl_id || actor.declarationId || '未声明'}</dd><dt>绑定</dt><dd>{actor.bound === true ? '已绑定' : actor.bound === false ? '未绑定' : '未知'}</dd></dl>
    {port.detailError && <p className="governance-error" role="alert">{port.detailError}</p>}
    {error && <p className="governance-error" role="alert">{error}</p>}
    <section className="panel-card governance-form"><header className="panel-card-header"><h3>调用能力</h3></header>
      {!capabilities.length && <p className="governance-empty">该 Actor 没有公布可调用能力。</p>}
      {capabilities.length > 0 && <>
        <label>能力<select value={selectedCapability} onChange={(event) => setSelectedCapability(event.target.value)}><option value="">选择能力</option>{capabilities.map((capability) => { const type = typeof capability === 'string' ? capability : capability.type; return <option value={type} key={type}>{typeof capability === 'string' ? capability : capability.label || type}</option>; })}</select></label>
        <label>参数 JSON<textarea rows="8" value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} /></label>
        <button type="button" className="primary-button" disabled={port.disabled || !selectedCapability} onClick={invoke}>提交调用</button>
      </>}
    </section>
  </SidePanel>;
}
