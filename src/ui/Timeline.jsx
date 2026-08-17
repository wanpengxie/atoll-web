import React, { useEffect, useMemo, useRef, useState } from 'react';
import { approvalFormSpec, valuesToPayload } from '../model/dynamic-form.js';
import { orderedTimeline } from '../model/fold.js';
import { taskControlContext } from '../model/task-controls.js';
import { DECISIONS, TYPES } from '../protocol/vocab.js';
import { StructuredResult } from './StructuredResult.jsx';

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
  cas_mismatch: '任务回合已经变化，请刷新后重试',
  interrupted: '任务已被打断',
  cancelled: '任务已取消',
  empty_input: '控制内容不能为空',
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

const PROVISIONAL_LABELS = {
  received: '已收到',
  queued: '排队中',
  processing: '处理中',
  deferred: '等待后续条件',
  unavailable: '暂时不可处理',
};

function ProvisionalRow({ item }) {
  const payload = item.envelope.payload || {};
  const extra = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'status'));
  return (
    <div className={`provisional-row provisional-${item.core ? item.status : 'business'}`}>
      <span>{PROVISIONAL_LABELS[item.status] || item.status}</span>
      {!item.core && <code>{item.status}</code>}
      {Object.keys(extra).length > 0 && <small>{JSON.stringify(extra)}</small>}
    </div>
  );
}

function approvalInitial(spec) {
  return Object.fromEntries(spec.fields.map((field) => [field.name, spec.initial?.[field.name] ?? (field.type === 'boolean' ? false : '')]));
}

function ApprovalCard({ turn, state, onResolve, names }) {
  const request = turn.request;
  const busy = state === 'sending';
  const settled = state === 'resolved' || Boolean(turn.terminal);
  const error = typeof state === 'object' ? state.error : null;
  const expired = Number(request.expires_at || 0) > 0 && Number(request.expires_at) <= Date.now();
  const spec = useMemo(() => approvalFormSpec(request.payload || {}), [request.payload]);
  const [values, setValues] = useState(() => approvalInitial(spec));
  const [rawJSON, setRawJSON] = useState(() => JSON.stringify(spec.initial || {}, null, 2));
  const [formError, setFormError] = useState('');

  function decide(decision) {
    setFormError('');
    try {
      onResolve(request.id, decision, valuesToPayload(spec, values, rawJSON));
    } catch (failure) {
      setFormError(failure.message || String(failure));
    }
  }

  return (
    <article className={`approval-card ${settled ? 'settled' : ''}`}>
      <header><span>需要你的决定</span><small>{nameOf(request.sender?.id, names)} · {timeLabel(request.ts)}</small></header>
      <div className="approval-summary"><strong>{request.payload?.title || request.type}</strong>{request.payload?.detail && <p>{request.payload.detail}</p>}{request.payload?.impact && <p><b>影响：</b>{request.payload.impact}</p>}</div>
      {spec.mode === 'fields' ? <div className="approval-fields">{spec.fields.map((field) => (
        <label key={field.name}><span>{field.name}{field.required && <em>必填</em>}</span>{field.description && <small>{field.description}</small>}{field.enum ? (
          <select value={values[field.name] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}><option value="">请选择</option>{field.enum.map((item) => <option value={String(item)} key={String(item)}>{String(item)}</option>)}</select>
        ) : field.type === 'boolean' ? (
          <input type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))} />
        ) : (
          <input value={values[field.name] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />
        )}</label>
      ))}</div> : <label className="approval-json"><span>附加 JSON（可选）</span><textarea rows={4} value={rawJSON} onChange={(event) => setRawJSON(event.target.value)} /></label>}
      {request.expires_at && <p className={expired ? 'approval-expired' : 'approval-deadline'}>{expired ? '已过期，不能再处理' : `截止：${new Date(request.expires_at).toLocaleString('zh-CN')}`}</p>}
      <div className="approval-actions">
        <button type="button" className="approve" disabled={busy || settled || expired} onClick={() => decide(DECISIONS.approve)}>批准</button>
        <button type="button" className="reject" disabled={busy || settled || expired} onClick={() => decide(DECISIONS.reject)}>拒绝</button>
        {settled && <span>已回执</span>}
      </div>
      {formError && <p className="approval-form-error" role="alert">{formError}</p>}
      {turn.terminal && (
        <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}>
          <p className="answer-label">RESPONSE · {String(turn.terminal.payload?.status || '').toUpperCase()}</p>
          <p className="approval-resolver">处理者：{nameOf(turn.terminal.sender?.id, names)}{turn.terminal.payload?.decision && ` · ${turn.terminal.payload.decision}`}</p>
          <StructuredResult requestType={request.type} payload={turn.terminal.payload} renderText={(text) => <MarkdownLite text={text} />} />
        </footer>
      )}
      {error && <WireErrorLine error={error} />}
    </article>
  );
}

