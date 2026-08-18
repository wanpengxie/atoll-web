import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { approvalFormSpec, valuesToPayload } from '../model/dynamic-form.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { orderedTimeline } from '../model/fold.js';
import { boundedPage, LIST_WINDOW_SIZE } from '../model/list-window.js';
import { messagePresentation } from '../model/message-presentation.js';
import { taskControlContext } from '../model/task-controls.js';
import { latestHumanProgress, systemEventDetail, systemEventLabel, systemEventTier, turnProcessSummary, turnStatusLabel } from '../model/turn-presentation.js';
import { DECISIONS, TYPES } from '../protocol/vocab.js';
import { StructuredResult } from './StructuredResult.jsx';
import { DynamicFields, initialFieldValues } from './DynamicFields.jsx';

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

function InlineText({ text }) {
  const parts = String(text).split(/(https?:\/\/[^\s]+|\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (/^https?:\/\//.test(part)) return <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}</a>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

function MarkdownLite({ text }) {
  const blocks = String(text || '').split(/```/);
  return blocks.map((block, index) => index % 2 === 1
    ? <pre key={index}><code>{block.replace(/^\w+\n/, '')}</code></pre>
    : block.split(/\n{2,}/).filter(Boolean).map((paragraph, paragraphIndex) => {
      const lines = paragraph.split('\n').filter(Boolean);
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) return <ul key={`${index}-${paragraphIndex}`}>{lines.map((line, lineIndex) => <li key={lineIndex}><InlineText text={line.replace(/^\s*[-*]\s+/, '')} /></li>)}</ul>;
      if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) return <ol key={`${index}-${paragraphIndex}`}>{lines.map((line, lineIndex) => <li key={lineIndex}><InlineText text={line.replace(/^\s*\d+[.)]\s+/, '')} /></li>)}</ol>;
      if (lines.every((line) => /^\s*>\s?/.test(line))) return <blockquote key={`${index}-${paragraphIndex}`}><InlineText text={lines.map((line) => line.replace(/^\s*>\s?/, '')).join('\n')} /></blockquote>;
      const heading = lines.length === 1 && lines[0].match(/^(#{1,3})\s+(.+)$/);
      if (heading) return <h3 key={`${index}-${paragraphIndex}`}><InlineText text={heading[2]} /></h3>;
      return <p key={`${index}-${paragraphIndex}`}>{lines.map((line, lineIndex) => <React.Fragment key={lineIndex}>{lineIndex > 0 && <br />}<InlineText text={line} /></React.Fragment>)}</p>;
    }));
}

function ApprovalCard({ turn, state, onResolve, names }) {
  const request = turn.request;
  const busy = state === 'sending';
  const settled = state === 'resolved' || Boolean(turn.terminal);
  const error = typeof state === 'object' ? state.error : null;
  const expired = Number(request.expires_at || 0) > 0 && Number(request.expires_at) <= Date.now();
  const spec = useMemo(() => approvalFormSpec(request.payload || {}), [request.payload]);
  const [values, setValues] = useState(() => initialFieldValues(spec));
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
      {spec.mode === 'fields' ? <DynamicFields className="approval-fields" spec={spec} values={values} onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))} /> : <details className="approval-advanced"><summary>高级选项</summary><label className="approval-json"><span>附加 JSON（可选）</span><textarea rows={3} value={rawJSON} onChange={(event) => setRawJSON(event.target.value)} /></label></details>}
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

function AttachmentCards({ attachments = [], onDownload, onPreview }) {
  if (!attachments.length) return null;
  return <section className="message-attachments" aria-label="消息附件">{attachments.map((row) => {
    const mediaType = row.media_type || 'application/octet-stream';
    const typeLabel = mediaType.startsWith('image/') ? '图片' : mediaType === 'application/pdf' ? 'PDF' : mediaType.startsWith('audio/') ? '音频' : mediaType.startsWith('video/') ? '视频' : mediaType.startsWith('text/') ? '文本' : '文件';
    const name = row.name || row.resource_id;
    return <article className="message-attachment" key={row.resource_id}><button type="button" className="message-attachment-open" onClick={() => onPreview?.(row)} aria-label={`预览 ${name}`}><span className="attachment-icon" aria-hidden="true">{mediaType === 'application/pdf' ? 'PDF' : mediaType.startsWith('image/') ? '▧' : '◇'}</span><span><strong>{name}</strong><small>{typeLabel} · {formatArtifactSize(Number(row.size || 0))}</small></span></button><button type="button" className="message-attachment-download" onClick={() => onDownload?.(row)} aria-label={`下载 ${name}`}>↓</button></article>;
  })}</section>;
}

function MessageActions({ onOpen, onCreateTask }) {
  return <div className="message-actions" aria-label="条目操作">
    {onOpen && <button type="button" onClick={onOpen}>打开详情</button>}
    {onCreateTask && <button type="button" onClick={onCreateTask}>创建任务</button>}
  </div>;
}

function TurnCard({ turn, names, selfId, access, capability, controlState, continuation = false, onCancel, onControl, onDownload, onPreview, onOpen, onCreateTask }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const self = request.sender?.id === selfId;
  const controlContext = taskControlContext(turn, { selfId, access, capability });
  return (
    <section className={`turn-card ${continuation ? 'continuation' : ''} ${self ? 'self' : ''} status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
      <article className="message-row request-message" tabIndex="0">
        <MessageActions onOpen={onOpen} onCreateTask={onCreateTask} />
        <span className={`actor-icon kind-${request.sender?.kind}`}>{request.sender?.kind?.slice(0, 1).toUpperCase()}</span>
        <div className="message-body">
          <header><strong>{nameOf(request.sender?.id, names)}</strong>{request.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(request.ts)}</time>{request.audience?.length > 0 && <span className="recipient-label">发送给 {request.audience.map((id) => nameOf(id, names)).join('、')}</span>}</header>
          <div className="request-text"><MarkdownLite text={requestView.text} />{requestView.detail && <p className="message-detail">{requestView.detail}</p>}</div>
          <AttachmentCards attachments={request.payload?.attachments} onDownload={onDownload} onPreview={onPreview} />
        </div>
      </article>
      {turn.terminal && (
        <article className={turn.status === 'failed' ? 'message-row final-answer turn-response failed' : 'message-row final-answer turn-response'} tabIndex="0">
          <span className={`actor-icon kind-${turn.terminal.sender?.kind || 'agent'}`}>{(turn.terminal.sender?.kind || 'agent').slice(0, 1).toUpperCase()}</span>
          <div className="message-body response-body"><header><strong>{nameOf(turn.terminal.sender?.id || request.audience?.[0], names)}</strong><small className="ai-label">AI</small><time>{timeLabel(turn.terminal.ts)}</time>{turn.status === 'failed' && <span className="response-failed">处理失败</span>}</header><div className="response-content"><StructuredResult requestType={request.type} payload={turn.terminal.payload} renderText={(text) => <MarkdownLite text={text} />} /></div></div>
        </article>
      )}
      {(turn.provisional.length > 0 || turn.activity.length > 0) && <button type="button" className={`turn-process-summary ${turn.terminal ? 'completed' : 'active'}`} onClick={onOpen}>
        <span className={turn.terminal ? 'pulse done' : 'pulse'} />
        <span>{turn.terminal ? turnStatusLabel(turn) : (latestHumanProgress(turn) || '正在处理')}</span>
        <small>{turnProcessSummary(turn)}</small>
        <span aria-hidden="true">查看过程 ›</span>
      </button>}
      {!turn.terminal && <TaskControls context={controlContext} state={controlState} onCancel={onCancel} onControl={onControl} />}
    </section>
  );
}

function SystemEventRow({ envelope, names, important = false }) {
  const detail = systemEventDetail(envelope);
  return <article className={important ? 'system-event-row important' : 'system-event-row'}>
    <span className="system-event-mark" aria-hidden="true">{important ? '!' : '✓'}</span>
    <div><strong>{systemEventLabel(envelope)}</strong>{detail && <p>{detail}</p>}<small>{nameOf(envelope.sender?.id, names)} · {timeLabel(envelope.ts)}</small></div>
  </article>;
}

function Narration({ rows, names }) {
  const [open, setOpen] = useState(false);
  const important = rows.filter((row) => systemEventTier(row.envelope) === 'important');
  const diagnostic = rows.filter((row) => systemEventTier(row.envelope) !== 'important');
  const visibleDiagnostic = diagnostic.slice(-LIST_WINDOW_SIZE);
  return (
    <section className="narration">
      {important.map(({ seq, envelope }) => <SystemEventRow key={`${seq}-${envelope.id}`} envelope={envelope} names={names} important />)}
      {diagnostic.length > 0 && <button className="narration-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="narration-icon" aria-hidden="true">◷</span><span><strong>后台活动</strong><small>{diagnostic.length} 条状态更新</small></span><span className="narration-action">{open ? '收起' : '查看'} {open ? '⌃' : '⌄'}</span></button>}
      {open && <div className="system-event-list">{diagnostic.length > visibleDiagnostic.length && <p className="bounded-list-note">这里只显示最近 {visibleDiagnostic.length} 条；完整技术事实保留在审计记录中。</p>}{visibleDiagnostic.map(({ seq, envelope }) => <SystemEventRow key={`${seq}-${envelope.id}`} envelope={envelope} names={names} />)}</div>}
    </section>
  );
}

function Standalone({ envelope, names, continuation = false, onCreateTask }) {
  const view = messagePresentation(envelope);
  return (
    <article className={`standalone-row ${continuation ? 'continuation' : ''}`} tabIndex="0">
      <MessageActions onCreateTask={onCreateTask} />
      {continuation ? <time className="continuation-time" aria-label={`${nameOf(envelope.sender?.id, names)}，${timeLabel(envelope.ts)}`}>{timeLabel(envelope.ts)}</time> : <span className={`actor-icon kind-${envelope.sender?.kind}`}>{envelope.sender?.kind?.slice(0, 1).toUpperCase()}</span>}
      <div>{!continuation && <header><strong>{nameOf(envelope.sender?.id, names)}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(envelope.ts)}</time></header>}<MarkdownLite text={view.text} />{view.detail && <p className="message-detail">{view.detail}</p>}</div>
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

function isTransientEntry(entry) {
  return entry.kind === 'standalone'
    && (entry.envelope.payload?.transient === true || entry.envelope.type === 'mock.channel.pulse');
}

function entryAuthor(entry) {
  return entry.kind === 'turn' ? entry.turn.request?.sender?.id : entry.kind === 'standalone' ? entry.envelope.sender?.id : '';
}

function entryEndAuthor(entry) {
  if (entry.kind === 'turn') return entry.turn.terminal?.sender?.id || entry.turn.request?.sender?.id;
  return entry.kind === 'standalone' ? entry.envelope.sender?.id : '';
}

function entryTimestamp(entry) {
  return Number(entry.kind === 'turn' ? entry.turn.request?.ts : entry.kind === 'standalone' ? entry.envelope.ts : 0) || 0;
}

function isContinuation(entries, index) {
  if (index <= 0 || !['turn', 'standalone'].includes(entries[index]?.kind) || !['turn', 'standalone'].includes(entries[index - 1]?.kind)) return false;
  const current = entries[index];
  const previous = entries[index - 1];
  const delta = entryTimestamp(current) - entryTimestamp(previous);
  return entryAuthor(current) && entryAuthor(current) === entryEndAuthor(previous) && delta >= 0 && delta <= 5 * 60_000;
}

function dayKey(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(ts) {
  const date = new Date(ts);
  const now = new Date();
  if (dayKey(ts) === dayKey(now.getTime())) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (dayKey(ts) === dayKey(yesterday)) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

export function Timeline({ state, roster, selfId, pending, approvalStates, controlStates = {}, capabilityIndex = new Map(), access = '', onResolve, onRetry, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask }) {
  const timelineRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const previousSeqRef = useRef(state.lastSeq);
  const [page, setPage] = useState(0);
  const [unseenCount, setUnseenCount] = useState(0);
  const names = useMemo(() => new Map(roster.map((row) => [row.id, row.name || row.id])), [roster]);
  const entries = useMemo(() => orderedTimeline(state), [state, state.lastSeq, state.turns.size, state.standalone.length, state.orphans.length]);
  const latestTransient = new Map();
  for (const entry of entries) {
    if (isTransientEntry(entry)) {
      latestTransient.set(`${entry.envelope.sender?.id || ''}:${entry.envelope.type}`, entry);
    }
  }
  const visibleEntries = entries.filter((entry) => (
    !isTransientEntry(entry)
    || latestTransient.get(`${entry.envelope.sender?.id || ''}:${entry.envelope.type}`) === entry
  ));
  const narrationSeq = state.narration[0]?.seq ?? Number.POSITIVE_INFINITY;
  const withNarration = [...visibleEntries, ...(state.narration.length ? [{ kind: 'narration', seq: narrationSeq }] : [])]
    .sort((left, right) => left.seq - right.seq);
  const windowed = boundedPage(withNarration, page);

  useEffect(() => {
    setPage(0);
    setUnseenCount(0);
    previousSeqRef.current = state.lastSeq;
    stickToBottomRef.current = true;
  }, [state.channelId]);

  useEffect(() => {
    const previous = previousSeqRef.current;
    if (state.lastSeq > previous && !stickToBottomRef.current) setUnseenCount((value) => value + Math.max(1, state.lastSeq - previous));
    previousSeqRef.current = state.lastSeq;
  }, [state.lastSeq]);

  useEffect(() => {
    if (page !== windowed.page) setPage(windowed.page);
  }, [page, windowed.page]);

  useLayoutEffect(() => {
    const node = timelineRef.current;
    if (node && page === 0 && stickToBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [page, state.lastSeq, pending.length]);

  function observeScroll(event) {
    const node = event.currentTarget;
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    if (stickToBottomRef.current) setUnseenCount(0);
  }

  function jumpToLatest() {
    setPage(0);
    setUnseenCount(0);
    stickToBottomRef.current = true;
    requestAnimationFrame(() => { if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight; });
  }

  return (
    <section id="workspace-panel-dynamic" className="timeline" role="tabpanel" aria-labelledby="workspace-tab-dynamic" aria-live="polite" aria-atomic="false" aria-relevant="additions text" ref={timelineRef} onScroll={observeScroll}>
      <div className="timeline-inner">
        {!state.rows.size && !pending.length && <div className="empty-ledger"><span>#</span><h2>这本账还没有可见条目</h2><p>从下方编辑器 @ 一位成员开始。</p></div>}
        {windowed.hasOlder && <button type="button" className="bounded-list-control" onClick={() => { stickToBottomRef.current = false; setPage((value) => value + 1); }}>查看更早动态（当前 {windowed.start + 1}–{windowed.end} / {windowed.total}）</button>}
        {windowed.items.map((entry, index) => {
          const continuation = isContinuation(windowed.items, index);
          const timestamp = entryTimestamp(entry);
          const previousTimestamp = windowed.items.slice(0, index).reverse().map(entryTimestamp).find(Boolean) || 0;
          const showDay = timestamp > 0 && (!previousTimestamp || dayKey(timestamp) !== dayKey(previousTimestamp));
          let content;
          if (entry.kind === 'narration') content = <Narration rows={state.narration} names={names} />;
          if (
            entry.kind === 'turn'
            && entry.turn.request.type === TYPES.humanApprove
            && selfId
            && entry.turn.request.audience?.includes(selfId)
          ) {
            content = <ApprovalCard turn={entry.turn} state={approvalStates[entry.turn.request.id]} onResolve={(reqId, decision, payload) => onResolve(state.channelId, reqId, decision, payload)} names={names} />;
          }
          if (!content && entry.kind === 'turn') {
            const actorId = entry.turn.request.audience?.length === 1 ? entry.turn.request.audience[0] : '';
            const controlKey = `${state.channelId}:${entry.turn.requestId}:cancel`;
            const source = { view: 'dynamic', objectType: 'turn', objectId: entry.turn.requestId, seq: entry.turn.requestSeq };
            content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.turn.requestId}><TurnCard turn={entry.turn} names={names} selfId={selfId} access={access} capability={capabilityIndex.get(actorId)} controlState={controlStates[controlKey]} continuation={continuation} onCancel={() => onCancel?.(state.channelId, entry.turn.requestId)} onControl={(type, payload) => onTaskControl?.({ channelId: state.channelId, turn: entry.turn, actorId, type, payload })} onDownload={(attachment) => onDownloadResource?.(state.channelId, attachment)} onPreview={(attachment) => onPreviewResource?.(state.channelId, attachment)} onOpen={() => onOpenTurn?.(entry.turn)} onCreateTask={onCreateTask ? () => onCreateTask(source) : null} /></div>;
          }
          if (!content) {
            const source = { view: 'dynamic', objectType: 'message', objectId: entry.envelope.id, seq: entry.seq };
            content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.envelope.id}><Standalone envelope={entry.envelope} names={names} continuation={continuation} onCreateTask={onCreateTask ? () => onCreateTask(source) : null} /></div>;
          }
          const key = entry.kind === 'turn' ? entry.turn.request.id : entry.kind === 'narration' ? 'narration' : `${entry.kind}-${entry.envelope.id}`;
          return <React.Fragment key={key}>{showDay && <div className="timeline-day"><span>{dayLabel(timestamp)}</span></div>}{content}</React.Fragment>;
        })}
        {windowed.hasNewer && <button type="button" className="bounded-list-control" onClick={() => setPage((value) => Math.max(0, value - 1))}>查看更新动态（{windowed.end + 1}–{Math.min(windowed.total, windowed.end + LIST_WINDOW_SIZE)}）</button>}
        {pending.slice(-50).map((item) => <PendingRow key={item.key} item={item} onRetry={onRetry} />)}
        {pending.length > 50 && <p className="bounded-list-note">仅显示最近 50 个本地提交状态。</p>}
        {unseenCount > 0 && page === 0 && <button type="button" className="timeline-jump-latest" onClick={jumpToLatest}>↓ {unseenCount} 条新动态</button>}
      </div>
    </section>
  );
}
