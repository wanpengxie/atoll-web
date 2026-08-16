import React, { useEffect, useMemo, useRef, useState } from 'react';
import { orderedTimeline } from '../model/fold.js';
import { DECISIONS, TYPES } from '../protocol/vocab.js';

const ERROR_LABELS = {
  bad_payload: '请求格式不正确',
  not_in_audience: '收件人不在频道',
  unauthorized_sender: '发送者无权执行',
  already_closed: '请求已经结束',
  request_not_found: '找不到请求',
  invalid_decision: '审批决定无效',
  unavailable: '频道暂不可用',
  routing_unavailable: '未找到可用收件人',
  idempotency_conflict: '消息编号发生冲突',
  channel_not_found: '找不到频道',
  channel_unavailable: '频道暂不可用',
  capability_unavailable: '所需能力暂不可用',
  forbidden: '无权在此发言',
  closed: '连接已关闭',
  timeout: '等待回执超时',
};

function timeLabel(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
}

function nameOf(id, names) {
  return names.get(id) || id || '未知成员';
}

function LinkText({ text }) {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, index) => /^https?:\/\//.test(part)
    ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}</a>
    : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>);
}

function MarkdownLite({ text }) {
  const blocks = String(text || '').split(/```/);
  return blocks.map((block, index) => index % 2 === 1
    ? <pre key={index}><code>{block.replace(/^\w+\n/, '')}</code></pre>
    : block.split(/\n{2,}/).filter(Boolean).map((paragraph, paragraphIndex) => (
      <p key={`${index}-${paragraphIndex}`}><LinkText text={paragraph} /></p>
    )));
}

function ActivityRow({ envelope }) {
  const payload = envelope.payload || {};
  const isTool = envelope.type === TYPES.activity.toolStarted || envelope.type === TYPES.activity.toolEnded;
  const ended = envelope.type.endsWith('.ended');
  return (
    <div className="activity-row">
      <span className={ended ? 'activity-mark done' : 'activity-mark'}>{ended ? '✓' : '·'}</span>
      <span>{isTool ? `工具 · ${payload.tool || 'unknown'}` : envelope.type.replace('activity.', '')}</span>
      <code>{payload.status || ''}</code>
      {payload.detail && <small>{payload.detail}</small>}
    </div>
  );
}

function ApprovalCard({ turn, state, onResolve, names }) {
  const request = turn.request;
  const busy = state === 'sending';
  const settled = state === 'resolved' || Boolean(turn.final);
  const error = typeof state === 'object' ? state.error : null;
  return (
    <article className={`approval-card ${settled ? 'settled' : ''}`}>
      <header><span>需要你的决定</span><small>{nameOf(request.sender?.id, names)} · {timeLabel(request.ts)}</small></header>
      <pre>{JSON.stringify(request.payload || {}, null, 2)}</pre>
      <div className="approval-actions">
        <button type="button" className="approve" disabled={busy || settled} onClick={() => onResolve(request.id, DECISIONS.approve)}>批准</button>
        <button type="button" className="reject" disabled={busy || settled} onClick={() => onResolve(request.id, DECISIONS.reject)}>拒绝</button>
        {settled && <span>已回执</span>}
      </div>
      {error && <WireErrorLine error={error} />}
    </article>
  );
}

function TurnCard({ turn, names, selfId }) {
  const request = turn.request;
  const self = request.sender?.id === selfId;
  const latest = turn.provisional.at(-1)?.payload?.status;
  return (
    <article className={`turn-card ${self ? 'self' : ''} status-${turn.status}`}>
      <header>
        <div><span className={`actor-icon kind-${request.sender?.kind}`}>{request.sender?.kind?.slice(0, 1).toUpperCase()}</span><strong>{nameOf(request.sender?.id, names)}</strong></div>
        <span>{timeLabel(request.ts)} · {request.type}</span>
      </header>
      <div className="request-text"><MarkdownLite text={request.payload?.text || JSON.stringify(request.payload || {})} /></div>
      {request.audience?.length > 0 && <div className="audience-line">→ {request.audience.map((id) => nameOf(id, names)).join('、')}</div>}
      {(turn.provisional.length > 0 || turn.activity.length > 0) && (
        <section className="turn-process">
          <div className="process-heading"><span className={turn.final ? 'pulse done' : 'pulse'} />{turn.final ? '过程记录' : '正在处理'}{latest && <code>{latest}</code>}</div>
          {turn.activity.map((envelope) => <ActivityRow key={envelope.id} envelope={envelope} />)}
        </section>
      )}
      {turn.final && (
        <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}>
          <p className="answer-label">{turn.status === 'failed' ? 'FAILED' : 'ANSWER'}</p>
          <MarkdownLite text={turn.text || (turn.status === 'failed' ? '请求失败' : '')} />
        </footer>
      )}
    </article>
  );
}

function Narration({ rows }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="narration">
      <button type="button" onClick={() => setOpen((value) => !value)}><span>{open ? '−' : '+'}</span>系统事件 {rows.length} 条<small>{open ? '收起' : '展开'}</small></button>
      {open && <div>{rows.map(({ seq, envelope }) => (
        <article key={`${seq}-${envelope.id}`}><code>{String(seq).padStart(4, '0')}</code><strong>{envelope.type}</strong><span>{JSON.stringify(envelope.payload || {})}</span></article>
      ))}</div>}
    </section>
  );
}

function Standalone({ envelope, names }) {
  return (
    <article className="standalone-row">
      <span className={`actor-icon kind-${envelope.sender?.kind}`}>{envelope.sender?.kind?.slice(0, 1).toUpperCase()}</span>
      <div><header><strong>{nameOf(envelope.sender?.id, names)}</strong><code>{envelope.type}</code></header><MarkdownLite text={envelope.payload?.text || JSON.stringify(envelope.payload || {})} /></div>
    </article>
  );
}

function WireErrorLine({ error }) {
  return (
    <div className="wire-error" role="alert">
      <strong>{ERROR_LABELS[error?.code] || '操作失败'} <code>{error?.code}</code></strong>
      {error?.detail && <details><summary>详情</summary>{error.detail}</details>}
    </div>
  );
}

function PendingRow({ item }) {
  return (
    <article className={`pending-row pending-${item.state}`}>
      <span className="pending-spinner" />
      <div><strong>{item.text}</strong><span>→ {item.targetLabel || '收件人'}</span></div>
      <small>{item.state === 'sending' ? '发送中' : item.state === 'accepted' ? '已受理，等待入账' : item.state === 'delayed' ? '已受理但尚未入账' : '发送失败'}</small>
      {item.error && <WireErrorLine error={item.error} />}
    </article>
  );
}

export function Timeline({ state, roster, selfId, pending, approvalStates, onResolve }) {
  const endRef = useRef(null);
  const names = useMemo(() => new Map(roster.map((row) => [row.id, row.name || row.id])), [roster]);
  const entries = orderedTimeline(state);
  const narrationSeq = state.narration[0]?.seq ?? Number.POSITIVE_INFINITY;
  const withNarration = [...entries, ...(state.narration.length ? [{ kind: 'narration', seq: narrationSeq }] : [])]
    .sort((left, right) => left.seq - right.seq);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [state.lastSeq, pending.length]);

  return (
    <section className="timeline" aria-live="polite">
      <div className="timeline-inner">
        {!state.rows.size && !pending.length && <div className="empty-ledger"><span>#</span><h2>这本账还没有可见条目</h2><p>从下方编辑器 @ 一位成员开始。</p></div>}
        {withNarration.map((entry) => {
          if (entry.kind === 'narration') return <Narration key="narration" rows={state.narration} />;
          if (
            entry.kind === 'turn'
            && entry.turn.request.type === TYPES.humanApprove
            && selfId
            && entry.turn.request.audience?.includes(selfId)
          ) {
            return <ApprovalCard key={entry.turn.request.id} turn={entry.turn} state={approvalStates[entry.turn.request.id]} onResolve={onResolve} names={names} />;
          }
          if (entry.kind === 'turn') return <TurnCard key={entry.turn.correlation} turn={entry.turn} names={names} selfId={selfId} />;
          return <Standalone key={`${entry.kind}-${entry.envelope.id}`} envelope={entry.envelope} names={names} />;
        })}
        {pending.map((item) => <PendingRow key={item.key} item={item} />)}
        <div ref={endRef} />
      </div>
    </section>
  );
}
