import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap, actorNameMap } from '../model/actor-display.js';
import { resolveFormSpec } from '../model/dynamic-form.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { attachmentFromFileReference } from '../model/file-references.js';
import { LIST_WINDOW_SIZE } from '../model/list-window.js';
import { messagePresentation } from '../model/message-presentation.js';
import { replyTargetOf } from '../model/reply-target.js';
import { systemEventPresentation } from '../model/system-event-presentation.js';
import { controlLabel, controlPayload, extraControls, taskControlContext } from '../model/task-controls.js';
import { agentFrozenStates, agentMessageStage, editAdmission, editableText, isAgentMessageTurn, lockFromContext, mergedInto, preemptedBy } from '../model/agent-control.js';
import { selectSystemNote } from '../model/agent-selection.js';
import { TIMELINE_SCOPE, TIMELINE_SCOPE_LABELS } from '../model/timeline-scope.js';
import { presentationEntryId, projectTimeline } from '../model/timeline-projection.js';
import { createPresentationProjector, presentationGeometryKey } from '../model/conversation-presentation.js';
import { latestHumanProgress, turnProcessSummary, turnStatusLabel } from '../model/turn-presentation.js';
import { conversationTextObservations, processCount, turnStartObservation, withoutFinalEcho } from '../model/turn-process.js';
import { argsOf } from '../protocol/envelope.js';
import { DECISIONS, TYPES } from '../protocol/vocab.js';
import { messageTimeLabel } from '../util/time.js';
import { StructuredResult } from './StructuredResult.jsx';
import { MarkdownContent, MarkdownFileReferenceProvider } from './MarkdownContent.jsx';
import { TurnInlineDetail } from './context/TurnContext.jsx';
import { ContentFrame, MessageFrame } from './timeline/InformationFlow.jsx';
import { ProgressTrail, ProgressTrailHost } from './timeline/ProgressTrail.jsx';
import { FoldableBody } from './timeline/FoldableBody.jsx';
import { useConversationViewport } from './timeline/useConversationViewport.js';
import { VirtualTimelineAdapter } from './timeline/VirtualTimelineAdapter.jsx';

// 平台叙事（成员进出、跨频道入站）暂时不进时间线。它和真正的往来平铺在同一条流里，
// 每次 agent 干活就刷出一串，把人要读的东西淹掉。数据仍然在 state.narration 里，
// 什么都没丢——等它有了合适的落位（侧栏或频道信息页）再接回来。
const SHOW_CHANNEL_NARRATION = false;
const EMPTY_FROZEN_STATES = new Map();
// During a rolling frontend/backend upgrade, older actors reject unknown
// fields. Use the lease CAS as soon as actor.describe advertises it; the UI
// invalidation rules below remain the compatibility guard for older actors.
function withExpectedHold(capabilityIndex, actorId, type, payload, holdId) {
  const schema = capabilityIndex.get(actorId)?.describe?.types?.get(type)?.inputSchema;
  return holdId && schema?.properties?.expected_hold_id
    ? { ...payload, expected_hold_id: holdId }
    : payload;
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
      {turn.terminal && (
        <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}>
          <p className="answer-label">RESPONSE · {String(argsOf(turn.terminal)?.status || '').toUpperCase()}</p>
          <p className="approval-resolver">处理者：{nameOf(turn.terminal.sender?.id, names)}{argsOf(turn.terminal)?.decision && ` · ${argsOf(turn.terminal).decision}`}</p>
          <StructuredResult requestType={request.type} payload={argsOf(turn.terminal)} renderText={(text) => <MarkdownContent text={text} />} />
        </footer>
      )}
      {error && <WireErrorLine error={error} />}
    </article>
  );
}

function ActiveTaskControls({ context, editActive = false, onControl, onEdit }) {
  const extras = extraControls(context);
  if (!context.workId && !context.canEdit && !context.canStop && !extras.length) return null;
  return (
    <section className="task-controls" aria-label="任务控制">
      {context.workId && <div className="task-work-identity"><code>{context.workId}</code><span>{[context.workState, context.workStage, context.executionState].filter(Boolean).join(' · ')}</span></div>}
      <div className="task-control-buttons">
        {context.canEdit && <button type="button" onClick={onEdit} disabled={editActive}>编辑</button>}
        {context.canStop && <button type="button" onClick={() => onControl(TYPES.agentInterrupt, controlPayload(context, TYPES.agentInterrupt, {}))}>停止</button>}
        {extras.map((entry) => <button key={entry.word} type="button" onClick={() => onControl(entry.word, controlPayload(context, entry.word, { target: context.requestId }))}>{controlLabel(entry)}</button>)}
      </div>
    </section>
  );
}

