import React, { useState } from 'react';
import { actorTemplateCommand, isProtectedDeclaration, parseJSONObject } from '../../model/space-administration.js';
import { PanelCard } from '../primitives/PanelCard.jsx';
import { SelectMenu } from '../primitives/SelectMenu.jsx';
import { OperationState, resultRows } from './space-panel-state.jsx';

export function ActorTemplatesPanel({ states, registrarRoster, disabled, onSubmit }) {
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [listId, setListId] = useState('');
  const [actor, setActor] = useState({ id: '', name: '', class: 'agent', description: '', visibility: 'private', config: '{}' });
  const rows = resultRows(states, listId);

  async function act(action) {
    setError('');
    try {
      const command = actorTemplateCommand(action, { ...actor, config: parseJSONObject(actor.config, 'Actor config') }, registrarRoster);
      const id = await onSubmit(command);
      setRequestId(id);
      if (action === 'list') setListId(id);
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <OperationState states={states} requestId={requestId} />
    <PanelCard title="已登记声明" action={<button type="button" className="text-button" disabled={disabled} onClick={() => act('list')}>从 Registrar 读取</button>}>
      {rows.map((row) => <button className="template-row" type="button" key={row.id} onClick={() => setActor({ id: row.id, name: row.name || '', class: row.class || '', description: row.description || '', visibility: row.visibility || 'private', config: JSON.stringify(row.config || {}, null, 2) })}><strong>{row.name || row.id}</strong><small>{row.id} · {row.class || 'class 未知'}</small>{isProtectedDeclaration(row.id) && <span>系统保护</span>}</button>)}
      {!rows.length && <p className="governance-empty">点击读取，以账本终态获得模板列表。</p>}
    </PanelCard>
    <PanelCard className="governance-form" title="登记或编辑 Actor 模板">
      <label>声明 ID<input aria-label="Actor 声明 ID" value={actor.id} onChange={(event) => setActor({ ...actor, id: event.target.value })} placeholder="team:assistant" /></label>
      <label>名称<input aria-label="Actor 模板名称" value={actor.name} onChange={(event) => setActor({ ...actor, name: event.target.value })} /></label>
      <label>Class<input aria-label="Actor Class" value={actor.class} onChange={(event) => setActor({ ...actor, class: event.target.value })} /></label>
      <label>说明<input aria-label="Actor 模板说明" value={actor.description} onChange={(event) => setActor({ ...actor, description: event.target.value })} /></label>
      <label>可见性<SelectMenu ariaLabel="Actor 模板可见性" value={actor.visibility} options={[{ value: 'private', label: 'private' }, { value: 'public', label: 'public' }]} onChange={(value) => setActor({ ...actor, visibility: value })} /></label>
      <label>Config JSON<textarea aria-label="Actor Config JSON" rows="5" value={actor.config} onChange={(event) => setActor({ ...actor, config: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => act('register')}>登记</button><button type="button" disabled={disabled || isProtectedDeclaration(actor.id)} onClick={() => act('edit')}>保存编辑</button><button type="button" className="danger-text" disabled={disabled || isProtectedDeclaration(actor.id)} onClick={() => act('revoke')}>撤销</button></div>
    </PanelCard>
  </>;
}
