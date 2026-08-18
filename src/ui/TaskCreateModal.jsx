import React, { useRef, useState } from 'react';
import { useModalFocus } from './primitives/useModalFocus.js';

export function TaskCreateModal({ providers = [], source, onSubmit, onClose }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [providerId, setProviderId] = useState(providers[0]?.actorId || '');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  useModalFocus({ dialogRef, initialFocusRef: titleRef, onClose, closeDisabled: busy });
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await onSubmit({ title: title.trim(), description: description.trim(), providerId, dueAt: dueAt ? new Date(dueAt).toISOString() : '', source }); onClose(); }
    catch (failure) { setError(failure.message || String(failure)); setBusy(false); }
  }
  return <div className="modal-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="task-create-modal" role="dialog" aria-modal="true" aria-labelledby="task-create-title" aria-describedby="task-create-description">
      <header><div><p className="eyebrow">NEW TASK</p><h2 id="task-create-title">新建任务</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="关闭新建任务">×</button></header>
      <form onSubmit={submit}>
        <p id="task-create-description" className="visually-hidden">填写任务内容、执行者和可选截止时间。</p>
        {source && <div className="task-source-preview"><span>来源</span><strong>动态 #{source.seq || source.objectId}</strong><small>创建后可以返回这条来源记录</small></div>}
        <label><span>任务内容</span><textarea ref={titleRef} aria-label="任务内容" rows="4" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="描述需要继续推进的工作" required /></label>
        <label><span>补充说明（可选）</span><textarea aria-label="任务补充说明" rows="3" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label><span>执行者</span><select aria-label="任务执行者" value={providerId} onChange={(event) => setProviderId(event.target.value)} required>{providers.map((provider) => <option value={provider.actorId} key={provider.actorId}>{provider.name}</option>)}</select></label>
        <label><span>截止时间（可选）</span><input aria-label="任务截止时间" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        {error && <p className="task-create-error" role="alert">{error}</p>}
        <footer><button type="button" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="primary-button" disabled={busy || !title.trim() || !providerId}>{busy ? '正在提交…' : '创建任务'}</button></footer>
      </form>
    </section>
  </div>;
}
