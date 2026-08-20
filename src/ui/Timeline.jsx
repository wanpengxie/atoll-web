import React, { useEffect, useMemo, useState } from 'react';
import { actorNameFromMap, actorNameMap } from '../model/actor-display.js';
import { resolveFormSpec } from '../model/dynamic-form.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { orderedTimeline } from '../model/fold.js';
import { boundedPage, LIST_WINDOW_SIZE } from '../model/list-window.js';
import { messagePresentation } from '../model/message-presentation.js';
import { systemEventPresentation } from '../model/system-event-presentation.js';
import { taskControlContext } from '../model/task-controls.js';
import { latestHumanProgress, turnProcessSummary, turnStatusLabel } from '../model/turn-presentation.js';
import { argsOf } from '../protocol/envelope.js';
import { DECISIONS, TYPES } from '../protocol/vocab.js';
import { StructuredResult } from './StructuredResult.jsx';
import { MarkdownContent } from './MarkdownContent.jsx';
import { TurnInlineDetail } from './context/TurnContext.jsx';
import { ContentFrame, MessageFrame } from './timeline/InformationFlow.jsx';
import { useStableTimelineScroll } from './timeline/useStableTimelineScroll.js';

// 平台叙事（成员进出、跨频道入站）暂时不进时间线。它和真正的往来平铺在同一条流里，
// 每次 agent 干活就刷出一串，把人要读的东西淹掉。数据仍然在 state.narration 里，
// 什么都没丢——等它有了合适的落位（侧栏或频道信息页）再接回来。
const SHOW_CHANNEL_NARRATION = false;

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
  return actorNameFromMap(id, names);
}

