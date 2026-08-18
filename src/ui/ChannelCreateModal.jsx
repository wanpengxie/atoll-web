import React, { useRef, useState } from 'react';
import { createChannelCommand, creationConvergence, validateChannelName } from '../model/channel-governance.js';
import { isMemberAccess } from '../model/channel-access.js';
import { useModalFocus } from './primitives/useModalFocus.js';

const STEPS = [
  ['ledger', '账本确认', '等待创建请求写入频道账本'],
  ['observable', '频道可观察', '等待 OBS 返回新频道'],
  ['membership', '成员关系', '等待当前账户获得成员关系'],
  ['serving', '服务就绪', '等待频道开放服务'],
];

const EMPTY_STATE = Object.freeze({ turns: new Map() });

export function ChannelCreateModal({
  channel,
  channels = [],
  roster = [],
  state = EMPTY_STATE,
  disabled = false,
  onSubmit,
  onClose,
  onEnterChannel,
  returnFocusRef,
}) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [template, setTemplate] = useState('');
  const [createRequest, setCreateRequest] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const nameRef = useRef(null);

  const parentName = channel?.qualified_name || channel?.name || channel?.id || '';
  const expectedName = createRequest ? `${parentName}.${createRequest.name}` : '';
  const convergence = createRequest ? creationConvergence({
    turn: state?.turns?.get(createRequest.id),
    expectedQualifiedName: expectedName,
    channels,
    membership: (id) => isMemberAccess(channels.find((row) => row.id === id)?.access),
  }) : null;
  const validation = validateChannelName(name);
  const tracking = Boolean(createRequest && !convergence?.failed && !convergence?.ready);
  const locked = disabled || submitting || tracking || convergence?.ready;

  useModalFocus({ dialogRef, initialFocusRef: nameRef, returnFocusRef, onClose, closeDisabled: submitting });

  async function submit(event) {
    event.preventDefault();
    const nameError = validateChannelName(name);
    if (nameError) { setError(nameError); return; }
    setError('');
    setSubmitting(true);
    try {
      const id = await onSubmit(createChannelCommand({ parentId: channel.id, name, purpose, template, roster }));
      setCreateRequest({ id, name: name.trim() });
    } catch (failure) {
      setError(failure?.message || String(failure));
    } finally {
      setSubmitting(false);
    }
  }

  function enterChannel() {
    if (convergence?.ready && convergence.channel) onEnterChannel?.(convergence.channel);
  }

  return <div className="modal-backdrop channel-create-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !submitting) onClose?.();
  }}>
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
        <label><span>模板 ID（可选）</span><input aria-label="频道模板 ID" value={template} onChange={(event) => setTemplate(event.target.value)} placeholder="已登记的 channel template ID" disabled={locked} /></label>

        {error && <p className="governance-error" role="alert">{error}</p>}
        {convergence && <section className="convergence channel-create-progress" aria-label="频道创建进度" aria-live="polite">
          <header><strong>{createRequest.name}</strong><small>{convergence.ready ? '已就绪' : convergence.failed ? '创建失败' : '正在收敛'}</small></header>
          {STEPS.map(([key, label, waiting]) => <div key={key} className={convergence[key] ? 'done' : convergence.failed ? 'failed' : 'waiting'}>
            <span aria-hidden="true">{convergence[key] ? '✓' : convergence.failed ? '×' : '·'}</span>
            <strong>{label}</strong>
            <small>{convergence[key] ? '已确认' : convergence.failed ? '未完成' : waiting}</small>
          </div>)}
          {convergence.failed && <p className="governance-error" role="alert">账本失败：{convergence.error}。输入内容已保留，可以重新提交。</p>}
          {convergence.ready && <p className="ready-message">频道已经可以打开和协作。</p>}
        </section>}

        <footer>
          <button type="button" onClick={onClose} disabled={submitting}>取消</button>
          {convergence?.ready
            ? <button type="button" className="primary-button" onClick={enterChannel}>进入新频道</button>
            : <button type="submit" className="primary-button" disabled={locked || Boolean(validation)}>{submitting ? '正在提交…' : convergence?.failed ? '重新创建' : tracking ? '等待频道就绪…' : '创建频道'}</button>}
        </footer>
      </form>
    </section>
  </div>;
}