function WaitingLayer({ turns, state, names, selfId, access, capabilityIndex, frozenByActor, editing, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon }) {
  const [bulk, setBulk] = useState({ actorId: '', error: '' });
  const [collapsed, setCollapsed] = useState(false);
  if (!turns.length) return null;
  const groups = [];
  const byActor = new Map();
  for (const turn of turns) {
    const actorId = turn.request.audience?.[0] || '';
    if (!byActor.has(actorId)) {
      const group = { actorId, turns: [] };
      byActor.set(actorId, group);
      groups.push(group);
    }
    byActor.get(actorId).turns.push(turn);
  }

  async function cancelAll(group) {
    if (bulk.actorId) return;
    const cancellable = group.turns.filter((turn) => taskControlContext(turn, { selfId, access }).canCancel);
    if (!cancellable.length) return;
    setBulk({ actorId: group.actorId, error: '' });
    let held = false;
    let holdId = '';
    const failures = [];
    try {
      holdId = await onControl(cancellable[0], group.actorId, TYPES.agentHold, {});
      if (!holdId) throw new Error('暂停等待区失败');
      held = true;
      for (const turn of cancellable) {
        try {
          await onCancel?.(state.channelId, turn.requestId, taskControlContext(turn, { selfId, access }).cancelsAsDismiss);
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }
    } catch (error) {
      failures.push(error?.message || String(error));
    } finally {
      if (held) {
        try {
          await onControl(cancellable[0], group.actorId, TYPES.agentUnhold, withExpectedHold(capabilityIndex, group.actorId, TYPES.agentUnhold, {}, holdId));
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }
      setBulk({ actorId: '', error: failures[0] || '' });
    }
  }

  const soleGroup = groups.length === 1 ? groups[0] : null;
  const hasQueuedEditor = turns.some((turn) => turn.requestId === editing?.targetId);
  const renderedGroups = groups;
  return <div className={`agent-wait-dock${collapsed ? ' is-collapsed' : ''}`}>
    <section className={`agent-wait-layer${collapsed ? ' is-collapsed' : ''}${hasQueuedEditor ? ' is-editing' : ''}`} aria-label="等待区">
      {collapsed && <div className="agent-wait-collapsed"><span aria-hidden="true">↳</span><strong>{turns.length} 条等待消息</strong><button type="button" aria-expanded="false" onClick={() => setCollapsed(false)}>展开</button></div>}
      {!collapsed && <header className="agent-wait-header" aria-label="等待区操作">
        <div>
          {renderedGroups.map((group) => {
            const canInsertAll = group.turns.some((turn) => taskControlContext(turn, { selfId, access }).canInsert);
            return canInsertAll && <button type="button" className="agent-wait-insert-all" key={`insert-${group.actorId}`} onClick={() => onControl(group.turns[0], group.actorId, TYPES.agentSteer, { all: true })}>{soleGroup ? '全部插入' : `插入 ${nameOf(group.actorId, names)} 全部`}</button>;
          })}
          {renderedGroups.map((group) => {
            const canCancelAll = group.turns.some((turn) => taskControlContext(turn, { selfId, access }).canCancel);
            return canCancelAll && <button type="button" className="agent-wait-cancel-all" key={group.actorId} disabled={Boolean(bulk.actorId)} onClick={() => cancelAll(group)}>{bulk.actorId === group.actorId ? '正在取消…' : soleGroup ? '全部取消' : `取消 ${nameOf(group.actorId, names)} 全部`}</button>;
          })}
          <button type="button" onClick={() => setCollapsed(true)}>收起</button>
        </div>
      </header>}
      {!collapsed && renderedGroups.map((group) => {
      const paused = frozenByActor.get(group.actorId)?.source === TYPES.agentHold;
      return <section className="agent-wait-group" key={group.actorId} data-agent-id={group.actorId}>
        {!hasQueuedEditor && !soleGroup && <header><strong>{nameOf(group.actorId, names)}{paused ? '（已暂停）' : ''}</strong></header>}
        <ol>{group.turns.map((turn, index) => {
          const context = taskControlContext(turn, { selfId, access });
          const view = messagePresentation(turn.request);
          const session = editing?.targetId === turn.requestId ? editing : null;
          return <li key={turn.requestId} className={`agent-wait-item${session ? ' is-editing' : ''}`} data-request-id={turn.requestId}>
            {session
              ? <><div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div><span className="agent-wait-editing-label">正在编辑</span></>
              : <>
                <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div>
                <div className="agent-wait-actions">
                  {paused && <span className="agent-wait-paused">已暂停</span>}
                  {context.steering && <span className="agent-wait-paused">正在并入…</span>}
                  {context.canInsert && <button type="button" onClick={() => onControl(turn, group.actorId, TYPES.agentSteer, { target: turn.requestId })}>插入</button>}
                  {context.canEdit && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, group.actorId)}>编辑</button>}
                  {context.canCancel && <button type="button" title={context.cancelsAsDismiss ? '这条不是你发的，将请对方放弃它' : '撤回你自己发出的这条请求'} onClick={() => onCancel?.(state.channelId, turn.requestId, context.cancelsAsDismiss)}>取消</button>}
                  {extraControls(context).map((entry) => <button key={entry.word} type="button" onClick={() => onControl(turn, group.actorId, entry.word, { target: turn.requestId })}>{controlLabel(entry)}</button>)}
                </div>
              </>}
          </li>;
        })}</ol>
      </section>;
      })}
      {!collapsed && bulk.error && <p className="agent-wait-error" role="alert">{bulk.error}</p>}
    </section>
  </div>;
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
        ? <div className="turn-thread-result"><StructuredResult requestType={child.request.type} payload={argsOf(child.terminal)} renderText={(text) => <MarkdownContent text={text} />} /></div>
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
    <div className="agent-request-quote-text"><MarkdownContent text={view.text} /></div>
    <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
  </blockquote>;
}

function AgentBubble({ turn, title, mergedCount = 0, frozen = null, names, roster = [], selfId = '', quotedRequest = null, fold = null, onDownload, onPreview, onReply, onCreateTask, compact = false, compactExpanded = false, onCompactToggle = null, hasThreadChildren = false }) {
  const request = turn.request;
  const terminal = turn.terminal;
  const responseFoldId = `${turn.requestId}:response`;
  const stopped = argsOf(terminal)?.status === 'failed' && argsOf(terminal)?.error_code === 'interrupted';
  const resumable = stopped && frozen?.source === TYPES.agentInterrupt && (!frozen.target_id || frozen.target_id === turn.requestId);
  const liveEnvelope = latestTurnEnvelope(turn);
  const agentId = terminal?.sender?.id || liveEnvelope?.sender?.id || request.audience?.[0];
  const bubbleTs = terminal?.ts || liveEnvelope?.ts;
  const processStartedTs = turnStartedAt(turn);
  const terminalText = terminal && !stopped ? messagePresentation(terminal).text : '';
  const conversationTexts = withoutFinalEcho(conversationTextObservations(turn), terminalText);
  const foldText = [...conversationTexts.map(({ process }) => process.text), terminalText].filter(Boolean).join('\n\n');
  const className = `agent-turn-bubble${terminal ? ' settled' : ' processing'}${compact ? ' compact' : ''}${hasThreadChildren ? ' has-thread-children' : ''}`;
  const identity = <span className="actor-icon kind-agent">A</span>;
  const heading = <header><strong>{nameOf(agentId, names)}</strong><small className="ai-label">AI</small>{bubbleTs && <time>{timeLabel(bubbleTs)}</time>}</header>;
  const conversationBody = <>
    {conversationTexts.map(({ seq, envelope, process }) => <div key={envelope.id || seq} className="agent-progress-text" data-seq={seq}><MarkdownContent text={process.text} /></div>)}
    {terminal && !stopped && <div className="agent-final-text"><StructuredResult requestType={request.type} payload={conversationPayload(argsOf(terminal))} renderText={(text) => <MarkdownContent text={text} />} /></div>}
  </>;
  const hasConversationBody = conversationTexts.length > 0 || Boolean(terminal && !stopped);
  const content = <>
    {quotedRequest && <AgentRequestQuote request={quotedRequest} names={names} onDownload={onDownload} onPreview={onPreview} />}
    {hasConversationBody && <div className="response-content">{compact
      ? conversationBody
      : <FoldableBody id={responseFoldId} text={foldText} exempt={Boolean(fold?.latest)} expanded={fold?.overrides?.get(responseFoldId)} onToggle={fold?.onToggle}>{conversationBody}</FoldableBody>}</div>}
    {!terminal && <ProgressTrail turn={turn} running title={title} startedAt={processStartedTs} mergedCount={mergedCount} />}
    {stopped && <p className="agent-stopped">✗ 已停止{resumable ? ' · 发消息即继续' : ''}</p>}
    {terminal && <ProgressTrail turn={turn} running={false} />}
  </>;
  if (compact) return <article className={`agent-thread-message ${className}${compactExpanded ? ' is-expanded' : ' is-collapsed'}`} tabIndex="0">
    <div className="agent-thread-identity-row">{identity}{heading}{onCompactToggle && <button type="button" className="agent-thread-collapse-toggle" aria-label={`${compactExpanded ? '收起' : '展开'} ${nameOf(agentId, names)} 的协作消息`} aria-expanded={compactExpanded} onClick={onCompactToggle}><span aria-hidden="true">⌄</span></button>}</div>
    <div className="agent-thread-content" aria-hidden={!compactExpanded} inert={!compactExpanded ? true : undefined}>{content}</div>
  </article>;
  const replyTarget = terminal && argsOf(terminal)?.status === 'completed'
    ? replyTargetOf(terminal, { roster, selfId, fallbackSenderId: request.audience?.[0], fallbackSenderKind: 'agent' })
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
  const [expanded, setExpanded] = useState(() => new Set());
  const collaborative = thread.filter((item) => isAgentMessageTurn(item.turn) && item.turn.request?.sender?.kind === 'agent');
  if (!collaborative.length) return null;
  return <ol className="agent-message-thread" role="tree" aria-label="Agent 协作消息">
    {collaborative.map((item, index) => {
      const child = item.turn;
      const request = child.request;
      const requestView = messagePresentation(request);
      const rails = threadRails(collaborative, index);
      const hasChildren = collaborative[index + 1]?.depth === item.depth + 1;
      const nodeExpanded = expanded.has(child.requestId);
      return <li key={child.requestId} className={`agent-thread-node status-${child.status}${hasChildren ? ' has-children' : ''}`} style={{ '--thread-depth': item.depth }} role="treeitem" aria-level={item.depth + 1}>
        <span className="agent-thread-elbow" aria-hidden="true" />
        {rails.map((rail) => <span key={rail.level} className={`agent-thread-rail ${rail.continues ? 'continues' : 'ends'}`} style={{ '--thread-rail-level': rail.level }} aria-hidden="true" />)}
        {hasChildren && <span className="agent-thread-child-stem" aria-hidden="true" />}
        <div className="agent-thread-response"><AgentBubble turn={child} title={requestView.text} names={names} quotedRequest={request} onDownload={onDownload} onPreview={onPreview} compact compactExpanded={nodeExpanded} onCompactToggle={() => setExpanded((current) => {
          const next = new Set(current);
          if (next.has(child.requestId)) next.delete(child.requestId);
          else next.add(child.requestId);
          return next;
        })} /></div>
      </li>;
    })}
  </ol>;
}

