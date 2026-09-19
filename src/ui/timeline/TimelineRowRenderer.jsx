import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { formatArtifactSize } from '../../model/artifacts.js';
import { resolveFormSpec } from '../../model/dynamic-form.js';
import { terminalContentEnvelope, terminalResultPayload, terminalResultState } from '../../model/terminal-result.js';
import { LIST_WINDOW_SIZE } from '../../model/list-window.js';
import { messagePresentation } from '../../model/message-presentation.js';
import { replyTargetOf } from '../../model/reply-target.js';
import { selectSystemNote } from '../../model/agent-selection.js';
import { systemEventPresentation } from '../../model/system-event-presentation.js';
import { taskControlContext, taskControlPayload } from '../../model/task-controls.js';
import { isAgentMessageTurn, mergedInto, preemptedBy } from '../../model/agent-control.js';
import { latestHumanProgress, turnProcessSummary, turnStatusLabel } from '../../model/turn-presentation.js';
import { conversationTextObservations, finalEchoObservation, processCount, turnStartObservation, withoutFinalEcho } from '../../model/turn-process.js';
import { argsOf } from '../../protocol/envelope.js';
import { DECISIONS, TYPES } from '../../protocol/vocab.js';
import { messageTimeLabel } from '../../util/time.js';
import { StructuredResult, terminalPresentation } from '../StructuredResult.jsx';
import { MarkdownContent } from '../MarkdownContent.jsx';
import { TurnInlineDetail } from '../context/TurnContext.jsx';
import { FoldableBody } from './FoldableBody.jsx';
import { ContentFrame, MessageFrame } from './InformationFlow.jsx';
import { useMessageLayoutState } from './MessageLayoutState.jsx';
import { ProgressTrail } from './ProgressTrail.jsx';
import { editLeaseCapabilityState } from './useWaitingEditingController.jsx';
export const SHOW_CHANNEL_NARRATION = false;
export const EMPTY_CAPABILITY_INDEX = new Map();
export const EMPTY_CONTROL_STATES = {};
const REVISION_SEP = '\u0001';
export function revisionSlot(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export function revisionText(value) {
  return value ? `${value.length}${REVISION_SEP}${value}` : '0';
}
function stableRevisionValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stableRevisionValue).join(',')}]`;
  if (value instanceof Map) return `{${[...value.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, entry]) => `${stableRevisionValue(key)}:${stableRevisionValue(entry)}`)
    .join(',')}}`;
  if (value instanceof Set) return `[${[...value].map(stableRevisionValue).sort().join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value)
    .sort()
    .map((key) => `${stableRevisionValue(key)}:${stableRevisionValue(value[key])}`)
    .join(',')}}`;
  return JSON.stringify(value);
}
function capabilityRowRevision(capability) {
  const types = capability?.describe?.types;
  const typeContext = types instanceof Map
    ? new Map([...types].map(([type, meta]) => [type, {
      description: meta?.description || '',
      inputSchema: meta?.inputSchema || null,
    }]))
    : new Map();
  return stableRevisionValue({
    types: typeContext,
    loading: capability?.loading === true,
    error: capability?.error || null,
  });
}
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
  steer_missed: '没赶上这一轮，已排到下一轮执行',
  superseded: '已被更新的操作取代，任务已回到队列',
  control_timeout: '受理方没有在时限内回应',
  busy: '另一个控制正在进行，稍后再试',
  interrupted: '任务已被打断',
  cancelled: '任务已取消',
  empty_input: '控制内容不能为空',
};
function timeLabel(ts) {
  return messageTimeLabel(ts);
}
export function nameOf(id, names) {
  return actorNameFromMap(id, names);
}
export function ApprovalCard({ turn, state, onResolve, names }) {
  const request = turn.request;
  const terminal = terminalContentEnvelope(turn);
  const busy = state === 'sending';
  const settled = state === 'resolved' || Boolean(turn.terminal);
  const error = typeof state === 'object' ? state.error : null;
  const expired = Number(request.expires_at || 0) > 0 && Number(request.expires_at) <= Date.now();
  const spec = useMemo(() => resolveFormSpec(request.type), [request.type]);
  const [answer, setAnswer] = useState('');
  const [formError, setFormError] = useState('');
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
      <div className="approval-summary"><strong>{argsOf(request)?.title || argsOf(request)?.text || request.type}</strong>{argsOf(request)?.detail && <p>{argsOf(request).detail}</p>}{argsOf(request)?.impact && <p><b>影响：</b>{argsOf(request).impact}</p>}</div>
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
      {terminal && (
        <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}>
          <p className="answer-label">RESPONSE · {String(argsOf(terminal)?.status || '').toUpperCase()}</p>
          <p className="approval-resolver">处理者：{nameOf(terminal.sender?.id, names)}{argsOf(terminal)?.decision && ` · ${argsOf(terminal).decision}`}</p>
          <StructuredResult requestType={request.type} payload={argsOf(terminal)} renderText={(text) => <MarkdownContent contentKey={`terminal:${terminal.id || turn.requestId}:body`} text={text} />} />
        </footer>
      )}
      {turn.terminalClosureOnly && <footer className="final-answer unavailable"><p>{terminalResultState(turn).error}</p></footer>}
      {error && <WireErrorLine error={error} />}
    </article>
  );
}
function ActiveTaskControls({ context, editActive = false, onControl, onEdit }) {
  if (!context.workId && !context.canEdit && !context.editUnavailable && !context.editPending && !context.canStop) return null;
  return (
    <section className="task-controls" aria-label="任务控制">
      {context.workId && <div className="task-work-identity"><code>{context.workId}</code><span>{[context.workState, context.workStage, context.executionState].filter(Boolean).join(' · ')}</span></div>}
      <div className="task-control-buttons">
        {context.editUnavailable && <span className="task-control-unavailable">Agent 版本不支持安全编辑</span>}
        {context.editPending && <span className="task-control-unavailable">正在确认 Agent 编辑能力</span>}
        {context.canEdit && <button type="button" onClick={onEdit} disabled={editActive}>编辑</button>}
        {context.canStop && <button type="button" onClick={() => onControl(TYPES.agentInterrupt, taskControlPayload(context, TYPES.agentInterrupt))}>停止</button>}
      </div>
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
function MessageActions({ onCopy, copyState, onReply, onCreateTask }) {
  if (!onCopy && !onReply && !onCreateTask) return null;
  const feedback = copyState === 'copied' ? '已复制正文' : copyState === 'error' ? '复制失败' : '';
  return <div className={`message-actions${feedback ? ' has-feedback' : ''}`} aria-label="条目操作">
    {onCopy && <button type="button" onClick={onCopy}>{copyState === 'copied' ? '✓ 已复制' : '复制'}</button>}
    {onReply && <button type="button" onClick={onReply}>↩ 回复</button>}
    {onCreateTask && <button type="button" onClick={onCreateTask}>创建任务</button>}
    <span className="message-copy-feedback" role="status">{feedback}</span>
  </div>;
}
async function copyMessageText(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') throw new Error('clipboard unavailable');
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('copy failed');
}
function ReplyableMessageFrame({ replyTarget, copyText = '', onReply, onCreateTask, children, className = '', ...props }) {
  const gestureRef = useRef(null);
  const longPressRef = useRef(0);
  const feedbackRef = useRef(0);
  const [copyState, setCopyState] = useState('');
  const reply = replyTarget && onReply ? () => onReply(replyTarget) : null;
  const body = String(copyText || '').trim();
  useEffect(() => () => {
    clearTimeout(longPressRef.current);
    clearTimeout(feedbackRef.current);
  }, []);
  function clearLongPress() {
    clearTimeout(longPressRef.current);
    longPressRef.current = 0;
  }
  async function copyBody() {
    if (!body) return;
    clearTimeout(feedbackRef.current);
    try {
      await copyMessageText(body);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    feedbackRef.current = window.setTimeout(() => setCopyState(''), 1600);
  }
  function finishGesture(_event, cancelled = false) {
    clearLongPress();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!cancelled && gesture && !gesture.cancelled && !gesture.longPressed && reply) reply();
  }
  function onPointerDown(event) {
    if ((!reply && !body) || event.pointerType === 'mouse' || event.target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return;
    const gesture = { x: event.clientX, y: event.clientY, cancelled: false, longPressed: false };
    gestureRef.current = gesture;
    longPressRef.current = window.setTimeout(() => {
      if (gestureRef.current !== gesture || gesture.cancelled || !body) return;
      gesture.longPressed = true;
      void copyBody();
      navigator.vibrate?.(10);
    }, 480);
  }
  function onPointerMove(event) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      gesture.cancelled = true;
      clearLongPress();
    }
  }
  const actions = <MessageActions onCopy={body ? copyBody : null} copyState={copyState} onReply={reply} onCreateTask={onCreateTask} />;
  return <MessageFrame
    {...props}
    className={`replyable-message ${className}`.trim()}
    actions={actions}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={(event) => finishGesture(event)}
    onPointerCancel={(event) => finishGesture(event, true)}
    onContextMenu={(event) => {
      if (!body || !globalThis.matchMedia?.('(hover: none)').matches) return;
      event.preventDefault();
    }}
    onKeyDown={(event) => {
      if (reply && event.target === event.currentTarget && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        reply();
      }
    }}
  >{children}</MessageFrame>;
}
function ThreadCall({ item, names }) {
  const [open, setOpen] = useMessageLayoutState(`thread-call:${item.turn.requestId}`, false);
  const child = item.turn;
  const terminal = terminalContentEnvelope(child);
  const view = messagePresentation(child.request);
  const receivers = (child.request.audience || []).map((id) => nameOf(id, names)).join('、');
  return (
    <li className={`turn-thread-item status-${child.status}`} style={{ '--thread-depth': item.depth }}>
      <button type="button" className="turn-thread-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <strong>{view.text}</strong>
        {view.detail && <span className="turn-thread-detail">{view.detail}</span>}
        <small>{nameOf(child.request.sender?.id, names)} → {receivers || '—'} · {turnStatusLabel(child)} · {timeLabel(child.request.ts)}</small>
      </button>
      {open && (terminal
        ? <div className="turn-thread-result"><StructuredResult requestType={child.request.type} payload={argsOf(terminal)} renderText={(text) => <MarkdownContent contentKey={`terminal:${terminal.id || child.requestId}:body`} text={text} />} /></div>
        : <p className="turn-thread-result empty">{child.terminal ? terminalResultState(child).error : '还没有终态。'}</p>)}
    </li>
  );
}
function ThreadCalls({ thread, names }) {
  const [open, setOpen] = useMessageLayoutState('thread-calls', false);
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
function conversationPayload(payload = {}) {
  const { turn_index: _turnIndex, ...visible } = payload;
  return visible;
}
function latestTurnEnvelope(turn) {
  const values = (turn.provisional || [])
    .map((item) => ({ seq: Number(item.seq), envelope: item.envelope }))
    .sort((left, right) => left.seq - right.seq);
  return values.at(-1)?.envelope;
}
function turnStartedAt(turn) {
  return turnStartObservation(turn)?.envelope?.ts || turn.request?.ts;
}
function AgentRequestQuote({ request, names, onDownload, onPreview }) {
  const view = messagePresentation(request);
  const caller = nameOf(request.sender?.id, names);
  return <blockquote className="agent-request-quote">
    <header>
      <span>回复 <strong>{caller}</strong></span>
      <span aria-hidden="true">·</span>
      <time>{timeLabel(request.ts)}</time>
    </header>
    <div className="agent-request-quote-text"><MarkdownContent contentKey={`request:${request.id}:body`} text={view.text} /></div>
    <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
  </blockquote>;
}
function parsesAsStructuredJSON(text) {
  const source = String(text || '').trim();
  if (!source || !['{', '['].includes(source[0])) return false;
  try {
    const parsed = JSON.parse(source);
    return Boolean(parsed && typeof parsed === 'object');
  } catch {
    return false;
  }
}
function ConversationAnswerSlot({ requestType, text, terminalPayload = null, contentKey }) {
  if (!terminalPayload) return <MarkdownContent contentKey={contentKey} text={text} />;
  const result = terminalPresentation(requestType, terminalPayload);
  if (result.kind === 'text' && !result.empty && !parsesAsStructuredJSON(result.text)) {
    return <MarkdownContent contentKey={contentKey} text={result.text} />;
  }
  return <StructuredResult requestType={requestType} payload={terminalPayload} renderText={(value) => <MarkdownContent contentKey={contentKey} text={value} />} />;
}
function AgentBubble({ turn, title, mergedCount = 0, frozen = null, names, roster = [], selfId = '', quotedRequest = null, fold = null, onDownload, onPreview, onReply, onCreateTask, compact = false, compactExpanded = false, onCompactToggle = null, hasThreadChildren = false }) {
  const request = turn.request;
  const closed = Boolean(turn.terminal);
  const terminal = terminalContentEnvelope(turn);
  const responseFoldId = `${turn.requestId}:response`;
  const stopped = argsOf(terminal)?.status === 'failed' && argsOf(terminal)?.error_code === 'interrupted';
  const resumable = stopped && frozen?.source === TYPES.agentInterrupt && (!frozen.target_id || frozen.target_id === turn.requestId);
  const liveEnvelope = latestTurnEnvelope(turn);
  const agentId = turn.terminal?.sender?.id || liveEnvelope?.sender?.id || request.audience?.[0];
  const bubbleTs = turn.terminal?.ts || liveEnvelope?.ts;
  const processStartedTs = turnStartedAt(turn);
  const terminalText = terminal && !stopped ? messagePresentation(terminal).text : '';
  const allConversationTexts = conversationTextObservations(turn);
  const echoObservation = terminal && !stopped ? finalEchoObservation(allConversationTexts, terminalText) : null;
  const conversationTexts = withoutFinalEcho(allConversationTexts, terminalText);
  const foldText = [...conversationTexts.map(({ process }) => process.text), terminalText].filter(Boolean).join('\n\n');
  const className = `agent-turn-bubble${closed ? ' settled' : ' processing'}${compact ? ' compact' : ''}${hasThreadChildren ? ' has-thread-children' : ''}`;
  const identity = <span className="actor-icon kind-agent">A</span>;
  const heading = <header><strong>{nameOf(agentId, names)}</strong><small className="ai-label">AI</small>{bubbleTs && <time>{timeLabel(bubbleTs)}</time>}</header>;
  const conversationSlots = conversationTexts.map(({ seq, envelope, process }) => {
      const slotID = envelope.id || `${turn.requestId}:${seq}`;
      return <div key={slotID} className="agent-progress-text" data-seq={seq}><ConversationAnswerSlot requestType={request.type} contentKey={`answer:${turn.requestId}:${slotID}:body`} text={process.text} /></div>;
    });
  if (terminal && !stopped) conversationSlots.push(echoObservation
    ? <div key={echoObservation.envelope.id || `${turn.requestId}:${echoObservation.seq}`} className="agent-final-text" data-seq={echoObservation.seq}><ConversationAnswerSlot requestType={request.type} contentKey={`answer:${turn.requestId}:${echoObservation.envelope.id || `${turn.requestId}:${echoObservation.seq}`}:body`} text={echoObservation.process.text} terminalPayload={conversationPayload(argsOf(terminal))} /></div>
    : <div key={terminal.id || `${turn.requestId}:terminal`} className="agent-final-text"><StructuredResult requestType={request.type} payload={conversationPayload(argsOf(terminal))} renderText={(text) => <MarkdownContent contentKey={`terminal:${terminal.id || turn.requestId}:body`} text={text} />} /></div>);
  const conversationBody = <>{conversationSlots}</>;
  const hasConversationBody = conversationTexts.length > 0 || Boolean(terminal && !stopped);
  const content = <>
    {quotedRequest && <AgentRequestQuote request={quotedRequest} names={names} onDownload={onDownload} onPreview={onPreview} />}
    {hasConversationBody && <div className="response-content">{compact
      ? conversationBody
      : <FoldableBody id={responseFoldId} text={foldText} exempt={Boolean(fold?.latest)} automaticExpanded={fold?.automaticExpanded} expanded={fold?.overrides?.get(responseFoldId)} onToggle={fold?.onToggle}>{conversationBody}</FoldableBody>}</div>}
    {!closed && <ProgressTrail turn={turn} running title={title} startedAt={processStartedTs} mergedCount={mergedCount} />}
    {stopped && <p className="agent-stopped">✗ 已停止{resumable ? ' · 发消息即继续' : ''}</p>}
    {closed && !terminal && <p className="terminal-result-unavailable">{terminalResultState(turn).error}</p>}
    {closed && <ProgressTrail turn={turn} running={false} />}
  </>;
  if (compact) return <article className={`agent-thread-message ${className}${compactExpanded ? ' is-expanded' : ' is-collapsed'}`} tabIndex="0">
    <div className="agent-thread-identity-row">{identity}{heading}{onCompactToggle && <button type="button" className="agent-thread-collapse-toggle" aria-label={`${compactExpanded ? '收起' : '展开'} ${nameOf(agentId, names)} 的协作消息`} aria-expanded={compactExpanded} onClick={onCompactToggle}><span aria-hidden="true">⌄</span></button>}</div>
    <div className="agent-thread-content" aria-hidden={!compactExpanded} inert={!compactExpanded ? true : undefined}>{content}</div>
  </article>;
  const replyTarget = terminal && argsOf(terminal)?.status === 'completed'
    ? replyTargetOf(terminal, { roster, selfId })
    : null;
  return <ReplyableMessageFrame replyTarget={replyTarget} copyText={terminal ? messagePresentation(terminal).text : ''} onReply={onReply} onCreateTask={onCreateTask} className={className} contentClassName="response-body" identity={identity}>{heading}{content}</ReplyableMessageFrame>;
}
function hasLaterThreadSibling(items, index, depth) {
  for (let cursor = index + 1; cursor < items.length; cursor += 1) {
    const nextDepth = items[cursor].depth;
    if (nextDepth < depth) return false;
    if (nextDepth === depth) return true;
  }
  return false;
}
function ancestorThreadIndex(items, index, depth) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidateDepth = items[cursor].depth;
    if (candidateDepth === depth) return cursor;
    if (candidateDepth < depth) return -1;
  }
  return -1;
}
function threadRails(items, index) {
  const depth = items[index].depth;
  const rails = [];
  for (let level = 1; level <= depth; level += 1) {
    const ownerIndex = level === depth ? index : ancestorThreadIndex(items, index, level);
    if (ownerIndex < 0) continue;
    const continues = hasLaterThreadSibling(items, ownerIndex, level);
    if (level < depth && !continues) continue;
    rails.push({ level, continues });
  }
  return rails;
}
function AgentThreadMessages({ thread = [], names, onDownload, onPreview }) {
  const [expanded, setExpanded] = useMessageLayoutState('agent-thread-expanded', []);
  const collaborative = thread.filter((item) => isAgentMessageTurn(item.turn) && item.turn.request?.sender?.kind === 'agent');
  if (!collaborative.length) return null;
  return <ol className="agent-message-thread" role="tree" aria-label="Agent 协作消息">
    {collaborative.map((item, index) => {
      const child = item.turn;
      const request = child.request;
      const requestView = messagePresentation(request);
      const rails = threadRails(collaborative, index);
      const hasChildren = collaborative[index + 1]?.depth === item.depth + 1;
      const nodeExpanded = expanded.includes(child.requestId);
      return <li key={child.requestId} className={`agent-thread-node status-${child.status}${hasChildren ? ' has-children' : ''}`} style={{ '--thread-depth': item.depth }} role="treeitem" aria-level={item.depth + 1}>
        <span className="agent-thread-elbow" aria-hidden="true" />
        {rails.map((rail) => <span key={rail.level} className={`agent-thread-rail ${rail.continues ? 'continues' : 'ends'}`} style={{ '--thread-rail-level': rail.level }} aria-hidden="true" />)}
        {hasChildren && <span className="agent-thread-child-stem" aria-hidden="true" />}
        <div className="agent-thread-response"><AgentBubble turn={child} title={requestView.text} names={names} quotedRequest={request} onDownload={onDownload} onPreview={onPreview} compact compactExpanded={nodeExpanded} onCompactToggle={() => setExpanded((current) => {
          const next = new Set(current);
          if (next.has(child.requestId)) next.delete(child.requestId);
          else next.add(child.requestId);
          return [...next];
        })} /></div>
      </li>;
    })}
  </ol>;
}
export function AgentConversationTurn({ turn, thread = [], leadTurns = [], mergedCount = 0, names, roster, selfId, access, targetAuthority, capability, frozen, fold = null, editActive, editSession = null, onControl, onEdit, onDownload, onPreview, onReply, onCreateTask }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const requestText = requestView.text;
  const requestFoldId = `${turn.requestId}:request`;
  const baseControlContext = taskControlContext(turn, { selfId, access, targetAuthority });
  const editCapability = editLeaseCapabilityState(capability);
  const controlContext = {
    ...baseControlContext,
    canEdit: baseControlContext.canEdit && editCapability === 'supported',
    editPending: baseControlContext.canEdit && editCapability === 'unknown',
    editUnavailable: baseControlContext.canEdit && editCapability === 'unsupported',
  };
  const lead = leadTurns.map((item) => messagePresentation(item.request).text);
  const processingTitle = [...lead, requestText].join(' ＋ ');
  const suppressAgentBubble = Boolean(turn.local || mergedInto(turn) || preemptedBy(turn));
  return <section className={`turn-card agent-conversation-turn self status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
    <MessageFrame className="request-message" identity={<span className="actor-icon kind-human">H</span>}>
      <header><strong>{nameOf(request.sender?.id, names)}</strong><time>{timeLabel(request.ts)}</time></header>
      <div className="request-text"><FoldableBody id={requestFoldId} text={requestText} exempt={Boolean(fold?.latest)} automaticExpanded={fold?.automaticExpanded} expanded={fold?.overrides?.get(requestFoldId)} onToggle={fold?.onToggle}><MarkdownContent contentKey={`request:${request.id}:body`} text={requestText} /></FoldableBody></div>
      {editSession && <small className="message-editing-state">正在输入框中编辑</small>}
      <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
    </MessageFrame>
    {!turn.local && !turn.terminal && !editSession && <ContentFrame contained><ActiveTaskControls context={controlContext} editActive={editActive} onControl={onControl} onEdit={onEdit} /></ContentFrame>}
    {!suppressAgentBubble && <AgentBubble key={`${turn.requestId}:agent-answer`} turn={turn} title={processingTitle} mergedCount={mergedCount} frozen={frozen} names={names} roster={roster} selfId={selfId} fold={fold} onReply={onReply} onCreateTask={onCreateTask} hasThreadChildren={thread.some((item) => isAgentMessageTurn(item.turn) && item.turn.request?.sender?.kind === 'agent')} />}
    <AgentThreadMessages thread={thread} names={names} onDownload={onDownload} onPreview={onPreview} />
  </section>;
}
export function TurnCard({ turn, thread = [], roster, names, selfId, access, targetAuthority, capability, controlState, continuation = false, detailsOpen = false, fold = null, editSession = null, editActive = false, queuePosition = 0, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon, onDownload, onPreview, onOpen, onCreateTask, onReply, onCloseDetail }) {
  const request = turn.request;
  const terminal = terminalContentEnvelope(turn);
  const requestView = messagePresentation(request);
  const self = request.sender?.id === selfId;
  const baseControlContext = taskControlContext(turn, { selfId, access, targetAuthority });
  const editCapability = editLeaseCapabilityState(capability);
  const controlContext = {
    ...baseControlContext,
    canEdit: baseControlContext.canEdit && editCapability === 'supported',
    editPending: baseControlContext.canEdit && editCapability === 'unknown',
    editUnavailable: baseControlContext.canEdit && editCapability === 'unsupported',
  };
  const replyTarget = replyTargetOf(request, { roster, selfId });
  const requestFoldId = `${turn.requestId}:request`;
  const responseFoldId = `${turn.requestId}:response`;
  const foldExempt = Boolean(fold?.latest || detailsOpen);
  return (
    <section className={`turn-card ${continuation ? 'continuation' : ''} ${self ? 'self' : ''} status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
      <ReplyableMessageFrame replyTarget={replyTarget} copyText={requestView.text} onReply={onReply} onCreateTask={onCreateTask} className="request-message" identity={<span className={`actor-icon kind-${request.sender?.kind}`}>{request.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(request.sender?.id, names)}</strong>{request.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(request.ts)}</time>{request.audience?.length > 0 && <span className="recipient-label">发送给 {request.audience.map((id) => nameOf(id, names)).join('、')}</span>}</header>
          <div className="request-text"><FoldableBody id={requestFoldId} text={requestView.text} exempt={Boolean(fold?.latest)} automaticExpanded={fold?.automaticExpanded} expanded={fold?.overrides?.get(requestFoldId)} onToggle={fold?.onToggle}><MarkdownContent contentKey={`request:${request.id}:body`} text={requestView.text} /></FoldableBody>{requestView.detail && <p className="message-detail">{requestView.detail}</p>}</div>
          <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
      </ReplyableMessageFrame>
      <ThreadCalls thread={thread} names={names} />
      {processCount(turn) > 0 && <ContentFrame contained><button type="button" className={`turn-process-summary ${turn.terminal ? 'completed' : 'active'}`} onClick={onOpen} aria-expanded={detailsOpen}>
          <span className={turn.terminal ? 'pulse done' : 'pulse'} />
          <span>{turn.terminal ? turnStatusLabel(turn) : (latestHumanProgress(turn) || '正在处理')}</span>
          <small>{turnProcessSummary(turn)}</small>
          <span aria-hidden="true">查看过程 ›</span>
        </button></ContentFrame>}
      {detailsOpen && <ContentFrame contained><TurnInlineDetail turn={turn} roster={roster} selfId={selfId} access={access} targetAuthority={targetAuthority} capability={capability} controlState={controlState} onCancel={onCancel} onControl={onControl} onDownload={onDownload} onCreateTask={onCreateTask} onClose={onCloseDetail} /></ContentFrame>}
      {!turn.local && !turn.terminal && !detailsOpen && <ContentFrame contained><ActiveTaskControls context={controlContext} editActive={editActive} onControl={onControl} onEdit={onEdit} /></ContentFrame>}
      {editSession && <ContentFrame contained><p className="message-editing-state">正在输入框中编辑</p></ContentFrame>}
      {terminal && (
        <MessageFrame className={turn.status === 'failed' ? 'final-answer turn-response failed' : 'final-answer turn-response'} contentClassName="response-body" identity={<span className={`actor-icon kind-${terminal.sender?.kind || 'agent'}`}>{(terminal.sender?.kind || 'agent').slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(terminal.sender?.id || request.audience?.[0], names)}</strong><small className="ai-label">AI</small><time>{timeLabel(terminal.ts)}</time>{turn.status === 'failed' && <span className="response-failed">处理失败</span>}</header><div className="response-content"><FoldableBody id={responseFoldId} text={messagePresentation(terminal).text} exempt={foldExempt} automaticExpanded={fold?.automaticExpanded} expanded={fold?.overrides?.get(responseFoldId)} onToggle={fold?.onToggle}><StructuredResult requestType={request.type} payload={argsOf(terminal)} renderText={(text) => <MarkdownContent contentKey={`terminal:${terminal.id || turn.requestId}:body`} text={text} />} /></FoldableBody></div>
        </MessageFrame>
      )}
      {turn.terminalClosureOnly && <ContentFrame contained><p className="terminal-result-unavailable">{terminalResultState(turn).error}</p></ContentFrame>}
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
export function Narration({ rows, names }) {
  const [open, setOpen] = useMessageLayoutState('narration', false);
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
export function Standalone({ envelope, names, roster, selfId, continuation = false, fold = null, onCreateTask, onReply }) {
  const view = messagePresentation(envelope);
  const self = envelope.sender?.id === selfId;
  const replyTarget = replyTargetOf(envelope, { roster, selfId });
  const foldId = `${envelope.id}:message`;
  return (
    <ReplyableMessageFrame replyTarget={replyTarget} copyText={view.text} onReply={onReply} onCreateTask={onCreateTask} className={`standalone-row ${continuation ? 'continuation' : ''} ${self ? 'self' : ''}`} identity={continuation ? <time className="continuation-time" aria-label={`${nameOf(envelope.sender?.id, names)}，${timeLabel(envelope.ts)}`}>{timeLabel(envelope.ts)}</time> : <span className={`actor-icon kind-${envelope.sender?.kind}`}>{envelope.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
      {!continuation && <header><strong>{nameOf(envelope.sender?.id, names)}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(envelope.ts)}</time></header>}<FoldableBody id={foldId} text={view.text} exempt={Boolean(fold?.latest)} automaticExpanded={fold?.automaticExpanded} expanded={fold?.overrides?.get(foldId)} onToggle={fold?.onToggle}><MarkdownContent contentKey={`message:${envelope.id}:body`} text={view.text} /></FoldableBody>{view.detail && <p className="message-detail">{view.detail}</p>}
    </ReplyableMessageFrame>
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
function dayKey(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
export function dayLabel(ts) {
  const date = new Date(ts);
  const now = new Date();
  if (dayKey(ts) === dayKey(now.getTime())) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (dayKey(ts) === dayKey(yesterday)) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}
export function useTimelineRowRenderer({
  state,
  roster,
  names,
  selfId,
  access,
  waitingRosterAuthority,
  capabilityIndex,
  frozenByActor,
  presentationEditing,
  resumePin,
  browsingExpandedSlots,
  effectiveFoldOverrides,
  approvalStates,
  controlStates,
  mergedCounts,
  preemptedSources,
  turnDetail,
  latestRowID = '',
  onResolve,
  onCancel,
  onTaskControl,
  onDownloadResource,
  onPreviewResource,
  onOpenTurn,
  onCreateTask,
  onReply,
  startEditing,
  verifyAndSave,
  abandonEditing,
  onEditText,
  toggleFold,
}) {
  const rowActionsRef = useRef(null);
  const namesRevision = useMemo(() => JSON.stringify((roster || [])
    .map((row) => [row.id, row.kind || '', row.name || row.display_name || ''])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])))), [roster]);
  const targetAuthorityRevision = useMemo(() => JSON.stringify([
    waitingRosterAuthority?.current === true,
    waitingRosterAuthority?.current === true && waitingRosterAuthority.actorIDs instanceof Set
      ? [...waitingRosterAuthority.actorIDs].sort()
      : [],
  ]), [waitingRosterAuthority]);
  const rowSelectedTurnID = turnDetail?.selected?.requestId || '';
  const hasCreateTask = Boolean(onCreateTask);
  const hasReply = Boolean(onReply);
  const sharedRowRevision = useMemo(
    () => `${namesRevision}${REVISION_SEP}${access}${REVISION_SEP}${selfId}${REVISION_SEP}${hasCreateTask ? 1 : 0}${REVISION_SEP}${hasReply ? 1 : 0}`,
    [access, hasCreateTask, hasReply, namesRevision, selfId],
  );
  const hasApprovalStates = useMemo(() => Boolean(approvalStates) && Object.keys(approvalStates).length > 0, [approvalStates]);
  const hasControlStates = useMemo(() => Boolean(controlStates) && Object.keys(controlStates).length > 0, [controlStates]);
  const capabilityRevisions = useMemo(() => {
    const rows = new Map();
    for (const [actorId, capability] of capabilityIndex) {
      rows.set(actorId, capabilityRowRevision(capability));
    }
    return rows;
  }, [capabilityIndex]);
  const rowRenderRevision = useCallback((_index, row) => {
    const entry = row.body;
    const isLatest = row.id === latestRowID ? 1 : 0;
    const browsingExpanded = browsingExpandedSlots.has(row.visualSlotID || row.id) ? 1 : 0;
    if (entry?.kind === 'turn') {
      const requestId = entry.turn.requestId;
      const actorId = entry.turn.request.audience?.[0] || '';
      const targetCurrentness = waitingRosterAuthority?.current === true
        && waitingRosterAuthority.actorIDs instanceof Set
        ? (waitingRosterAuthority.actorIDs.has(actorId) ? 'current' : 'departed')
        : 'unknown';
      const selectNote = entry.turn.request.type === TYPES.agentSelect
        ? selectSystemNote({
          usage: terminalResultPayload(entry.turn)?.usage,
          agentName: nameOf(actorId, names),
        })
        : '';
      const preemptedTurns = preemptedSources.get(requestId);
      let preempted = '';
      if (preemptedTurns) {
        for (const turn of preemptedTurns) preempted += `${turn.requestId}:${turn.lastSeq || turn.requestSeq || 0},`;
      }
      const approval = hasApprovalStates ? approvalStates[entry.turn.request.id] : undefined;
      const controlState = hasControlStates ? controlStates[`${state.channelId}:${requestId}:cancel`] : undefined;
      const frozen = frozenByActor.get(actorId);
      const edit = presentationEditing
        ? (presentationEditing.targetId === requestId
          ? `2${REVISION_SEP}${presentationEditing.phase}${REVISION_SEP}${presentationEditing.location}${REVISION_SEP}${revisionText(presentationEditing.text)}`
          : '1')
        : '0';
      return `${sharedRowRevision}${REVISION_SEP}${row.contentRevision}${REVISION_SEP}${targetCurrentness}${REVISION_SEP}${isLatest}${REVISION_SEP}${browsingExpanded}`
        + `${REVISION_SEP}${effectiveFoldOverrides.get(`${requestId}:request`)}${REVISION_SEP}${effectiveFoldOverrides.get(`${requestId}:response`)}`
        + `${REVISION_SEP}${turnDetail?.selected?.requestId === requestId}${REVISION_SEP}${resumePin === requestId}`
        + `${REVISION_SEP}${capabilityRevisions.get(actorId) || ''}${REVISION_SEP}${mergedCounts.get(requestId) || 0}${REVISION_SEP}${preempted}`
        + `${REVISION_SEP}${revisionSlot(approval)}${REVISION_SEP}${revisionSlot(controlState)}${REVISION_SEP}${revisionSlot(frozen)}`
        + `${REVISION_SEP}${revisionText(selectNote)}${REVISION_SEP}${edit}`;
    }
    if (entry?.kind === 'standalone') {
      return `${sharedRowRevision}${REVISION_SEP}${row.contentRevision}${REVISION_SEP}${isLatest}${REVISION_SEP}${browsingExpanded}`
        + `${REVISION_SEP}${effectiveFoldOverrides.get(`${entry.envelope.id}:message`)}`;
    }
    return `${sharedRowRevision}${REVISION_SEP}${row.contentRevision}${REVISION_SEP}${isLatest}${REVISION_SEP}${browsingExpanded}`;
  }, [
    approvalStates, capabilityIndex, capabilityRevisions, controlStates, presentationEditing,
    browsingExpandedSlots, effectiveFoldOverrides, frozenByActor, hasApprovalStates, hasControlStates,
    latestRowID, mergedCounts, names, preemptedSources, resumePin, sharedRowRevision,
    state.channelId, targetAuthorityRevision, turnDetail?.selected?.requestId,
  ]);
  useLayoutEffect(() => {
    rowActionsRef.current = {
      channelId: state.channelId,
      state,
      onResolve,
      onCancel,
      onTaskControl,
      onDownloadResource,
      onPreviewResource,
      onOpenTurn,
      onCreateTask,
      onReply,
      closeTurnDetail: turnDetail?.onClose,
      startEditing,
      verifyAndSave,
      abandonEditing,
    };
  });
  const rowActions = useMemo(() => Object.freeze({
    resolve(requestID, decision, payload) {
      const port = rowActionsRef.current;
      return port?.onResolve?.(port.channelId, requestID, decision, payload);
    },
    control(turn, actorId, type, payload) {
      const port = rowActionsRef.current;
      return port?.onTaskControl?.({
        channelId: port.channelId,
        turn: port.state?.turns?.get(turn?.requestId) || turn,
        actorId,
        type,
        payload,
      });
    },
    cancel(requestID) {
      const port = rowActionsRef.current;
      return port?.onCancel?.(port.channelId, requestID);
    },
    download(attachment) {
      const port = rowActionsRef.current;
      return port?.onDownloadResource?.(port.channelId, attachment);
    },
    preview(attachment) {
      const port = rowActionsRef.current;
      return port?.onPreviewResource?.(port.channelId, attachment);
    },
    createTask(source) { return rowActionsRef.current?.onCreateTask?.(source); },
    reply(...args) { return rowActionsRef.current?.onReply?.(...args); },
    startEditing(turn, actorId) { return rowActionsRef.current?.startEditing?.(turn, actorId); },
    saveEdit(text) { return rowActionsRef.current?.verifyAndSave?.(text); },
    abandonEdit() { return rowActionsRef.current?.abandonEditing?.(); },
    editText(text) { onEditText(text); },
    openTurnDetails(turn, detailsOpen) {
      if (detailsOpen) rowActionsRef.current?.closeTurnDetail?.();
      else {
        rowActionsRef.current?.onOpenTurn?.(turn);
      }
    },
    closeTurnDetails() {
      rowActionsRef.current?.closeTurnDetail?.();
    },
  }), []);
  const rowReply = useMemo(() => hasReply ? ((...args) => rowActions.reply(...args)) : null, [hasReply, rowActions]);
  const renderRow = useCallback((row) => {
    const entry = row.body;
    const continuation = row.continuation;
    const boundaryAfterTimestamp = row.boundaryAfterTimestamp;
    let content;
    if (entry.kind === 'narration') content = <ContentFrame><Narration rows={state.narration} names={names} /></ContentFrame>;
    if (
      entry.kind === 'turn'
      && [TYPES.humanAsk, TYPES.humanApprove].includes(entry.turn.request.type)
      && selfId
      && entry.turn.request.audience?.includes(selfId)
    ) {
      content = <ContentFrame><ApprovalCard turn={entry.turn} state={approvalStates[entry.turn.request.id]} onResolve={rowActions.resolve} names={names} /></ContentFrame>;
    }
    if (!content && entry.kind === 'turn' && entry.turn.request.type === TYPES.agentSelect) {
      const actorId = entry.turn.request.audience?.[0] || '';
      const result = terminalResultPayload(entry.turn);
      const note = result
        ? selectSystemNote({ usage: result.usage, agentName: nameOf(actorId, names) })
        : (entry.turn.terminal
          ? `配置${terminalResultState(entry.turn).error}`
          : '');
      content = <div className="timeline-entry" data-entry-id={entry.turn.requestId}><div className="select-system-note" role="status">{note}</div></div>;
    }
    if (!content && entry.kind === 'turn' && entry.turn.request.type === TYPES.agentNew) {
      const actorId = entry.turn.request.audience?.[0] || '';
      content = <div className="timeline-entry" data-entry-id={entry.turn.requestId}><div className="select-system-note" role="status">{nameOf(actorId, names)} 已开始新对话</div></div>;
    }
    if (!content && entry.kind === 'turn') {
      const actorId = entry.turn.request.audience?.length === 1 ? entry.turn.request.audience[0] : '';
      const controlKey = `${state.channelId}:${entry.turn.requestId}:cancel`;
      const source = { view: 'dynamic', objectType: 'turn', objectId: entry.turn.requestId, seq: entry.turn.requestSeq };
      const detailsOpen = rowSelectedTurnID === entry.turn.requestId;
      const browsingExpanded = browsingExpandedSlots.has(row.visualSlotID || row.id);
      const fold = {
        latest: row.id === latestRowID || browsingExpanded,
        automaticExpanded: browsingExpanded,
        overrides: effectiveFoldOverrides,
        onToggle: toggleFold,
      };
      const common = { turn: entry.turn, names, roster, selfId, access, targetAuthority: waitingRosterAuthority, capability: capabilityIndex.get(actorId), frozen: frozenByActor.get(actorId), fold, editActive: Boolean(presentationEditing && presentationEditing.targetId !== entry.turn.requestId), editSession: presentationEditing?.targetId === entry.turn.requestId ? presentationEditing : null, onControl: (type, payload) => rowActions.control(entry.turn, actorId, type, payload), onEdit: () => rowActions.startEditing(entry.turn, actorId), onEditText: rowActions.editText, onEditSave: rowActions.saveEdit, onEditAbandon: rowActions.abandonEdit, onDownload: rowActions.download, onPreview: rowActions.preview, onCreateTask: hasCreateTask ? () => rowActions.createTask(source) : null, onReply: rowReply };
      if (isAgentMessageTurn(entry.turn)) {
        content = <div className="timeline-entry" data-entry-id={entry.turn.requestId}><AgentConversationTurn {...common} thread={entry.thread} leadTurns={preemptedSources.get(entry.turn.requestId) || []} mergedCount={mergedCounts.get(entry.turn.requestId) || 0} /></div>;
      } else content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.turn.requestId}><TurnCard turn={entry.turn} thread={entry.thread} roster={roster} names={names} selfId={selfId} access={access} targetAuthority={waitingRosterAuthority} capability={capabilityIndex.get(actorId)} controlState={controlStates[controlKey]} continuation={continuation} detailsOpen={detailsOpen} fold={fold} editSession={presentationEditing?.targetId === entry.turn.requestId ? presentationEditing : null} editActive={Boolean(presentationEditing && presentationEditing.targetId !== entry.turn.requestId)} onCancel={() => rowActions.cancel(entry.turn.requestId)} onControl={(type, payload) => rowActions.control(entry.turn, actorId, type, payload)} onEdit={() => rowActions.startEditing(entry.turn, actorId)} onEditText={rowActions.editText} onEditSave={rowActions.saveEdit} onEditAbandon={rowActions.abandonEdit} onDownload={rowActions.download} onPreview={rowActions.preview} onReply={rowReply} onOpen={() => rowActions.openTurnDetails(entry.turn, detailsOpen)} onCloseDetail={rowActions.closeTurnDetails} onCreateTask={hasCreateTask ? () => rowActions.createTask(source) : null} /></div>;
    }
    if (!content) {
      const source = { view: 'dynamic', objectType: 'message', objectId: entry.envelope.id, seq: entry.seq };
      const browsingExpanded = browsingExpandedSlots.has(row.visualSlotID || row.id);
      content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.envelope.id}><Standalone envelope={entry.envelope} names={names} roster={roster} selfId={selfId} continuation={continuation} fold={{ latest: row.id === latestRowID || browsingExpanded, automaticExpanded: browsingExpanded, overrides: effectiveFoldOverrides, onToggle: toggleFold }} onCreateTask={hasCreateTask ? () => rowActions.createTask(source) : null} onReply={rowReply} /></div>;
    }
    return <div className="timeline-virtual-item">{content}{boundaryAfterTimestamp > 0 && <div className="timeline-day"><span>{dayLabel(boundaryAfterTimestamp)}</span></div>}</div>;
  }, [
    access, approvalStates, browsingExpandedSlots, capabilityIndex, controlStates, presentationEditing,
    effectiveFoldOverrides, frozenByActor, hasCreateTask, latestRowID, mergedCounts, names,
    preemptedSources, roster, rowActions, rowReply, rowSelectedTurnID, selfId,
    state, toggleFold, waitingRosterAuthority,
  ]);
  return { rowRenderRevision, renderRow };
}
