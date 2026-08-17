import React, { useMemo, useState } from 'react';
import { REGISTRAR_DECL_ID, SYSTEM_ACTOR_ID, TYPES } from '../protocol/vocab.js';
import { resolveMentionRecipients } from './mentions.js';

function mentionQuery(text) {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export function Composer({ channelId, roster, selfId, disabled, onSend }) {
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
    if (!value || !channelId || disabled) return;
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
      const sysactor = roster.find((row) => row.id === SYSTEM_ACTOR_ID || row.kind === 'system');
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
      const registrar = roster.find((row) => row.kind === 'tool' && row.decl_id === REGISTRAR_DECL_ID);
      if (!registrar) {
        setError('名册中未找到 registrar 席位');
        return;
      }
      await onSend({ text: value, msgType: TYPES.registrar.channelList, audience: [registrar.id], targetLabel: registrar.name || registrar.id, payload: {} });
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
      text: value,
      msgType,
      audience: recipients.map((row) => row.id),
      targetLabel: recipients.map((row) => row.name || row.id).join('、'),
    });
    setText('');
    setMentions([]);
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className="composer-wrap">
      {mentions.length > 0 && (
        <div className="mention-chips">{mentions.map((row) => (
          <button type="button" key={row.id} onClick={() => setMentions((current) => current.filter((item) => item.id !== row.id))}>@{row.name || row.id} ×</button>
        ))}</div>
      )}
      <div className="composer-box">
        <textarea
          aria-label="消息"
          placeholder={disabled ? '等待连接…' : '输入 @ 选择成员，Enter 发送'}
          value={text}
          disabled={!channelId || disabled}
          onChange={(event) => { setText(event.target.value); setError(''); }}
          onKeyDown={onKeyDown}
          rows={2}
        />
        <button type="button" className="send-button" onClick={submit} disabled={!text.trim() || !channelId || disabled}>发送 <span>↵</span></button>
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