function ApprovalCard({ turn, state, onResolve, names }) {
  const request = turn.request;
  const busy = state === 'sending';
  const settled = state === 'resolved' || Boolean(turn.terminal);
  const error = typeof state === 'object' ? state.error : null;
  const expired = Number(request.expires_at || 0) > 0 && Number(request.expires_at) <= Date.now();
  const spec = useMemo(() => resolveFormSpec(request.type), [request.type]);
  const [answer, setAnswer] = useState('');
  const [formError, setFormError] = useState('');

  // resolve 帧的字段闭集由 subjectgate 定死：human.ask 只带 text，human.approve
  // 只带 decision（approve / reject）+ 可选 note。
  function submitAnswer() {
    setFormError('');
    if (!answer.trim()) { setFormError('回答不能为空'); return; }
    onResolve(request.id, '', { text: answer });
  }

  function decide(decision) {
    setFormError('');
    onResolve(request.id, decision, answer.trim() ? { note: answer.trim() } : {});
  }

  return (
    <article className={`approval-card ${settled ? 'settled' : ''}`}>
      <header><span>{spec.mode === 'text' ? '需要你的回答' : '需要你的决定'}</span><small>{nameOf(request.sender?.id, names)} · {timeLabel(request.ts)}</small></header>
      <div className="approval-summary"><strong>{request.payload?.title || request.payload?.text || request.type}</strong>{request.payload?.detail && <p>{request.payload.detail}</p>}{request.payload?.impact && <p><b>影响：</b>{request.payload.impact}</p>}</div>
      <label className="approval-answer"><span>{spec.label}</span><textarea rows={spec.mode === 'text' ? 4 : 2} value={answer} disabled={busy || settled || expired} onChange={(event) => { setAnswer(event.target.value); setFormError(''); }} /></label>
      {request.expires_at && <p className={expired ? 'approval-expired' : 'approval-deadline'}>{expired ? '已过期，不能再处理' : `截止：${new Date(request.expires_at).toLocaleString('zh-CN')}`}</p>}
      <div className="approval-actions">
        {spec.mode === 'text'
          ? <button type="button" className="approve" disabled={busy || settled || expired} onClick={submitAnswer}>提交回答</button>
          : (<>
            <button type="button" className="approve" disabled={busy || settled || expired} onClick={() => decide(DECISIONS.approve)}>批准</button>
            <button type="button" className="reject" disabled={busy || settled || expired} onClick={() => decide(DECISIONS.reject)}>拒绝</button>
          </>)}
        {settled && <span>已回执</span>}
      </div>
      {formError && <p className="approval-form-error" role="alert">{formError}</p>}
      {turn.terminal && (
        <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}>
          <p className="answer-label">RESPONSE · {String(turn.terminal.payload?.status || '').toUpperCase()}</p>
          <p className="approval-resolver">处理者：{nameOf(turn.terminal.sender?.id, names)}{turn.terminal.payload?.decision && ` · ${turn.terminal.payload.decision}`}</p>
          <StructuredResult requestType={request.type} payload={turn.terminal.payload} renderText={(text) => <MarkdownContent text={text} />} />
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
        {context.canInterrupt && <button type="button" className="interrupt" onClick={() => onControl(TYPES.agentInterrupt, {})}>打断回合</button>}
      </div>
      {state.status === 'accepted' && <p className="control-status">取消请求已受理，等待原任务终态。</p>}
      {state.status === 'uncertain' && <p className="control-status uncertain">取消结果待确认，将以重连后的账本为准。</p>}
      {state.error && <WireErrorLine error={state.error} />}
      {steering && <div className="steer-form"><textarea aria-label="新方向" rows={3} value={steerText} onChange={(event) => setSteerText(event.target.value)} placeholder="输入新的任务方向" /><div><button type="button" onClick={() => setSteering(false)}>取消</button><button type="button" disabled={!steerText.trim()} onClick={() => { onControl(TYPES.agentSteer, { text: steerText.trim(), expected_turn_id: context.turnId }); setSteering(false); setSteerText(''); }}>提交方向</button></div></div>}
      {context.expiresAt > 0 && !context.expired && <small className="wait-hint">截止时间 {new Date(context.expiresAt).toLocaleString("zh-CN")}；超过后仍以账本终态为准。</small>}
    </section>
  );
}

function AttachmentCards({ attachments = [], onDownload, onPreview }) {
  if (!attachments.length) return null;
  return <section className="message-attachments" aria-label="附件列表">{attachments.map((row) => {
    const mediaType = row.media_type || 'application/octet-stream';
    const typeLabel = mediaType.startsWith('image/') ? '图片' : mediaType === 'application/pdf' ? 'PDF' : mediaType.startsWith('audio/') ? '音频' : mediaType.startsWith('video/') ? '视频' : mediaType.startsWith('text/') ? '文本' : '文件';
    const name = row.name || row.resource_id;
    return <article className="message-attachment" key={row.resource_id}><button type="button" className="message-attachment-open" onClick={() => onPreview?.(row)} aria-label={`预览 ${name}`}><span className="attachment-icon" aria-hidden="true">{mediaType === 'application/pdf' ? 'PDF' : mediaType.startsWith('image/') ? '▧' : '◇'}</span><span><strong>{name}</strong><small>{typeLabel} · {formatArtifactSize(Number(row.size || 0))}</small></span></button><button type="button" className="message-attachment-download" onClick={() => onDownload?.(row)} aria-label={`下载 ${name}`}>↓</button></article>;
  })}</section>;
}

function MessageActions({ onCreateTask }) {
  if (!onCreateTask) return null;
  return <div className="message-actions" aria-label="条目操作"><button type="button" onClick={onCreateTask}>创建任务</button></div>;
}

// 一次被叫出来的调用。行本身就是它的开关：点开看它自己的结果，就地展开，不劫持
// 整页的选中态——否则点一下什么都不发生，那比不能点更糟。
function ThreadCall({ item, names }) {
  const [open, setOpen] = useState(false);
  const child = item.turn;
  const view = messagePresentation(child.request);
  const receivers = (child.request.audience || []).map((id) => nameOf(id, names)).join('、');
  return (
    <li className={`turn-thread-item status-${child.status}`} style={{ '--thread-depth': item.depth }}>
      <button type="button" className="turn-thread-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <strong>{view.text}</strong>
        {view.detail && <span className="turn-thread-detail">{view.detail}</span>}
        <small>{nameOf(child.request.sender?.id, names)} → {receivers || '—'} · {turnStatusLabel(child)} · {timeLabel(child.request.ts)}</small>
      </button>
      {open && (child.terminal
        ? <div className="turn-thread-result"><StructuredResult requestType={child.request.type} payload={child.terminal.payload} renderText={(text) => <MarkdownContent text={text} />} /></div>
        : <p className="turn-thread-result empty">还没有终态。</p>)}
    </li>
  );
}

// 回合里被叫出来的那些调用。默认收起：读的人先看到"这一问的答案"，需要时才展开
// "为了答它做了什么"。展开后按深度缩进，孙代看得出是谁叫出来的。
function ThreadCalls({ thread, names }) {
  const [open, setOpen] = useState(false);
  if (!thread?.length) return null;
  const failed = thread.filter((item) => item.turn.status === 'failed').length;
  const running = thread.filter((item) => !item.turn.terminal).length;
  return (
    <ContentFrame contained>
      <button type="button" className={`turn-thread-toggle${failed ? ' has-failure' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span aria-hidden="true">⤷</span>
        <span>{thread.length} 次关联调用</span>
        <small>{[failed ? `${failed} 个失败` : '', running ? `${running} 个进行中` : ''].filter(Boolean).join(' · ') || '全部完成'}</small>
        <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && <ol className="turn-thread-list">{thread.map((item) => <ThreadCall key={item.turn.requestId} item={item} names={names} />)}</ol>}
    </ContentFrame>
  );
}

function TurnCard({ turn, thread = [], roster, names, selfId, access, capability, controlState, continuation = false, detailsOpen = false, onCancel, onControl, onDownload, onPreview, onOpen, onCreateTask, onCloseDetail }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const self = request.sender?.id === selfId;
  const controlContext = taskControlContext(turn, { selfId, access, capability });
  return (
    <section className={`turn-card ${continuation ? 'continuation' : ''} ${self ? 'self' : ''} status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
      <MessageFrame className="request-message" actions={<MessageActions onCreateTask={onCreateTask} />} identity={<span className={`actor-icon kind-${request.sender?.kind}`}>{request.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(request.sender?.id, names)}</strong>{request.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(request.ts)}</time>{request.audience?.length > 0 && <span className="recipient-label">发送给 {request.audience.map((id) => nameOf(id, names)).join('、')}</span>}</header>
          <div className="request-text"><MarkdownContent text={requestView.text} />{requestView.detail && <p className="message-detail">{requestView.detail}</p>}</div>
          <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
      </MessageFrame>
      <ThreadCalls thread={thread} names={names} />
      {(turn.provisional.length > 0 || turn.activity.length > 0) && <ContentFrame contained><button type="button" className={`turn-process-summary ${turn.terminal ? 'completed' : 'active'}`} onClick={onOpen} aria-expanded={detailsOpen}>
          <span className={turn.terminal ? 'pulse done' : 'pulse'} />
          <span>{turn.terminal ? turnStatusLabel(turn) : (latestHumanProgress(turn) || '正在处理')}</span>
          <small>{turnProcessSummary(turn)}</small>
          <span aria-hidden="true">查看过程 ›</span>
        </button></ContentFrame>}
      {detailsOpen && <ContentFrame contained><TurnInlineDetail turn={turn} roster={roster} selfId={selfId} access={access} capability={capability} controlState={controlState} onCancel={onCancel} onControl={onControl} onDownload={onDownload} onCreateTask={onCreateTask} onClose={onCloseDetail} /></ContentFrame>}
      {!turn.terminal && !detailsOpen && <ContentFrame contained><TaskControls context={controlContext} state={controlState} onCancel={onCancel} onControl={onControl} /></ContentFrame>}
      {turn.terminal && (
        <MessageFrame className={turn.status === 'failed' ? 'final-answer turn-response failed' : 'final-answer turn-response'} contentClassName="response-body" identity={<span className={`actor-icon kind-${turn.terminal.sender?.kind || 'agent'}`}>{(turn.terminal.sender?.kind || 'agent').slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(turn.terminal.sender?.id || request.audience?.[0], names)}</strong><small className="ai-label">AI</small><time>{timeLabel(turn.terminal.ts)}</time>{turn.status === 'failed' && <span className="response-failed">处理失败</span>}</header><div className="response-content"><StructuredResult requestType={request.type} payload={turn.terminal.payload} renderText={(text) => <MarkdownContent text={text} />} /></div>
        </MessageFrame>
      )}
    </section>
  );
}

function SystemEventRow({ envelope, presentation, names }) {
  const important = presentation.tier === 'important';
  return <article className={important ? 'system-event-row important' : 'system-event-row'}>
    <span className="system-event-mark" aria-hidden="true">{important ? '!' : '✓'}</span>
    <div><strong>{presentation.title}</strong>{presentation.detail && <p>{presentation.detail}</p>}<small>{nameOf(envelope.sender?.id, names)} · {timeLabel(envelope.ts)}</small></div>
  </article>;
}

function Narration({ rows, names }) {
  const [open, setOpen] = useState(false);
  const presentedRows = rows
    .map((row) => ({ ...row, presentation: systemEventPresentation(row.envelope, names) }))
    .filter((row) => !row.presentation.hidden);
  const visibleRows = presentedRows
    .sort((left, right) => left.seq - right.seq)
    .slice(-LIST_WINDOW_SIZE);
  if (!presentedRows.length) return null;
  return (
    <section className="narration">
      <button className="narration-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="narration-icon" aria-hidden="true">◷</span><span><strong>频道活动</strong><small>{presentedRows.length} 条成员与状态更新</small></span><span className="narration-action">{open ? '收起' : '查看'} {open ? '⌃' : '⌄'}</span></button>
      {open && <div className="system-event-list">{presentedRows.length > visibleRows.length && <p className="bounded-list-note">这里只显示最近 {visibleRows.length} 条；完整技术事实保留在审计记录中。</p>}{visibleRows.map(({ seq, envelope, presentation }) => <SystemEventRow key={`${seq}-${envelope.id}`} envelope={envelope} presentation={presentation} names={names} />)}</div>}
    </section>
  );
}

function Standalone({ envelope, names, continuation = false, onCreateTask }) {
  const view = messagePresentation(envelope);
  return (
    <MessageFrame className={`standalone-row ${continuation ? 'continuation' : ''}`} actions={<MessageActions onCreateTask={onCreateTask} />} identity={continuation ? <time className="continuation-time" aria-label={`${nameOf(envelope.sender?.id, names)}，${timeLabel(envelope.ts)}`}>{timeLabel(envelope.ts)}</time> : <span className={`actor-icon kind-${envelope.sender?.kind}`}>{envelope.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
      {!continuation && <header><strong>{nameOf(envelope.sender?.id, names)}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(envelope.ts)}</time></header>}<MarkdownContent text={view.text} />{view.detail && <p className="message-detail">{view.detail}</p>}
    </MessageFrame>
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
  const isConversational = (entry) => entry?.kind === 'standalone'
    || (entry?.kind === 'turn' && ![TYPES.humanAsk, TYPES.humanApprove].includes(entry.turn.request.type));
  if (index <= 0 || !isConversational(entries[index]) || !isConversational(entries[index - 1])) return false;
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

export function Timeline({ state, roster, selfId, pending, approvalStates, controlStates = {}, capabilityIndex = new Map(), access = '', onResolve, onRetry, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, turnDetail }) {
  const [page, setPage] = useState(0);
  const names = useMemo(() => actorNameMap(roster), [roster]);
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
  const withNarration = [...visibleEntries, ...(SHOW_CHANNEL_NARRATION && state.narration.length ? [{ kind: 'narration', seq: narrationSeq }] : [])]
    .sort((left, right) => left.seq - right.seq);
  const windowed = boundedPage(withNarration, page);
  const { viewportRef, contentRef, unseenCount, observeScroll, jumpToLatest, leaveLatest } = useStableTimelineScroll({
    channelId: state.channelId,
    lastSeq: state.lastSeq,
    page,
    pendingCount: pending.length,
  });

  useEffect(() => setPage(0), [state.channelId]);

  useEffect(() => {
    if (page !== windowed.page) setPage(windowed.page);
  }, [page, windowed.page]);

  return (
    <section id="workspace-panel-dynamic" className="timeline" role="tabpanel" aria-labelledby="workspace-tab-dynamic" aria-live="polite" aria-atomic="false" aria-relevant="additions text" ref={viewportRef} onScroll={observeScroll}>
      <div className="timeline-inner" ref={contentRef}>
        {!state.rows.size && !pending.length && <div className="empty-ledger"><span>#</span><h2>这本账还没有可见条目</h2><p>从下方编辑器 @ 一位成员开始。</p></div>}
        {windowed.hasOlder && <button type="button" className="bounded-list-control" onClick={() => { leaveLatest(); setPage((value) => value + 1); }}>查看更早动态（当前 {windowed.start + 1}–{windowed.end} / {windowed.total}）</button>}
        {windowed.items.map((entry, index) => {
          const continuation = isContinuation(windowed.items, index);
          const timestamp = entryTimestamp(entry);
          const previousTimestamp = windowed.items.slice(0, index).reverse().map(entryTimestamp).find(Boolean) || 0;
          const showDay = timestamp > 0 && (!previousTimestamp || dayKey(timestamp) !== dayKey(previousTimestamp));
          let content;
          if (entry.kind === 'narration') content = <ContentFrame><Narration rows={state.narration} names={names} /></ContentFrame>;
          if (
            entry.kind === 'turn'
            && [TYPES.humanAsk, TYPES.humanApprove].includes(entry.turn.request.type)
            && selfId
            && entry.turn.request.audience?.includes(selfId)
          ) {
            content = <ContentFrame><ApprovalCard turn={entry.turn} state={approvalStates[entry.turn.request.id]} onResolve={(reqId, decision, payload) => onResolve(state.channelId, reqId, decision, payload)} names={names} /></ContentFrame>;
          }
          if (!content && entry.kind === 'turn') {
            const actorId = entry.turn.request.audience?.length === 1 ? entry.turn.request.audience[0] : '';
            const controlKey = `${state.channelId}:${entry.turn.requestId}:cancel`;
            const source = { view: 'dynamic', objectType: 'turn', objectId: entry.turn.requestId, seq: entry.turn.requestSeq };
            const detailsOpen = turnDetail?.selected?.requestId === entry.turn.requestId;
            content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.turn.requestId}><TurnCard turn={entry.turn} thread={entry.thread} roster={roster} names={names} selfId={selfId} access={access} capability={capabilityIndex.get(actorId)} controlState={controlStates[controlKey]} continuation={continuation} detailsOpen={detailsOpen} onCancel={() => onCancel?.(state.channelId, entry.turn.requestId)} onControl={(type, payload) => onTaskControl?.({ channelId: state.channelId, turn: entry.turn, actorId, type, payload })} onDownload={(attachment) => onDownloadResource?.(state.channelId, attachment)} onPreview={(attachment) => onPreviewResource?.(state.channelId, attachment)} onOpen={() => {
              if (detailsOpen) turnDetail?.onClose?.();
              else {
                // Expanding is a local reading action, not a new ledger entry. Stop the
                // bottom pin before the panel changes height so the clicked message does
                // not jump out of the viewport and appear attached to another turn.
                leaveLatest();
                onOpenTurn?.(entry.turn);
              }
            }} onCloseDetail={turnDetail?.onClose} onCreateTask={onCreateTask ? () => onCreateTask(source) : null} /></div>;
          }
          if (!content) {
            const source = { view: 'dynamic', objectType: 'message', objectId: entry.envelope.id, seq: entry.seq };
            content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.envelope.id}><Standalone envelope={entry.envelope} names={names} continuation={continuation} onCreateTask={onCreateTask ? () => onCreateTask(source) : null} /></div>;
          }
          const key = entry.kind === 'turn' ? entry.turn.request.id : entry.kind === 'narration' ? 'narration' : `${entry.kind}-${entry.envelope.id}`;
          return <React.Fragment key={key}>{showDay && <div className="timeline-day"><span>{dayLabel(timestamp)}</span></div>}{content}</React.Fragment>;
        })}
        {windowed.hasNewer && <button type="button" className="bounded-list-control" onClick={() => setPage((value) => Math.max(0, value - 1))}>查看更新动态（{windowed.end + 1}–{Math.min(windowed.total, windowed.end + LIST_WINDOW_SIZE)}）</button>}
        {pending.slice(-50).map((item) => <ContentFrame key={item.key}><PendingRow item={item} onRetry={onRetry} /></ContentFrame>)}
        {pending.length > 50 && <p className="bounded-list-note">仅显示最近 50 个本地提交状态。</p>}
        {unseenCount > 0 && page === 0 && <button type="button" className="timeline-jump-latest" onClick={() => { setPage(0); jumpToLatest(); }}>↓ {unseenCount} 条新动态</button>}
      </div>
    </section>
  );
}