function AgentConversationTurn({ turn, thread = [], leadTurns = [], mergedCount = 0, names, roster, selfId, access, frozen, fold = null, editActive, editSession = null, onControl, onEdit, onDownload, onPreview, onReply, onCreateTask }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const requestText = requestView.text;
  const requestFoldId = `${turn.requestId}:request`;
  const controlContext = taskControlContext(turn, { selfId, access });
  const lead = leadTurns.map((item) => messagePresentation(item.request).text);
  const processingTitle = [...lead, requestText].join(' ＋ ');
  const suppressAgentBubble = Boolean(mergedInto(turn) || preemptedBy(turn));
  return <section className={`turn-card agent-conversation-turn self status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
    <MessageFrame className="request-message" identity={<span className="actor-icon kind-human">H</span>}>
      <header><strong>{nameOf(request.sender?.id, names)}</strong><time>{timeLabel(request.ts)}</time></header>
      <div className="request-text"><FoldableBody id={requestFoldId} text={requestText} expanded={fold?.overrides?.get(requestFoldId)} onToggle={fold?.onToggle}><MarkdownContent text={requestText} /></FoldableBody></div>
      {editSession && <small className="message-editing-state">正在输入框中编辑</small>}
      <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
    </MessageFrame>
    {!turn.terminal && !editSession && <ContentFrame contained><ActiveTaskControls context={controlContext} editActive={editActive} onControl={onControl} onEdit={onEdit} /></ContentFrame>}
    {!suppressAgentBubble && <AgentBubble turn={turn} title={processingTitle} mergedCount={mergedCount} frozen={frozen} names={names} roster={roster} selfId={selfId} fold={fold} onReply={onReply} onCreateTask={onCreateTask} hasThreadChildren={thread.some((item) => isAgentMessageTurn(item.turn) && item.turn.request?.sender?.kind === 'agent')} />}
    <AgentThreadMessages thread={thread} names={names} onDownload={onDownload} onPreview={onPreview} />
  </section>;
}

function TurnCard({ turn, thread = [], roster, names, selfId, access, capability, controlState, continuation = false, detailsOpen = false, fold = null, editSession = null, editActive = false, queuePosition = 0, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon, onDownload, onPreview, onOpen, onCreateTask, onReply, onCloseDetail }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const self = request.sender?.id === selfId;
  const controlContext = taskControlContext(turn, { selfId, access });
  const replyTarget = replyTargetOf(request, { roster, selfId });
  const requestFoldId = `${turn.requestId}:request`;
  const responseFoldId = `${turn.requestId}:response`;
  // 正在查看过程的那轮，读者显然在读它，答案不折。
  // 只豁免**答案**：豁免是为了让人不用点就能读到新东西，而自己刚发出去的那段提问
  // 恒不是新东西——一段长粘贴把屏幕占满，挡住的正是他在等的那个回答。提问一律按
  // 同一条长度判据折，跟其他消息一样，点一下就能展开。
  const foldExempt = Boolean(fold?.latest || detailsOpen);
  return (
    <section className={`turn-card ${continuation ? 'continuation' : ''} ${self ? 'self' : ''} status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
      <ReplyableMessageFrame replyTarget={replyTarget} copyText={requestView.text} onReply={onReply} onCreateTask={onCreateTask} className="request-message" identity={<span className={`actor-icon kind-${request.sender?.kind}`}>{request.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(request.sender?.id, names)}</strong>{request.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(request.ts)}</time>{request.audience?.length > 0 && <span className="recipient-label">发送给 {request.audience.map((id) => nameOf(id, names)).join('、')}</span>}</header>
          <div className="request-text"><FoldableBody id={requestFoldId} text={requestView.text} expanded={fold?.overrides?.get(requestFoldId)} onToggle={fold?.onToggle}><MarkdownContent text={requestView.text} /></FoldableBody>{requestView.detail && <p className="message-detail">{requestView.detail}</p>}</div>
          <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
      </ReplyableMessageFrame>
      <ThreadCalls thread={thread} names={names} />
      {processCount(turn) > 0 && <ContentFrame contained><button type="button" className={`turn-process-summary ${turn.terminal ? 'completed' : 'active'}`} onClick={onOpen} aria-expanded={detailsOpen}>
          <span className={turn.terminal ? 'pulse done' : 'pulse'} />
          <span>{turn.terminal ? turnStatusLabel(turn) : (latestHumanProgress(turn) || '正在处理')}</span>
          <small>{turnProcessSummary(turn)}</small>
          <span aria-hidden="true">查看过程 ›</span>
        </button></ContentFrame>}
      {detailsOpen && <ContentFrame contained><TurnInlineDetail turn={turn} roster={roster} selfId={selfId} access={access} capability={capability} controlState={controlState} onCancel={onCancel} onControl={onControl} onDownload={onDownload} onCreateTask={onCreateTask} onClose={onCloseDetail} /></ContentFrame>}
      {!turn.terminal && !detailsOpen && <ContentFrame contained><ActiveTaskControls context={controlContext} editActive={editActive} onControl={onControl} onEdit={onEdit} /></ContentFrame>}
      {editSession && <ContentFrame contained><p className="message-editing-state">正在输入框中编辑</p></ContentFrame>}
      {turn.terminal && (
        <MessageFrame className={turn.status === 'failed' ? 'final-answer turn-response failed' : 'final-answer turn-response'} contentClassName="response-body" identity={<span className={`actor-icon kind-${turn.terminal.sender?.kind || 'agent'}`}>{(turn.terminal.sender?.kind || 'agent').slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(turn.terminal.sender?.id || request.audience?.[0], names)}</strong><small className="ai-label">AI</small><time>{timeLabel(turn.terminal.ts)}</time>{turn.status === 'failed' && <span className="response-failed">处理失败</span>}</header><div className="response-content"><FoldableBody id={responseFoldId} text={messagePresentation(turn.terminal).text} exempt={foldExempt} expanded={fold?.overrides?.get(responseFoldId)} onToggle={fold?.onToggle}><StructuredResult requestType={request.type} payload={argsOf(turn.terminal)} renderText={(text) => <MarkdownContent text={text} />} /></FoldableBody></div>
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

function Standalone({ envelope, names, roster, selfId, continuation = false, fold = null, onCreateTask, onReply }) {
  const view = messagePresentation(envelope);
  const self = envelope.sender?.id === selfId;
  const replyTarget = replyTargetOf(envelope, { roster, selfId });
  const foldId = `${envelope.id}:message`;
  return (
    <ReplyableMessageFrame replyTarget={replyTarget} copyText={view.text} onReply={onReply} onCreateTask={onCreateTask} className={`standalone-row ${continuation ? 'continuation' : ''} ${self ? 'self' : ''}`} identity={continuation ? <time className="continuation-time" aria-label={`${nameOf(envelope.sender?.id, names)}，${timeLabel(envelope.ts)}`}>{timeLabel(envelope.ts)}</time> : <span className={`actor-icon kind-${envelope.sender?.kind}`}>{envelope.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
      {!continuation && <header><strong>{nameOf(envelope.sender?.id, names)}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(envelope.ts)}</time></header>}<FoldableBody id={foldId} text={view.text} exempt={Boolean(fold?.latest)} expanded={fold?.overrides?.get(foldId)} onToggle={fold?.onToggle}><MarkdownContent text={view.text} /></FoldableBody>{view.detail && <p className="message-detail">{view.detail}</p>}
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

function dayLabel(ts) {
  const date = new Date(ts);
  const now = new Date();
  if (dayKey(ts) === dayKey(now.getTime())) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (dayKey(ts) === dayKey(yesterday)) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function foldIDsForPresentationRow(row) {
  const entry = row?.body;
  if (entry?.kind === 'turn' && entry.turn?.requestId) {
    return [`${entry.turn.requestId}:request`, `${entry.turn.requestId}:response`];
  }
  if (entry?.kind === 'standalone' && entry.envelope?.id) return [`${entry.envelope.id}:message`];
  return [];
}

export function Timeline({ state, history = {}, composer = null, viewSessions, navigationTarget = null, onNavigationTargetConsumed, roster, selfId, agentActivity, onAcknowledgeAgentActivity, pending, approvalStates, controlStates = {}, capabilityIndex = new Map(), access = '', onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, turnDetail, onComposerEditChange, onFocusAgentChange }) {
  const initialViewSessionRef = useRef(null);
  if (!initialViewSessionRef.current) initialViewSessionRef.current = viewSessions?.read(state.channelId) || {};
  const presentationProjectorRef = useRef(null);
  if (!presentationProjectorRef.current) presentationProjectorRef.current = createPresentationProjector();
  const [scope, setScope] = useState(() => initialViewSessionRef.current.scope || TIMELINE_SCOPE.mine);
  // 选中的 agent。空集 = 不过滤（常态）。Timeline 按频道 key 挂载，所以切频道
  // 天然重置，恒不需要自己清。
  const [actorFilter, setActorFilter] = useState(() => new Set(initialViewSessionRef.current.actorFilter || []));
  // 读者手动展开 / 收起过的正文，按正文 id 记（true 展开、false 收起）。没记的按
  // 默认规则：超阈值即折，最新一轮和正在查看过程的那轮例外；手动选择跨频道重挂保留。
  const [foldOverrides, setFoldOverrides] = useState(() => new Map(initialViewSessionRef.current.foldOverrides || []));
  // “最新一轮”只决定正文第一次进入当前阅读会话时的默认形态。后续 live
  // 不能因为它不再是最后一条就把已经展示的长文自动折起；否则消息事实会
  // 直接改写屏幕几何。自动保留与手动选择分开，手动选择恒优先。
  const foldDefaultsRef = useRef(new Set(initialViewSessionRef.current.foldDefaults || []));
  const previousTailRef = useRef({ listKey: '', rowID: '', foldIDs: [] });
  const toggleFold = useCallback((id, expanded) => setFoldOverrides((current) => new Map(current).set(id, expanded)), []);
  const [editing, setEditing] = useState(null);
  const editSessionSerialRef = useRef(0);
  const editingRef = useRef(null);
  const editReleasePendingRef = useRef(new Set());
  const editReleaseSentRef = useRef(new Set());
  const editRuntimeRef = useRef(null);
  const [editNotice, setEditNotice] = useState('');
  const [resumePin, setResumePin] = useState('');
  const [presentationNow, setPresentationNow] = useState(() => Date.now());
	const previousAccess = useRef(access);
	const openFileReference = useCallback((reference) => {
	  onPreviewResource?.(state.channelId, attachmentFromFileReference(reference));
	}, [onPreviewResource, state.channelId]);
  const names = useMemo(() => actorNameMap(roster), [roster]);
  // 正在编辑的消息钉在原地：协议上"处理中被编辑"的消息会被打断回队列（Resumed），
  // 但呈现上必须留在用户点下"编辑"的位置原地变可编辑——恒不在编辑中途瞬移。
  // 只钉"从处理中进入编辑"的：等待区消息的编辑本来就发生在等待区原地。
  // 保存/放弃后钉住不放（resumePin），直到账上真正回到处理中——否则解冻帧到达前
  // 的空窗里消息会闪跳进等待区。
  const editingTargetId = editing?.location === 'processing' ? editing.targetId : resumePin;
  const actorFilterApplies = scope === TIMELINE_SCOPE.mine;
  // Scope and actor filters replace the visible conversation and therefore get
  // a fresh presentation/geometry identity. Editing only changes an existing
  // row and deliberately does not reset either identity.
  const messageListKey = `${state.channelId}:${scope}:${selfId}:${actorFilterApplies ? [...actorFilter].sort().join(',') : ''}`;
  const projectionVersion = state._timelineProjectionVersion ?? state.lastSeq;
  const controlVersion = state._timelineControlVersion ?? state.lastSeq;
  const projection = useMemo(() => projectTimeline(state, {
    scope,
    selfId,
    actorFilter,
    editingTargetId,
    showNarration: SHOW_CHANNEL_NARRATION,
    incremental: true,
    presentationProjector: presentationProjectorRef.current,
    presentationKey: messageListKey,
  }), [state, projectionVersion, scope, selfId, actorFilter, editingTargetId, messageListKey]);
  const { filtered: entries } = projection;
  // 名册里的 agent 才进过滤条：人和工具恒不是"我在跟谁说话"的那个谁。
  const filterableAgents = useMemo(() => (roster || []).filter((row) => row.kind === 'agent'), [roster]);
  // 过滤条恰好只选中一个 agent 时，屏幕上就只剩「我和他」的往来。此时 composer
  // 的默认收件人恒该是他——否则人照着屏幕打字，消息发去了另一个 agent。多选或
  // 空集恒不构成"一个目标"，报空让判据链继续往下走。
  const focusAgentId = useMemo(() => {
    if (!actorFilterApplies || actorFilter.size !== 1) return '';
    const [only] = [...actorFilter];
    return filterableAgents.some((row) => row.id === only) ? only : '';
  }, [actorFilterApplies, actorFilter, filterableAgents]);
  useEffect(() => { onFocusAgentChange?.(focusAgentId); }, [focusAgentId, onFocusAgentChange]);
	const withNarration = projection.presentationRows;
  const tailRow = withNarration.at(-1);
  const tailRowID = tailRow ? presentationEntryId(tailRow) : '';
  const previousTail = previousTailRef.current;
  const nextFoldDefaults = new Set(foldDefaultsRef.current);
  if (previousTail.listKey === messageListKey && previousTail.rowID && previousTail.rowID !== tailRowID) {
    for (const id of previousTail.foldIDs) nextFoldDefaults.add(id);
  }
  const nextTail = { listKey: messageListKey, rowID: tailRowID, foldIDs: foldIDsForPresentationRow(tailRow) };
  useLayoutEffect(() => {
    foldDefaultsRef.current = nextFoldDefaults;
    previousTailRef.current = nextTail;
  }, [messageListKey, tailRowID]);
  const effectiveFoldOverrides = new Map([...nextFoldDefaults].map((id) => [id, true]));
  for (const [id, expanded] of foldOverrides) effectiveFoldOverrides.set(id, expanded);
  const localGeometryKey = useMemo(() => JSON.stringify({
    folds: [...effectiveFoldOverrides].map(([id, expanded]) => [id, Boolean(expanded)]).sort(([left], [right]) => left.localeCompare(right)),
    detail: turnDetail?.selected?.requestId || '',
    editing: editing ? [editing.targetId, editing.phase, editing.location] : null,
    resumePin,
    access,
    roster: (roster || []).map((row) => [row.id, row.name || row.display_name || '']),
    approvals: Object.entries(approvalStates || {}).sort(([left], [right]) => left.localeCompare(right)),
    controls: Object.entries(controlStates || {}).sort(([left], [right]) => left.localeCompare(right)),
    capabilities: [...capabilityIndex.entries()]
      .map(([id, value]) => [id, value?.describe?.revision || value?.describe?.version || ''])
      .sort(([left], [right]) => left.localeCompare(right)),
  }), [tailRowID, foldOverrides, turnDetail?.selected?.requestId, editing?.targetId, editing?.phase, editing?.location, resumePin, access, roster, approvalStates, controlStates, capabilityIndex]);
  const viewportGeometryKey = useMemo(() => presentationGeometryKey(
    withNarration,
    localGeometryKey,
  ), [withNarration, localGeometryKey]);
  // The virtual index and the lookup used after a prepend must describe the
  // same presentation rows. A turn can span several ledger sequences, so the
  // raw entry seq is not interchangeable with its semantic row bounds.
  const firstVisibleSeq = Number(withNarration[0]?.seqLow || 0);
  const latestVisibleSeq = Number(withNarration.at(-1)?.seqHigh || 0);
	const viewport = useConversationViewport({
	  channelId: state.channelId,
	  lastSeq: state.lastSeq,
	  history,
	  viewKey: messageListKey,
	  listKey: messageListKey,
		  items: withNarration,
		  firstVisibleSeq,
		  latestVisibleSeq,
		  geometryKey: viewportGeometryKey,
	  viewSpec: { scope, selfId, actorFilter, editingTargetId, showNarration: SHOW_CHANNEL_NARRATION },
	  navigationTarget,
	  onNavigationTargetConsumed,
	  initialSession: initialViewSessionRef.current,
	  onSessionChange: (change) => viewSessions?.writeConversation(state.channelId, change),
	});
	const firstItemIndex = viewport.firstItemIndex;
  const timelineControl = useMemo(() => {
    const queued = [];
    const actorIds = new Set();
    const preempted = new Map();
    const merged = new Map();
    let hasFreezeOperations = false;
    for (const turn of state.turns.values()) {
      const actorId = turn.request?.audience?.length === 1 ? turn.request.audience[0] : '';
      if (actorId) actorIds.add(actorId);
      if (agentMessageStage(turn) === 'queued' && turn.requestId !== editingTargetId) queued.push(turn);
      const replacement = preemptedBy(turn);
      if (replacement) preempted.set(replacement, [...(preempted.get(replacement) || []), turn]);
      const owner = mergedInto(turn);
      if (owner) merged.set(owner, (merged.get(owner) || 0) + 1);
      if (argsOf(turn.terminal)?.status === 'completed'
        && (turn.request?.type === TYPES.agentHold || turn.request?.type === TYPES.agentInterrupt)) {
        hasFreezeOperations = true;
      }
    }
    queued.sort((left, right) => {
      const leftTarget = argsOf(left.request).target;
      const rightTarget = argsOf(right.request).target;
      const leftSeq = left.request.type === TYPES.agentReplace ? state.turns.get(leftTarget)?.requestSeq || left.requestSeq : left.requestSeq;
      const rightSeq = right.request.type === TYPES.agentReplace ? state.turns.get(rightTarget)?.requestSeq || right.requestSeq : right.requestSeq;
      return leftSeq - rightSeq;
    });
    return { queued, actorIds, preempted, merged, hasFreezeOperations };
  }, [state, controlVersion, editingTargetId]);
  const queuedTurns = timelineControl.queued;
  const frozenByActor = useMemo(
    () => timelineControl.hasFreezeOperations
      ? agentFrozenStates(state, timelineControl.actorIds, presentationNow)
      : EMPTY_FROZEN_STATES,
    [state, controlVersion, timelineControl.actorIds, timelineControl.hasFreezeOperations, presentationNow],
  );
  editingRef.current = editing;
  editRuntimeRef.current = { state, frozenByActor, capabilityIndex, onTaskControl };

  function releaseEditSession(session, targetTurn = null) {
    if (!session || editReleaseSentRef.current.has(session.sessionId)) return;
    if (!session.holdId) {
      editReleasePendingRef.current.add(session.sessionId);
      return;
    }
    editReleasePendingRef.current.delete(session.sessionId);
    editReleaseSentRef.current.add(session.sessionId);
    const runtime = editRuntimeRef.current;
    const observed = runtime?.frozenByActor?.get(session.actorId);
    // Against an older backend that has not advertised lease CAS yet, this
    // front-side guard still avoids an observed newer interrupt/hold. With a
    // new backend, expected_hold_id closes the remaining wire race.
    if (observed && (observed.source !== TYPES.agentHold || observed.held_by !== session.holdId)) return;
    const turn = targetTurn || runtime?.state?.turns?.get(session.targetId);
    Promise.resolve(runtime?.onTaskControl?.({
      channelId: session.channelId,
      turn,
      actorId: session.actorId,
      type: TYPES.agentUnhold,
      payload: withExpectedHold(runtime?.capabilityIndex || new Map(), session.actorId, TYPES.agentUnhold, {}, session.holdId),
    })).catch(() => {});
  }
  const nextFreezeDeadline = Math.min(...[...frozenByActor.values()].filter(Boolean).map((value) => value.until));
	const preemptedSources = timelineControl.preempted;
	const mergedCounts = timelineControl.merged;
  const namesRevision = useMemo(() => (roster || [])
    .map((row) => `${row.id}:${row.name || row.display_name || ''}`)
    .sort()
    .join('|'), [roster]);
  // A live publish must not invalidate every materialized row. Each row gets a
  // compact revision made only from the local UI facts it actually consumes;
  // unchanged rows retain their mounted subtree, intrinsic measurements and
  // nested disclosure state while another request streams or arrives.
  const rowRenderRevision = useCallback((absoluteIndex, row) => {
    const entry = row.body;
    const relativeIndex = absoluteIndex - firstItemIndex;
    const isLatest = relativeIndex === withNarration.length - 1;
    if (entry?.kind === 'turn') {
      const requestId = entry.turn.requestId;
      const actorId = entry.turn.request.audience?.[0] || '';
      const controlKey = `${state.channelId}:${requestId}:cancel`;
      const preempted = (preemptedSources.get(requestId) || [])
        .map((turn) => `${turn.requestId}:${turn.lastSeq || turn.requestSeq || 0}`)
        .join(',');
      return JSON.stringify([
        namesRevision, access, selfId, isLatest,
        effectiveFoldOverrides.get(`${requestId}:request`), effectiveFoldOverrides.get(`${requestId}:response`),
        turnDetail?.selected?.requestId === requestId,
        editing?.targetId === requestId ? [editing.phase, editing.location, editing.text] : Boolean(editing),
        resumePin === requestId,
        approvalStates?.[entry.turn.request.id] || null,
        controlStates?.[controlKey] || null,
        capabilityIndex.get(actorId)?.describe?.revision || capabilityIndex.get(actorId)?.describe?.version || '',
        frozenByActor.get(actorId) || null,
        mergedCounts.get(requestId) || 0,
        preempted,
      ]);
    }
    if (entry?.kind === 'standalone') {
      return JSON.stringify([
        namesRevision, selfId, isLatest,
        effectiveFoldOverrides.get(`${entry.envelope.id}:message`),
      ]);
    }
    return `${namesRevision}|${row.contentRevision}|${isLatest ? 1 : 0}`;
  }, [
    access, approvalStates, capabilityIndex, controlStates, editing, firstItemIndex,
    tailRowID, foldOverrides, frozenByActor, mergedCounts, namesRevision, preemptedSources,
    resumePin, selfId, state.channelId, turnDetail?.selected?.requestId,
    withNarration.length,
  ]);

  useEffect(() => {
    viewSessions?.writeConversation(state.channelId, {
      scope,
      actorFilter: [...actorFilter],
      foldOverrides: [...foldOverrides],
      foldDefaults: [...foldDefaultsRef.current],
    });
  }, [viewSessions, state.channelId, scope, actorFilter, foldOverrides, tailRowID]);
  useEffect(() => { setEditNotice(''); }, [state.channelId]);
  // presentationNow 只服务冻结期限。普通正文帧不会改变冻结事实；每帧都 setState
  // 会让一次 live publish 额外再渲染整棵 Timeline 一次。
  useEffect(() => setPresentationNow(Date.now()), [controlVersion]);
  useEffect(() => {
    if (!Number.isFinite(nextFreezeDeadline)) return undefined;
    const timer = window.setTimeout(() => setPresentationNow(Date.now()), Math.max(1, nextFreezeDeadline - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [nextFreezeDeadline]);

  useEffect(() => {
    if (!editing) return;
    const activeEditSessionId = editing.sessionId;
    const targetTurn = state.turns.get(editing.targetId);
    const replacedBy = argsOf(targetTurn?.terminal)?.replaced_by ?? argsOf(targetTurn?.terminal)?.value?.replaced_by;
    const frozen = frozenByActor.get(editing.actorId);
    const ownsLiveHold = Boolean(editing.holdId
      && frozen?.source === TYPES.agentHold
      && frozen.held_by === editing.holdId);
    const lockMustBeLive = ['editing', 'checking', 'submitting', 'saving'].includes(editing.phase);
    const replacementLanded = Boolean(replacedBy);
    const targetClosed = Boolean(targetTurn?.terminal && !replacementLanded);
    const lockLost = lockMustBeLive && editing.holdId && !ownsLiveHold;
    const actorGone = roster.length > 0 && !roster.some((row) => row.id === editing.actorId);

    // Editing is a lease over one still-open buffered request. Any terminal on
    // the target, or any later control that replaces the hold, ends that lease.
    // Leaving Timeline.editing alive would keep Composer routing every send to
    // this dead edit forever. Release only when the ledger still says this edit
    // owns the hold; a stale cleanup must never clear a newer interrupt/hold.
    if (replacementLanded || targetClosed || lockLost || actorGone) {
      const session = editing;
      if (replacementLanded && session.location === 'processing') setResumePin(replacedBy);
      setEditing((current) => current?.sessionId === session.sessionId ? null : current);
      if (!replacementLanded) setEditNotice(targetClosed ? '原消息已经停止或取消，已退出编辑' : actorGone ? 'Agent 已重启或离开，已退出编辑' : '编辑已被另一项控制终止');
      if (actorGone) editReleaseSentRef.current.add(session.sessionId);
      else releaseEditSession(session, targetTurn);
      return;
    }
    if (editing.phase === 'locking') {
      const admission = editAdmission(state, editing);
      if (admission.error) {
        setEditing(null);
        setEditNotice(admission.error);
      }
      else if (admission.ready) setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'editing', error: '' }) : current);
      return;
    }
    if (editing.phase === 'checking') {
      const contextTurn = state.turns.get(editing.contextId);
      if (!contextTurn?.terminal) return;
      if (argsOf(contextTurn.terminal)?.status !== 'completed') {
        setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'editing', error: argsOf(contextTurn.terminal)?.detail || '编辑锁已失效' }) : current);
        return;
      }
      const lock = lockFromContext(argsOf(contextTurn.terminal), editing.holdId);
      if (!lock.valid) {
        setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'editing', error: lock.error }) : current);
        return;
      }
      setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'submitting', error: '' }) : current);
      const sessionId = editing.sessionId;
      const replacementPayload = withExpectedHold(capabilityIndex, editing.actorId, TYPES.agentReplace, { target: editing.targetId, old_text: editing.oldText, new_text: editing.text, ...(editing.attachments.length ? { attachments: editing.attachments } : {}) }, editing.holdId);
      Promise.resolve(onTaskControl?.({ channelId: state.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentReplace, payload: replacementPayload }))
        .then((replacementId) => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'saving', replacementId: replacementId || '', error: replacementId ? '' : '修改请求未发出' }) : current))
        .catch((failure) => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure.message || String(failure) }) : current));
      return;
    }
    if (editing.phase === 'saving' && editing.replacementId) {
      // 成功由上面的 target.replaced_by 分支收尾；这里只处理 replacement
      // 请求自身的失败终态。
      const replacement = state.turns.get(editing.replacementId);
      if (argsOf(replacement?.terminal)?.status === 'failed') {
        const sessionId = editing.sessionId;
        setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: argsOf(replacement.terminal)?.detail || argsOf(replacement.terminal)?.error_code || '修改失败' }) : current);
      }
    }
  }, [controlVersion, editing?.sessionId, editing?.phase, editing?.contextId, editing?.replacementId, editing?.holdId, frozenByActor, roster]);

  useEffect(() => {
    if (!resumePin) return;
    const turn = state.turns.get(resumePin);
    if (!turn || turn.terminal || agentMessageStage(turn) === 'timeline') setResumePin('');
  }, [controlVersion, resumePin]);

  useEffect(() => {
    const reconnected = previousAccess.current !== 'member_active' && access === 'member_active';
    previousAccess.current = access;
    if (!reconnected || !editing || editing.phase !== 'editing') return;
    const sessionId = editing.sessionId;
    const targetTurn = state.turns.get(editing.targetId);
    setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'checking', error: '' }) : current);
    Promise.resolve(onTaskControl?.({ channelId: state.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} }))
      .then((contextId) => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' }) : current))
      .catch(() => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: '编辑锁已失效' }) : current));
  }, [access]);

  async function startEditing(turn, actorId) {
    if (editing) return;
    setEditNotice('');
    const location = taskControlContext(turn, { selfId, access }).location;
    const sessionId = ++editSessionSerialRef.current;
    const draft = { sessionId, channelId: state.channelId, targetId: turn.requestId, actorId, holdId: '', location, oldText: editableText(turn), text: editableText(turn), attachments: argsOf(turn.request).attachments || [], phase: 'requesting_lock', error: '' };
    setEditing(draft);
    try {
      const holdId = await onTaskControl?.({ channelId: state.channelId, turn, actorId, type: TYPES.agentHold, payload: { target: turn.requestId } });
      if (!holdId) {
        setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: '无法锁定这条任务' }) : current);
        return;
      }
      if (editReleasePendingRef.current.has(sessionId)) {
        releaseEditSession({ ...draft, holdId }, turn);
        return;
      }
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, holdId, phase: 'locking', error: '' }) : current);
    } catch (failure) {
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure?.message || String(failure) || '无法锁定这条任务' }) : current);
    }
  }

  async function verifyAndSave(nextText) {
    if (!editing || editing.phase !== 'editing') return;
    const sessionId = editing.sessionId;
    const targetTurn = state.turns.get(editing.targetId);
    const text = typeof nextText === 'string' ? nextText : editing.text;
    setEditing((current) => current?.sessionId === sessionId ? ({ ...current, text, phase: 'checking', error: '' }) : current);
    try {
      const contextId = await onTaskControl?.({ channelId: state.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} });
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' }) : current);
    } catch (failure) {
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure?.message || String(failure) || '无法确认编辑锁' }) : current);
    }
  }

  async function abandonEditing() {
    if (!editing) return;
    const targetTurn = state.turns.get(editing.targetId);
    if (editing.location === 'processing') setResumePin(editing.targetId);
    releaseEditSession(editing, targetTurn);
    setEditing(null);
  }

  useEffect(() => {
    if (!onComposerEditChange) return;
    onComposerEditChange(editing ? { session: editing, onSave: verifyAndSave, onAbandon: abandonEditing } : null);
  }, [onComposerEditChange, editing?.targetId, editing?.phase, editing?.error]);

  useEffect(() => () => {
    const session = editingRef.current;
    if (session) releaseEditSession(session);
    onComposerEditChange?.(null);
  }, [onComposerEditChange, state.channelId]);

  return <MarkdownFileReferenceProvider onOpen={openFileReference}><ProgressTrailHost>
		<section id="workspace-panel-dynamic" className="timeline timeline-virtualized" role="tabpanel" aria-labelledby="workspace-tab-dynamic" data-viewport-mode={viewport.mode} data-has-initial-anchor={viewport.hasInitialAnchor || undefined}>
      <div className={state.rows.size ? 'timeline-inner timeline-controls-overlay' : 'timeline-inner'}>
        {selfId && Boolean(state.rows.size) && <div className="timeline-scope-bar">
          <div className="timeline-scope" role="group" aria-label="动态范围">
            <button
              type="button"
              aria-pressed={scope === TIMELINE_SCOPE.mine}
              title={`切换为${TIMELINE_SCOPE_LABELS[scope === TIMELINE_SCOPE.mine ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine]}`}
              onClick={() => {
                setScope((value) => value === TIMELINE_SCOPE.mine ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine);
              }}
            >{TIMELINE_SCOPE_LABELS[scope]}</button>
            {actorFilterApplies && filterableAgents.length > 1 && <div className="timeline-actor-filter" role="group" aria-label="按成员过滤">
              {filterableAgents.map((row) => {
                const on = actorFilter.has(row.id);
                const activity = agentActivity?.agents?.[row.id];
                const activityState = activity?.state || '';
                const actorName = names.get(row.id) || row.id;
                return <button
                  key={row.id}
                  type="button"
                  className={[on && 'is-on', activityState && `activity-${activityState}`].filter(Boolean).join(' ')}
                  aria-pressed={on}
                  title={activityState === 'active' ? `${actorName} 正在运行` : activityState === 'settled' ? `${actorName} 已完成，点击确认` : on ? `取消只看 ${actorName}` : `只看我与 ${actorName} 的往来`}
                  onClick={() => {
                    if (activityState === 'settled') onAcknowledgeAgentActivity?.(row.id);
                    // 点一下选中，再点一下取消——按钮各自开关，恒不是单选。
                    setActorFilter((current) => {
                      const next = new Set(current);
                      if (!next.delete(row.id)) next.add(row.id);
                      return next;
                    });
                  }}
                >{activityState && <i className="agent-activity-dot" aria-hidden="true" />}{actorName}</button>;
              })}
            </div>}
          </div>
        </div>}
        {!state.rows.size && <div className="empty-ledger"><span>#</span><h2>这本账还没有可见条目</h2><p>从下方编辑器 @ 一位成员开始。</p></div>}
        {Boolean(state.rows.size) && !entries.length && !queuedTurns.length && (
          // Saying the channel is empty here would be a lie the reader can act
          // on — they would go looking for what they wrote. The channel is full;
          // none of it is theirs.
          <div className="empty-ledger"><span>@</span><h2>这个频道里还没有与你相关的往来</h2><p>切回「全部」可以看到频道里其他人的动态。</p></div>
        )}
	  </div>
	  {viewport.atTop && viewport.mode === 'loading-before' && <div className="timeline-history-status" role="status">正在读取更早动态…</div>}
	  {viewport.status.error && <p className="bounded-list-note timeline-history-error" role="alert">{viewport.status.error}</p>}
		<VirtualTimelineAdapter
		  listKey={messageListKey}
		  rows={withNarration}
		  viewport={viewport}
		  rowRevision={rowRenderRevision}
		  itemKey={(_index, row) => presentationEntryId(row)}
		  renderRow={(index, row) => {
		  const itemIndex = index - firstItemIndex;
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
            content = <ContentFrame><ApprovalCard turn={entry.turn} state={approvalStates[entry.turn.request.id]} onResolve={(reqId, decision, payload) => onResolve(state.channelId, reqId, decision, payload)} names={names} /></ContentFrame>;
          }
          if (!content && entry.kind === 'turn' && entry.turn.request.type === TYPES.agentSelect) {
            const actorId = entry.turn.request.audience?.[0] || '';
            const note = selectSystemNote({ usage: argsOf(entry.turn.terminal)?.usage, describe: capabilityIndex.get(actorId)?.describe, agentName: nameOf(actorId, names) });
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
            const detailsOpen = turnDetail?.selected?.requestId === entry.turn.requestId;
            const fold = { latest: itemIndex === withNarration.length - 1, overrides: effectiveFoldOverrides, onToggle: toggleFold };
            const common = { turn: entry.turn, names, roster, selfId, access, capability: capabilityIndex.get(actorId), frozen: frozenByActor.get(actorId), fold, editActive: Boolean(editing && editing.targetId !== entry.turn.requestId), editSession: editing?.targetId === entry.turn.requestId ? editing : null, onControl: (type, payload) => onTaskControl?.({ channelId: state.channelId, turn: entry.turn, actorId, type, payload }), onEdit: () => startEditing(entry.turn, actorId), onEditText: (text) => setEditing((current) => current && ({ ...current, text, error: '' })), onEditSave: verifyAndSave, onEditAbandon: abandonEditing, onDownload: (attachment) => onDownloadResource?.(state.channelId, attachment), onPreview: (attachment) => onPreviewResource?.(state.channelId, attachment), onCreateTask: onCreateTask ? () => onCreateTask(source) : null, onReply };
            if (isAgentMessageTurn(entry.turn)) {
              content = <div className="timeline-entry" data-entry-id={entry.turn.requestId}><AgentConversationTurn {...common} thread={entry.thread} leadTurns={preemptedSources.get(entry.turn.requestId) || []} mergedCount={mergedCounts.get(entry.turn.requestId) || 0} /></div>;
            } else content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.turn.requestId}><TurnCard turn={entry.turn} thread={entry.thread} roster={roster} names={names} selfId={selfId} access={access} capability={capabilityIndex.get(actorId)} controlState={controlStates[controlKey]} continuation={continuation} detailsOpen={detailsOpen} fold={fold} editSession={editing?.targetId === entry.turn.requestId ? editing : null} editActive={Boolean(editing && editing.targetId !== entry.turn.requestId)} onCancel={() => onCancel?.(state.channelId, entry.turn.requestId)} onControl={(type, payload) => onTaskControl?.({ channelId: state.channelId, turn: entry.turn, actorId, type, payload })} onEdit={() => startEditing(entry.turn, actorId)} onEditText={(text) => setEditing((current) => current && ({ ...current, text, error: '' }))} onEditSave={verifyAndSave} onEditAbandon={abandonEditing} onDownload={(attachment) => onDownloadResource?.(state.channelId, attachment)} onPreview={(attachment) => onPreviewResource?.(state.channelId, attachment)} onReply={onReply} onOpen={() => {
              if (detailsOpen) turnDetail?.onClose?.();
              else {
                // Expanding is a local reading action, not a new ledger entry. Stop the
                // bottom pin before the panel changes height so the clicked message does
                // not jump out of the viewport and appear attached to another turn.
                onOpenTurn?.(entry.turn);
              }
            }} onCloseDetail={turnDetail?.onClose} onCreateTask={onCreateTask ? () => onCreateTask(source) : null} /></div>;
          }
          if (!content) {
            const source = { view: 'dynamic', objectType: 'message', objectId: entry.envelope.id, seq: entry.seq };
            content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.envelope.id}><Standalone envelope={entry.envelope} names={names} roster={roster} selfId={selfId} continuation={continuation} fold={{ latest: itemIndex === withNarration.length - 1, overrides: effectiveFoldOverrides, onToggle: toggleFold }} onCreateTask={onCreateTask ? () => onCreateTask(source) : null} onReply={onReply} /></div>;
          }
		  return <div className="timeline-virtual-item">{content}{boundaryAfterTimestamp > 0 && <div className="timeline-day"><span>{dayLabel(boundaryAfterTimestamp)}</span></div>}</div>;
		  }}
		/>
	  {viewport.unseen > 0 && <button type="button" className="timeline-jump-latest" onClick={viewport.jumpToLatest}>↓ {viewport.unseen} 条新动态</button>}
    </section>
    <div className="conversation-bottom-overlay">
      {editNotice && <p className="agent-edit-error" role="alert">{editNotice}</p>}
      <WaitingLayer turns={queuedTurns} state={state} names={names} selfId={selfId} access={access} capabilityIndex={capabilityIndex} frozenByActor={frozenByActor} editing={editing} onCancel={onCancel} onControl={(turn, actorId, type, payload) => onTaskControl?.({ channelId: state.channelId, turn, actorId, type, payload })} onEdit={startEditing} onEditText={(text) => setEditing((current) => current && ({ ...current, text, error: '' }))} onEditSave={verifyAndSave} onEditAbandon={abandonEditing} />
      {composer}
    </div>
  </ProgressTrailHost></MarkdownFileReferenceProvider>;
}