function TaskControls({ context, state = {}, onCancel, onControl }) {
  const [steering, setSteering] = useState(false);
  const [steerText, setSteerText] = useState('');
  if (!context.canCancel && !context.canSteer && !context.canInterrupt && !state.status) return null;
  return (
    <section className="task-controls" aria-label="任务控制">
      <div className="task-control-buttons">
        {context.canCancel && <button type="button" onClick={onCancel} disabled={['sending', 'accepted', 'uncertain'].includes(state.status)}>{state.status === 'sending' ? '正在取消…' : '取消任务'}</button>}
        {context.canSteer && <button type="button" onClick={() => setSteering((value) => !value)}>调整方向</button>}
        {context.canInterrupt && <button type="button" className="interrupt" onClick={() => onControl('agent.interrupt', {})}>打断回合</button>}
      </div>
      {state.status === 'accepted' && <p className="control-status">取消请求已受理，等待原任务终态。</p>}
      {state.status === 'uncertain' && <p className="control-status uncertain">取消结果待确认，将以重连后的账本为准。</p>}
      {state.error && <WireErrorLine error={state.error} />}
      {steering && <div className="steer-form"><textarea aria-label="新方向" rows={3} value={steerText} onChange={(event) => setSteerText(event.target.value)} placeholder="输入新的任务方向" /><div><button type="button" onClick={() => setSteering(false)}>取消</button><button type="button" disabled={!steerText.trim()} onClick={() => { onControl('agent.steer', { text: steerText.trim(), expected_turn_id: context.turnId }); setSteering(false); setSteerText(''); }}>提交方向</button></div></div>}
      {context.maxPendingMs > 0 && <small className="wait-hint">Actor 建议等待时间约 {Math.ceil(context.maxPendingMs / 1000)} 秒；超过后仍以账本终态为准。</small>}
    </section>
  );
}

function AttachmentCards({ attachments = [], onDownload }) {
  if (!attachments.length) return null;
  return <section className="message-attachments" aria-label="消息附件">{attachments.map((row) => <article key={row.resource_id}><span className="attachment-icon">↗</span><div><strong>{row.name || row.resource_id}</strong><small>{row.media_type || 'application/octet-stream'} · {Number(row.size || 0)} bytes</small><code>{row.resource_id}</code></div><button type="button" onClick={() => onDownload?.(row)}>下载</button></article>)}</section>;
}

