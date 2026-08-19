import React, { useEffect, useMemo, useRef, useState } from 'react';
import { resolveManagementActors } from '../model/management-actors.js';
import { TYPES } from '../protocol/vocab.js';
import { resolveMentionRecipients } from './mentions.js';

function mentionQuery(text) {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1].toLowerCase() : null;
}

// 频道面的斜杠命令。收件人恒是本频道的 system actor：成员类的词它自己答，
// 空间类的词它转交 c0 的 registrar。
export function slashCommand(value) {
  const [verb, ...rest] = value.trim().split(/\s+/);
  if (verb === '/introduce') {
    const declId = rest[0];
    if (!declId || rest.length > 1) throw new TypeError('用法：/introduce <decl_id>');
    return { msgType: TYPES.member.create, payload: { decl_id: declId } };
  }
  if (verb === '/admit') {
    const principal = rest[0];
    if (!principal || rest.length > 1) throw new TypeError('用法：/admit <principal>');
    return { msgType: TYPES.member.admit, payload: { principal } };
  }
  if (verb === '/members') {
    if (rest.length) throw new TypeError('用法：/members');
    return { msgType: TYPES.member.list, payload: {} };
  }
  if (verb === '/channels') {
    if (rest.length > 1) throw new TypeError('用法：/channels [parent_id]');
    return { msgType: TYPES.channel.list, payload: rest[0] ? { parent_id: rest[0] } : {} };
  }
  return null;
}

