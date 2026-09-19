import React, { memo, useCallback } from 'react';
import { useReadingIntent } from '../conversation/ReadingIntentContext.jsx';

function actorName(actor) {
  return actor?.name || actor?.label || actor?.id || '未知成员';
}

function invoke(operation, ...args) {
  void Promise.resolve(operation(...args)).catch(() => {});
}

function parameterChoices(parameters) {
  const selections = Array.isArray(parameters?.selections) ? parameters.selections : [];
  return selections.map((row) => ({
    value: `${row.model}\u0000${row.effort || ''}`,
    model: row.model,
    effort: row.effort || '',
    label: [row.modelLabel || row.model, row.effortLabel || row.effort].filter(Boolean).join(' · '),
  }));
}

export const Composer = memo(function Composer({ model, commands, className = '' }) {
  const readingIntent = useReadingIntent();
  const choices = parameterChoices(model.parameters);
  const currentParameters = model.parameters?.current;
  const currentChoice = currentParameters
    ? `${currentParameters.model}\u0000${currentParameters.effort || ''}`
    : '';
  const editMode = Boolean(model.edit);
  const disabled = !model.permissions.canEditDraft;

  const submit = useCallback((event) => {
    event?.preventDefault?.();
    if (!model.canSubmit) return;
    invoke(editMode ? commands.edit : commands.send, editMode ? {} : { readingIntent });
  }, [commands, editMode, model.canSubmit, readingIntent]);

  return <section
    className={`composer-wrap${editMode ? ' is-editing-message' : ''}${className ? ` ${className}` : ''}`}
    data-composer-channel={model.channelId}
    data-composer-owner="current"
  >
    <form className={`composer-surface${editMode ? ' is-editing-message' : ''}`} onSubmit={submit}>
      {!editMode && <div className={`composer-target is-${model.delivery.kind}${disabled ? ' is-muted' : ''}`} role="status" aria-label="收件人">
        {model.delivery.rows.length
          ? model.delivery.rows.map((row) => <span key={row.id} className={`composer-target-pill${model.delivery.source === 'mention' ? ' is-picked' : ''}${row.missing ? ' is-lost' : ''}`}>
            @{actorName(row)}
            {model.delivery.source === 'mention' && <button type="button" className="composer-target-remove" aria-label={`移除收件人 @${actorName(row)}`} disabled={disabled} onClick={() => invoke(commands.removeMention, row.id)}>×</button>}
          </span>)
          : <span className="composer-target-pill">{model.delivery.label}</span>}
      </div>}

      {!editMode && model.draft.replyTarget && <div className="composer-reply" role="status">
        <span aria-hidden="true">↩</span>
        <div><strong>回复 @{model.draft.replyTarget.senderName || model.draft.replyTarget.senderId}</strong><small>{model.draft.replyTarget.excerpt || ''}</small></div>
        <button type="button" aria-label="取消回复" onClick={() => invoke(commands.clearReply)}>×</button>
      </div>}

      {!editMode && model.draft.attachments.length > 0 && <div className="attachment-drafts" aria-label="待发送附件">
        {model.draft.attachments.map((row) => {
          const id = row.resource_id || row.id;
          return <article key={id}><span className="attachment-draft-preview"><span aria-hidden="true">◇</span><span><strong>{row.name || id}</strong></span></span><button type="button" className="attachment-draft-remove" aria-label={`移除附件 ${row.name || id}`} onClick={() => invoke(commands.removeAttachment, id)}>×</button></article>;
        })}
      </div>}

      <div className="composer-input-area">
        <div className="composer-box">
          <textarea
            className="composer-editor composer-richtext"
            aria-label="消息"
            placeholder={editMode ? '编辑消息' : '输入消息'}
            disabled={disabled}
            value={model.draft.text}
            onChange={(event) => invoke(commands.changeDraft, { text: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
              event.preventDefault();
              if (model.mentionQuery?.rows?.length) {
                invoke(commands.pickMention, model.mentionQuery.rows[0]);
                return;
              }
              submit(event);
            }}
          />
        </div>
        {model.mentionQuery?.rows?.length > 0 && <div className="mention-menu" role="listbox" aria-label="@ 收件人">
          {model.mentionQuery.rows.map((actor, index) => <button type="button" role="option" aria-selected={index === 0} key={actor.id} onMouseDown={(event) => event.preventDefault()} onClick={() => invoke(commands.pickMention, actor)}>
            <span className={`actor-icon kind-${actor.kind}`}>{actor.kind.slice(0, 1).toUpperCase()}</span>
            <strong>{actorName(actor)}</strong><small>{actor.kind} · {actor.id}</small>
          </button>)}
        </div>}
      </div>

      <div className="composer-toolbar">
        <div className="composer-tools" aria-label="消息对象与附件操作">
          {!editMode && <select aria-label="添加 @ 收件人" value="" disabled={disabled} onChange={(event) => {
            const actor = model.mentionCandidates.find((row) => row.id === event.currentTarget.value);
            if (actor) invoke(commands.addMention, actor);
          }}>
            <option value="">@</option>
            {model.mentionCandidates.map((actor) => <option key={actor.id} value={actor.id}>@{actorName(actor)}</option>)}
          </select>}
          {!editMode && <label className={`composer-file-control${!model.permissions.canTransmit ? ' is-disabled' : ''}`} title="上传本机文件到频道">
            <input type="file" multiple aria-label="上传本机文件到频道" disabled={!model.permissions.canTransmit} onChange={(event) => {
              const files = [...(event.currentTarget.files || [])];
              event.currentTarget.value = '';
              if (files.length) invoke(commands.upload, files);
            }} />
            <span aria-hidden="true">＋</span>
          </label>}
        </div>

        <div className="composer-submit-actions">
          {!editMode && <select aria-label="目标 Agent" value={model.selectedAgent?.id || ''} disabled={!model.agents.length || disabled} onFocus={() => invoke(commands.openAgentSelector)} onChange={(event) => invoke(commands.selectAgent, event.currentTarget.value)}>
            <option value="">选择 Agent</option>
            {model.agents.map((actor) => <option key={actor.id} value={actor.id}>{actorName(actor)}</option>)}
          </select>}
          {!editMode && choices.length > 0 && <select aria-label="模型参数" value={currentChoice} disabled={!model.permissions.canTransmit || Boolean(model.parameterPending)} onFocus={() => invoke(commands.openAgentSelector)} onChange={(event) => {
            const selected = choices.find((row) => row.value === event.currentTarget.value);
            if (selected) invoke(commands.setModelParameters, selected);
          }}>
            {!currentChoice && <option value="">选择模型</option>}
            {choices.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
          </select>}
          {!editMode && <button
            type="button"
            className="composer-steer-button"
            disabled={!model.controls.steer.enabled || !model.draft.text.trim() || model.busy}
            title={model.controls.steer.reason || '把文本插入目标 Agent 的当前任务'}
            onClick={() => invoke(commands.steer, {
              text: model.draft.text,
              actorId: model.controls.actorId,
            })}
          >插入</button>}
          {editMode && <button type="button" className="composer-cancel-edit" aria-label="取消编辑" disabled={model.busy} onClick={() => invoke(commands.cancelEdit)}>×</button>}
          <button type="submit" className="send-button" disabled={!model.canSubmit || model.busy} aria-label={editMode ? '提交编辑' : '发送'}>{model.busy ? '…' : '↑'}</button>
        </div>
      </div>
    </form>

    <div className="composer-state-rail">
      {model.editSession?.error
        ? <p className="composer-error" role="alert">{model.editSession.error}</p>
        : model.failure
        ? <p className="composer-error" role="alert">{model.failure.error?.message || model.failure.error || '发送失败'}<button type="button" className="composer-retry" onClick={() => invoke(commands.retry, model.failure)}>使用原编号重试</button></p>
        : disabled
          ? <p className="composer-disabled-reason">{model.permissions.reason}</p>
          : !model.permissions.canTransmit
            ? <p className="composer-status state-offline" role="status">离线编辑；发送会先保存到本机。</p>
            : !editMode && model.controls.actorId && model.controls.steer.state !== 'supported'
              ? <p className="composer-status" role="status">{model.controls.steer.reason}</p>
            : null}
    </div>
  </section>;
});