function TurnCard({ turn, names, selfId, access, capability, controlState, onCancel, onControl, onDownload }) {
  const request = turn.request;
  const self = request.sender?.id === selfId;
  const latest = turn.latestStatus;
  const controlContext = taskControlContext(turn, { selfId, access, capability });
  return (
    <article className={`turn-card ${self ? 'self' : ''} status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type}>
      <header>
        <div><span className={`actor-icon kind-${request.sender?.kind}`}>{request.sender?.kind?.slice(0, 1).toUpperCase()}</span><strong>{nameOf(request.sender?.id, names)}</strong></div>
        <span>{timeLabel(request.ts)} · {request.type}</span>
      </header>
      <div className="request-text"><MarkdownLite text={Object.prototype.hasOwnProperty.call(request.payload || {}, 'text') ? (request.payload.text || '附件消息') : JSON.stringify(request.payload || {})} /></div>
      <AttachmentCards attachments={request.payload?.attachments} onDownload={onDownload} />
      {request.audience?.length > 0 && <div className="audience-line">→ {request.audience.map((id) => nameOf(id, names)).join('、')}</div>}
      {(turn.provisional.length > 0 || turn.activity.length > 0) && (
        <section className="turn-process">
          <div className="process-heading"><span className={turn.terminal ? 'pulse done' : 'pulse'} />{turn.terminal ? '过程记录' : '正在处理'}{latest && <code>{latest}</code>}</div>
          {turn.provisional.map((item) => <ProvisionalRow key={`${item.seq}-${item.envelope.id}`} item={item} />)}
          {turn.activity.map((item) => <ActivityRow key={`${item.seq}-${item.envelope.id}`} envelope={item.envelope} />)}
        </section>
      )}
      {turn.terminal && (
        <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}>
          <p className="answer-label">{turn.status === 'failed' ? 'FAILED' : 'ANSWER'}</p>
          <StructuredResult requestType={request.type} payload={turn.terminal.payload} renderText={(text) => <MarkdownLite text={text} />} />
        </footer>
      )}
      {!turn.terminal && <TaskControls context={controlContext} state={controlState} onCancel={onCancel} onControl={onControl} />}
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

function PendingRow({ item, onRetry }) {
  const stateLabel = {
    transmitting: '发送中',
    accepted: '已受理，等待入账',
    delayed: '已受理但尚未入账',
    uncertain: '发送结果待确认',
    rejected: '发送被拒绝',
    sending: '发送中',
    error: '发送失败',
  }[item.state] || item.state;
  return (
    <article className={`pending-row pending-${item.state}`}>
      <span className="pending-spinner" />
      <div><strong>{item.text}</strong><span>→ {item.targetLabel || '收件人'}</span></div>
      <small>{stateLabel}</small>
      {item.state === 'uncertain' && onRetry && <button type="button" className="pending-retry" onClick={() => onRetry(item)}>使用原编号重试</button>}
      {item.error && <WireErrorLine error={item.error} />}
    </article>
  );
}

export function Timeline({ state, roster, selfId, pending, approvalStates, controlStates = {}, capabilityIndex = new Map(), access = '', onResolve, onRetry, onCancel, onTaskControl, onDownloadResource }) {
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
            return <ApprovalCard key={entry.turn.request.id} turn={entry.turn} state={approvalStates[entry.turn.request.id]} onResolve={(reqId, decision, payload) => onResolve(state.channelId, reqId, decision, payload)} names={names} />;
          }
          if (entry.kind === 'turn') {
            const actorId = entry.turn.request.audience?.length === 1 ? entry.turn.request.audience[0] : '';
            const controlKey = `${state.channelId}:${entry.turn.requestId}:cancel`;
            return <TurnCard key={entry.turn.requestId} turn={entry.turn} names={names} selfId={selfId} access={access} capability={capabilityIndex.get(actorId)} controlState={controlStates[controlKey]} onCancel={() => onCancel?.(state.channelId, entry.turn.requestId)} onControl={(type, payload) => onTaskControl?.({ channelId: state.channelId, turn: entry.turn, actorId, type, payload })} onDownload={(attachment) => onDownloadResource?.(state.channelId, attachment)} />;
          }
          return <Standalone key={`${entry.kind}-${entry.envelope.id}`} envelope={entry.envelope} names={names} />;
        })}
        {pending.map((item) => <PendingRow key={item.key} item={item} onRetry={onRetry} />)}
        <div ref={endRef} />
      </div>
    </section>
  );
}
