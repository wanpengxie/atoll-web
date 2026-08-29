import React, { useState } from 'react';
import { channelTemplateCommand, parseJSONObject } from '../../model/space-administration.js';
import { PanelCard } from '../primitives/PanelCard.jsx';
import { OperationState, resultRows } from './space-panel-state.jsx';

export function ChannelTemplatesPanel({ states, registrarRoster, disabled, onSubmit }) {
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState('');
  const [listId, setListId] = useState('');
  const [template, setTemplate] = useState({ id: '', name: '', description: '', visibility: 'private', body: '{\n  "declarations": [],\n  "profile": {\n    "default_storage_device_id": "local-device"\n  }\n}' });
  const rows = resultRows(states, listId);

  async function act(action) {
    setError('');
    try {
      const command = channelTemplateCommand(action, { ...template, body: parseJSONObject(template.body, '模板 body') }, registrarRoster);
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
    <PanelCard title="频道模板" action={<button type="button" className="text-button" disabled={disabled} onClick={() => act('list')}>从 Registrar 读取</button>}>
      {rows.map((row) => <button className="template-row" type="button" key={row.id} onClick={() => setTemplate({ id: row.id, name: row.name || '', description: row.description || '', visibility: row.visibility || 'private', body: JSON.stringify(row.body || {}, null, 2) })}><strong>{row.name || row.id}</strong><small>{row.id}</small></button>)}
      {!rows.length && <p className="governance-empty">尚未读取频道模板。</p>}
    </PanelCard>
    <PanelCard className="governance-form" title="登记或编辑频道模板">
      <label>模板 ID<input aria-label="频道模板 ID" value={template.id} onChange={(event) => setTemplate({ ...template, id: event.target.value })} /></label>
      <label>名称<input aria-label="频道模板名称" value={template.name} onChange={(event) => setTemplate({ ...template, name: event.target.value })} /></label>
      <label>说明<input aria-label="频道模板说明" value={template.description} onChange={(event) => setTemplate({ ...template, description: event.target.value })} /></label>
      <label>Body JSON<textarea aria-label="频道模板 Body JSON" rows="8" value={template.body} onChange={(event) => setTemplate({ ...template, body: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="primary-button" disabled={disabled} onClick={() => act('register')}>登记</button><button type="button" disabled={disabled} onClick={() => act('edit')}>保存编辑</button><button type="button" disabled={disabled} onClick={() => act('get')}>读取详情</button><button type="button" className="danger-text" disabled={disabled} onClick={() => act('revoke')}>撤销</button></div>
    </PanelCard>
  </>;
}