export function Composer({ channelId, roster, selfId, attachments = [], pending = [], draft = '', onDraftChange, disabled, disabledReason = '等待连接…', onSend, onRemoveAttachment, onClearAttachments, onChooseAttachment }) {
  const [mentions, setMentions] = useState([]);
  const [error, setError] = useState('');
  const [sendState, setSendState] = useState('idle');
  const [sentMessageId, setSentMessageId] = useState('');
  const textareaRef = useRef(null);
  const text = draft;
  const setText = (value) => onDraftChange?.(typeof value === 'function' ? value(text) : value);
  const query = mentionQuery(text);
  const candidates = useMemo(() => roster.filter((row) => (
    row.id !== selfId
    && (row.kind === 'agent' || row.kind === 'human')
    && !mentions.some((item) => item.id === row.id)
    && (query == null || `${row.name} ${row.id}`.toLowerCase().includes(query))
  )), [mentions, query, roster, selfId]);

  useEffect(() => {
    setMentions([]);
    setError('');
    setSendState('idle');
    setSentMessageId('');
  }, [channelId]);

  useEffect(() => {
    if (!sentMessageId) return undefined;
    const submission = pending.find((item) => item.messageId === sentMessageId);
    if (submission) {
      if (submission.state === 'rejected') {
        setSendState('error');
        setError(submission.error?.detail || submission.error?.message || '发送被拒绝');
      } else if (submission.state === 'uncertain') setSendState('uncertain');
      else if (submission.state === 'delayed') setSendState('delayed');
      else setSendState(submission.state === 'transmitting' ? 'sending' : 'accepted');
      return undefined;
    }
    if (sendState !== 'sending') {
      setSendState('landed');
      const timer = setTimeout(() => { setSendState('idle'); setSentMessageId(''); }, 2_500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pending, sendState, sentMessageId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(160, Math.max(58, textarea.scrollHeight))}px`;
  }, [text]);

  function pick(row) {
    setMentions((current) => [...current, row]);
    setText((current) => current.replace(/@[^\s@]*$/, `@${row.name || row.id} `));
  }

  async function submit() {
    const value = text.trim();
    if ((!value && !attachments.length) || !channelId || disabled || sendState === 'sending') return;
    setError('');
    setSendState('sending');

    try {
      const slash = slashCommand(value);
      if (slash) {
        const sysactor = resolveManagementActors(roster).system;
        const messageId = await onSend({ text: value, msgType: slash.msgType, audience: [sysactor.id], targetLabel: sysactor.name || sysactor.id, payload: slash.payload });
        setSentMessageId(messageId || '');
        setText('');
        setMentions([]);
        setSendState('accepted');
        return;
      }

      const resolved = resolveMentionRecipients(value, roster, mentions);
      if (resolved.unknown.length) throw new TypeError(`未找到成员：${resolved.unknown.map((name) => `@${name}`).join('、')}`);
      let recipients = resolved.recipients;
      if (!recipients.length) {
        const agents = roster.filter((row) => row.kind === 'agent');
        if (agents.length === 1) recipients = agents;
        else throw new TypeError('请 @ 一个成员');
      }
      const kinds = new Set(recipients.map((row) => row.kind));
      if (kinds.size !== 1 || !['agent', 'human'].includes([...kinds][0])) throw new TypeError('暂不支持混合收件人广播');
      const msgType = kinds.has('human') ? TYPES.humanMessage : TYPES.agentAsk;
      // agent.ask 的 text 是必填且不能为空白，所以纯附件消息也要带上一句正文。
      const body = value || `发送 ${attachments.length} 个附件`;
      const messageId = await onSend({
        text: body,
        msgType,
        audience: recipients.map((row) => row.id),
        targetLabel: recipients.map((row) => row.name || row.id).join('、'),
        payload: attachments.length ? { text: body, attachments } : undefined,
      });
      setSentMessageId(messageId || '');
      setText('');
      setMentions([]);
      onClearAttachments?.();
      setSendState('accepted');
    } catch (failure) {
      setError(failure.message || String(failure));
      setSendState('error');
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className="composer-wrap">
      <div className="composer-surface">
        {attachments.length > 0 && <div className="attachment-drafts" aria-label="待发送附件">{attachments.map((row) => <div key={row.resource_id}><span>附件</span><strong>{row.name}</strong><small>{row.size} bytes</small><button type="button" aria-label={`移除附件 ${row.name}`} onClick={() => onRemoveAttachment?.(row.resource_id)}>×</button></div>)}</div>}
        {mentions.length > 0 && (
          <div className="mention-chips">{mentions.map((row) => (
            <button type="button" key={row.id} onClick={() => setMentions((current) => current.filter((item) => item.id !== row.id))}>@{row.name || row.id} ×</button>
          ))}</div>
        )}
        <div className="composer-input-area">
          <div className="composer-box">
            <textarea
              ref={textareaRef}
              aria-label="消息"
              placeholder={disabled ? disabledReason : '输入消息，使用 @ 选择频道成员'}
              value={text}
              disabled={!channelId || disabled}
              onChange={(event) => { setText(event.target.value); setError(''); setSendState('idle'); }}
              onKeyDown={onKeyDown}
              rows={2}
            />
            <button type="button" className="send-button" onClick={submit} disabled={(!text.trim() && !attachments.length) || !channelId || disabled || sendState === 'sending'} aria-label={sendState === 'sending' ? '发送中' : '发送'}>{sendState === 'sending' ? '…' : '↑'}</button>
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
        </div>
        <div className="composer-toolbar">
          <div className="composer-tools"><button type="button" aria-label="＋ 附件" disabled={disabled} onClick={onChooseAttachment}>＋</button><div className="composer-target"><span>发送给</span><strong>{mentions.length ? mentions.map((row) => row.name || row.id).join('、') : '使用 @ 选择频道成员'}</strong></div></div>
          <div className="composer-help"><span>Shift + Enter 换行</span><span>Enter 发送</span></div>
        </div>
      </div>
      {['accepted', 'delayed', 'uncertain', 'landed'].includes(sendState) && <p className={`composer-status state-${sendState}`} role="status">{{ accepted: '已提交，等待频道入账', delayed: '已受理，入账时间较长', uncertain: '发送结果待确认，正在通过账本核对', landed: '已写入频道账本' }[sendState]}</p>}
      {disabled && <p className="composer-disabled-reason">{disabledReason}；草稿仍保留在当前设备。</p>}
      {error && <p className="composer-error" role="alert">{error}</p>}
    </section>
  );
}
