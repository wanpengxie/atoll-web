import React, { useMemo, useState } from 'react';
import { resolveManagementActors } from '../model/management-actors.js';
import { TYPES } from '../protocol/vocab.js';
import { resolveMentionRecipients } from './mentions.js';

function mentionQuery(text) {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export function Composer({ channelId, roster, selfId, attachments = [], disabled, disabledReason = '等待连接…', onSend, onRemoveAttachment, onClearAttachments }) {
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState([]);
  const [error, setError] = useState('');
  const query = mentionQuery(text);
  const candidates = useMemo(() => roster.filter((row) => (
    row.id !== selfId
    && (row.kind === 'agent' || row.kind === 'human')
    && !mentions.some((item) => item.id === row.id)
    && (query == null || `${row.name} ${row.id}`.toLowerCase().includes(query))
  )), [mentions, query, roster, selfId]);

  function pick(row) {
    setMentions((current) => [...current, row]);
    setText((current) => current.replace(/@[^\s@]*$/, `@${row.name || row.id} `));
  }

  async function submit() {
    const value = text.trim();
    if ((!value && !attachments.length) || !channelId || disabled) return;
    setError('');

    if (value.startsWith('/introduce')) {
      const [, kind, declId, principal] = value.split(/\s+/);
      if (!['agent', 'tool'].includes(kind) || !declId) {
        setError('用法：/introduce <agent|tool> <decl_id> [principal]');
        return;
      }
      if (kind === 'tool' && principal) {
        setError('tool 的 introduce payload 不允许 principal');
        return;
      }
      const sysactor = resolveManagementActors(roster).system;
      if (!sysactor) {
        setError('名册中未找到频道 system actor');
        return;
      }
      const payload = { kind, decl_id: declId };
      if (principal) payload.principal = principal;
      await onSend({ text: value, msgType: TYPES.sysactor.introduce, audience: [sysactor.id], targetLabel: sysactor.name || sysactor.id, payload });
      setText('');
      setMentions([]);
      return;
    }

    if (value === '/channels') {
      const registry = resolveManagementActors(roster).channelRegistry;
      if (!registry) {
        setError('名册中未找到 registrar 或 coreactor');
        return;
      }
      await onSend({ text: value, msgType: TYPES.registrar.channelList, audience: [registry.id], targetLabel: registry.name || registry.id, payload: {} });
      setText('');
      setMentions([]);
      return;
    }

    const resolved = resolveMentionRecipients(value, roster, mentions);
    if (resolved.unknown.length) {
      setError(`未找到成员：${resolved.unknown.map((name) => `@${name}`).join('、')}`);
      return;
    }
    let recipients = resolved.recipients;
    if (!recipients.length) {
      const agents = roster.filter((row) => row.kind === 'agent');
      if (agents.length === 1) recipients = agents;
      else {
        setError('请 @ 一个成员');
        return;
      }
    }
    const kinds = new Set(recipients.map((row) => row.kind));
    if (kinds.size !== 1 || !['agent', 'human'].includes([...kinds][0])) {
      setError('暂不支持混合收件人广播');
      return;
    }
    const msgType = kinds.has('human') ? TYPES.humanMessage : TYPES.agentText;
    await onSend({
      text: value || `发送 ${attachments.length} 个附件`,
      msgType,
      audience: recipients.map((row) => row.id),
      targetLabel: recipients.map((row) => row.name || row.id).join('、'),
      payload: attachments.length ? { text: value, attachments } : undefined,
    });
    setText('');
    setMentions([]);
    onClearAttachments?.();
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className="composer-wrap">
      {attachments.length > 0 && <div className="attachment-drafts" aria-label="待发送附件">{attachments.map((row) => <div key={row.resource_id}><span>附件</span><strong>{row.name}</strong><small>{row.size} bytes</small><button type="button" aria-label={`移除附件 ${row.name}`} onClick={() => onRemoveAttachment?.(row.resource_id)}>×</button></div>)}</div>}
      {mentions.length > 0 && (
        <div className="mention-chips">{mentions.map((row) => (
          <button type="button" key={row.id} onClick={() => setMentions((current) => current.filter((item) => item.id !== row.id))}>@{row.name || row.id} ×</button>
        ))}</div>
      )}
      <div className="composer-box">
        <textarea
          aria-label="消息"
          placeholder={disabled ? disabledReason : '输入 @ 选择成员，Enter 发送'}
          value={text}
          disabled={!channelId || disabled}
          onChange={(event) => { setText(event.target.value); setError(''); }}
          onKeyDown={onKeyDown}
          rows={2}
        />
        <button type="button" className="send-button" onClick={submit} disabled={(!text.trim() && !attachments.length) || !channelId || disabled}>发送 <span>↵</span></button>
      </div>
      {query != null && candidates.length > 0 && (
        <div className="mention-menu" role="listbox">
          {candidates.slice(0, 8).map((row) => (
            <button type="button" role="option" aria-selected="false" key={row.id} onClick={() => pick(row)}>
              <span className={`actor-icon kind-${row.kind}`}>{row.kind.slice(0, 1).toUpperCase()}</span>
              <strong>{row.name || row.id}</strong><small>{row.kind} · {row.decl_id || row.id}</small>
            </button>
          ))}
        </div>
      )}
      <div className="composer-help"><span>Shift + Enter 换行</span><span>/introduce · /channels</span></div>
      {error && <p className="composer-error" role="alert">{error}</p>}
    </section>
  );
}
