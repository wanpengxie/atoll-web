import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoMockContext } from 'react-virtuoso';
import { actorNameFromMap, actorNameMap } from '../model/actor-display.js';
import { resolveFormSpec } from '../model/dynamic-form.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { orderedTimeline } from '../model/fold.js';
import { LIST_WINDOW_SIZE } from '../model/list-window.js';
import { messagePresentation } from '../model/message-presentation.js';
import { replyTargetOf } from '../model/reply-target.js';
import { systemEventPresentation } from '../model/system-event-presentation.js';
import { controlLabel, extraControls, taskControlContext } from '../model/task-controls.js';
import { agentFrozenState, agentMessageStage, editAdmission, editableText, isAgentMessageTurn, lockFromContext, mergedInto, preemptedBy } from '../model/agent-control.js';
import { selectSystemNote } from '../model/agent-selection.js';
import { filterEntriesByActors, scopeEntries, TIMELINE_SCOPE, TIMELINE_SCOPE_LABELS } from '../model/timeline-scope.js';
import { turnProcessSummary, turnStatusLabel } from '../model/turn-presentation.js';
import { processCount, turnStartObservation } from '../model/turn-process.js';
import { diagnostic } from '../model/diagnostics.js';
import { argsOf } from '../protocol/envelope.js';
import { DECISIONS, TYPES } from '../protocol/vocab.js';
import { StructuredResult } from './StructuredResult.jsx';
import { MarkdownContent } from './MarkdownContent.jsx';
import { TurnInlineDetail } from './context/TurnContext.jsx';
import { ContentFrame, MessageFrame } from './timeline/InformationFlow.jsx';
import { ProgressTrail, ProgressTrailHost } from './timeline/ProgressTrail.jsx';

// 平台叙事（成员进出、跨频道入站）暂时不进时间线。它和真正的往来平铺在同一条流里，
// 每次 agent 干活就刷出一串，把人要读的东西淹掉。数据仍然在 state.narration 里，
// 什么都没丢——等它有了合适的落位（侧栏或频道信息页）再接回来。
const SHOW_CHANNEL_NARRATION = false;
const TIMELINE_HISTORY_REVEAL_SIZE = 32;
// firstItemIndex must remain non-negative while prepending. A billion leaves
// ample room for repeated 32-row reveals even in six-figure histories.
const VIRTUAL_INDEX_BASE = 1_000_000_000;

function TimelineVirtualList({ children }) {
  if (import.meta.env.MODE !== 'test') return children;
  return <VirtuosoMockContext.Provider value={{ viewportHeight: 720, itemHeight: 96 }}>{children}</VirtuosoMockContext.Provider>;
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

function ActiveTaskControls({ context, editActive = false, onControl, onEdit }) {
  const extras = extraControls(context);
  if (!context.canEdit && !context.canStop && !extras.length) return null;
  return (
    <section className="task-controls" aria-label="任务控制">
      <div className="task-control-buttons">
        {context.canEdit && <button type="button" onClick={onEdit} disabled={editActive}>编辑</button>}
        {context.canStop && <button type="button" onClick={() => onControl(TYPES.agentInterrupt, {})}>停止</button>}
        {extras.map((entry) => <button key={entry.word} type="button" onClick={() => onControl(entry.word, { target: context.requestId })}>{controlLabel(entry)}</button>)}
      </div>
    </section>
  );
}

const WAIT_HEADER_HEIGHT = 0;
const WAIT_ROW_HEIGHT = 32;
const WAIT_MOBILE_ROW_HEIGHT = 32;

function WaitingLayer({ turns, state, names, selfId, access, frozenByActor, editing, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon }) {
  const [bulk, setBulk] = useState({ actorId: '', error: '' });
  const [collapsed, setCollapsed] = useState(false);
  const layerRef = useRef(null);
  useLayoutEffect(() => {
    const node = layerRef.current;
    const workspace = node?.closest('.workspace');
    if (!node || !workspace || typeof ResizeObserver === 'undefined') return undefined;
    const commit = () => workspace.style.setProperty('--agent-wait-dock-height', `${Math.max(0, Math.ceil(node.getBoundingClientRect().height) - 8)}px`);
    commit();
    const observer = new ResizeObserver(commit);
    observer.observe(node);
    return () => {
      observer.disconnect();
      workspace.style.removeProperty('--agent-wait-dock-height');
    };
  }, [state.channelId, turns.length, collapsed, editing?.targetId]);
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
    const failures = [];
    try {
      const holdId = await onControl(cancellable[0], group.actorId, TYPES.agentHold, {});
      if (!holdId) throw new Error('暂停等待区失败');
      held = true;
      for (const turn of cancellable) {
        try {
          await onCancel?.(state.channelId, turn.requestId);
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }
    } catch (error) {
      failures.push(error?.message || String(error));
    } finally {
      if (held) {
        try {
          await onControl(cancellable[0], group.actorId, TYPES.agentUnhold, {});
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
  const renderedRows = turns.length;
  const layerStyle = {
    '--agent-wait-height': `${WAIT_HEADER_HEIGHT + renderedRows * WAIT_ROW_HEIGHT}px`,
    '--agent-wait-mobile-height': `${WAIT_HEADER_HEIGHT + renderedRows * WAIT_MOBILE_ROW_HEIGHT}px`,
  };
  return <div ref={layerRef} className={`agent-wait-dock${collapsed ? ' is-collapsed' : ''}`}>
    <section className={`agent-wait-layer${collapsed ? ' is-collapsed' : ''}${hasQueuedEditor ? ' is-editing' : ''}`} style={layerStyle} aria-label="等待区">
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
                  {context.canInsert && <button type="button" onClick={() => onControl(turn, group.actorId, TYPES.agentSteer, { target: turn.requestId })}>插入</button>}
                  {context.canEdit && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, group.actorId)}>编辑</button>}
                  {context.canCancel && <button type="button" onClick={() => onCancel?.(state.channelId, turn.requestId)}>取消</button>}
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

function AgentBubble({ turn, title, mergedCount = 0, frozen = null, names, roster = [], selfId = '', quotedRequest = null, onDownload, onPreview, onReply, compact = false, hasThreadChildren = false }) {
  const request = turn.request;
  const terminal = turn.terminal;
  const stopped = terminal?.payload?.status === 'failed' && terminal.payload?.error_code === 'interrupted';
  const resumable = stopped && frozen?.source === TYPES.agentInterrupt && (!frozen.target_id || frozen.target_id === turn.requestId);
  const liveEnvelope = latestTurnEnvelope(turn);
  const agentId = terminal?.sender?.id || liveEnvelope?.sender?.id || request.audience?.[0];
  const bubbleTs = terminal?.ts || liveEnvelope?.ts;
  const processStartedTs = turnStartedAt(turn);
  const className = `agent-turn-bubble${terminal ? ' settled' : ' processing'}${compact ? ' compact' : ''}${hasThreadChildren ? ' has-thread-children' : ''}`;
  const identity = <span className="actor-icon kind-agent">A</span>;
  const heading = <header><strong>{nameOf(agentId, names)}</strong><small className="ai-label">AI</small>{bubbleTs && <time>{timeLabel(bubbleTs)}</time>}</header>;
  const content = <>
    {quotedRequest && <AgentRequestQuote request={quotedRequest} names={names} onDownload={onDownload} onPreview={onPreview} />}
    {!terminal && <ProgressTrail turn={turn} running title={title} startedAt={processStartedTs} mergedCount={mergedCount} />}
    {stopped && <p className="agent-stopped">✗ 已停止{resumable ? ' · 发消息即继续' : ''}</p>}
    {terminal && !stopped && <div className="response-content"><StructuredResult requestType={request.type} payload={conversationPayload(terminal.payload)} renderText={(text) => <MarkdownContent text={text} />} /></div>}
    {terminal && <ProgressTrail turn={turn} running={false} />}
  </>;
  if (compact) return <article className={`agent-thread-message ${className}`} tabIndex="0">
    <div className="agent-thread-identity-row">{identity}{heading}</div>
    <div className="agent-thread-content">{content}</div>
  </article>;
  const replyTarget = terminal && terminal.payload?.status === 'completed'
    ? replyTargetOf(terminal, { roster, selfId, fallbackSenderId: request.audience?.[0], fallbackSenderKind: 'agent' })
    : null;
  return <ReplyableMessageFrame replyTarget={replyTarget} copyText={terminal ? messagePresentation(terminal).text : ''} onReply={onReply} className={className} contentClassName="response-body" identity={identity}>{heading}{content}</ReplyableMessageFrame>;
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
  const collaborative = thread.filter((item) => isAgentMessageTurn(item.turn) && item.turn.request?.sender?.kind === 'agent');
  if (!collaborative.length) return null;
  return <ol className="agent-message-thread" role="tree" aria-label="Agent 协作消息">
    {collaborative.map((item, index) => {
      const child = item.turn;
      const request = child.request;
      const requestView = messagePresentation(request);
      const rails = threadRails(collaborative, index);
      const hasChildren = collaborative[index + 1]?.depth === item.depth + 1;
      return <li key={child.requestId} className={`agent-thread-node status-${child.status}${hasChildren ? ' has-children' : ''}`} style={{ '--thread-depth': item.depth }} role="treeitem" aria-level={item.depth + 1}>
        <span className="agent-thread-elbow" aria-hidden="true" />
        {rails.map((rail) => <span key={rail.level} className={`agent-thread-rail ${rail.continues ? 'continues' : 'ends'}`} style={{ '--thread-rail-level': rail.level }} aria-hidden="true" />)}
        {hasChildren && <span className="agent-thread-child-stem" aria-hidden="true" />}
        <div className="agent-thread-response"><AgentBubble turn={child} title={requestView.text} names={names} quotedRequest={request} onDownload={onDownload} onPreview={onPreview} compact /></div>
      </li>;
    })}
  </ol>;
}

function AgentConversationTurn({ turn, thread = [], leadTurns = [], mergedCount = 0, names, roster, selfId, access, frozen, editActive, editSession = null, onControl, onEdit, onDownload, onPreview, onReply }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const requestText = requestView.text;
  const controlContext = taskControlContext(turn, { selfId, access });
  const lead = leadTurns.map((item) => messagePresentation(item.request).text);
  const processingTitle = [...lead, requestText].join(' ＋ ');
  const suppressAgentBubble = Boolean(mergedInto(turn) || preemptedBy(turn));
  return <section className={`turn-card agent-conversation-turn self status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
    <MessageFrame className="request-message" identity={<span className="actor-icon kind-human">H</span>}>
      <header><strong>{nameOf(request.sender?.id, names)}</strong><time>{timeLabel(request.ts)}</time></header>
      <div className="request-text"><MarkdownContent text={requestText} /></div>
      {editSession && <small className="message-editing-state">正在输入框中编辑</small>}
      <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
    </MessageFrame>
    {!turn.terminal && !editSession && <ContentFrame contained><ActiveTaskControls context={controlContext} editActive={editActive} onControl={onControl} onEdit={onEdit} /></ContentFrame>}
    {!suppressAgentBubble && <AgentBubble turn={turn} title={processingTitle} mergedCount={mergedCount} frozen={frozen} names={names} roster={roster} selfId={selfId} onReply={onReply} hasThreadChildren={thread.some((item) => isAgentMessageTurn(item.turn) && item.turn.request?.sender?.kind === 'agent')} />}
    <AgentThreadMessages thread={thread} names={names} onDownload={onDownload} onPreview={onPreview} />
  </section>;
}

function TurnCard({ turn, thread = [], roster, names, selfId, access, capability, controlState, continuation = false, detailsOpen = false, editSession = null, editActive = false, queuePosition = 0, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon, onDownload, onPreview, onOpen, onCreateTask, onReply, onCloseDetail }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const self = request.sender?.id === selfId;
  const controlContext = taskControlContext(turn, { selfId, access });
  const replyTarget = replyTargetOf(request, { roster, selfId });
  return (
    <section className={`turn-card ${continuation ? 'continuation' : ''} ${self ? 'self' : ''} status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
      <ReplyableMessageFrame replyTarget={replyTarget} copyText={requestView.text} onReply={onReply} onCreateTask={onCreateTask} className="request-message" identity={<span className={`actor-icon kind-${request.sender?.kind}`}>{request.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(request.sender?.id, names)}</strong>{request.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(request.ts)}</time>{request.audience?.length > 0 && <span className="recipient-label">发送给 {request.audience.map((id) => nameOf(id, names)).join('、')}</span>}</header>
          <div className="request-text"><MarkdownContent text={requestView.text} />{requestView.detail && <p className="message-detail">{requestView.detail}</p>}</div>
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

function Standalone({ envelope, names, roster, selfId, continuation = false, onCreateTask, onReply }) {
  const view = messagePresentation(envelope);
  const self = envelope.sender?.id === selfId;
  const replyTarget = replyTargetOf(envelope, { roster, selfId });
  return (
    <ReplyableMessageFrame replyTarget={replyTarget} copyText={view.text} onReply={onReply} onCreateTask={onCreateTask} className={`standalone-row ${continuation ? 'continuation' : ''} ${self ? 'self' : ''}`} identity={continuation ? <time className="continuation-time" aria-label={`${nameOf(envelope.sender?.id, names)}，${timeLabel(envelope.ts)}`}>{timeLabel(envelope.ts)}</time> : <span className={`actor-icon kind-${envelope.sender?.kind}`}>{envelope.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
      {!continuation && <header><strong>{nameOf(envelope.sender?.id, names)}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(envelope.ts)}</time></header>}<MarkdownContent text={view.text} />{view.detail && <p className="message-detail">{view.detail}</p>}
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

export function Timeline({ state, history = {}, onRevealHistory, roster, selfId, agentActivity, onAcknowledgeAgentActivity, pending, approvalStates, controlStates = {}, capabilityIndex = new Map(), access = '', onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, turnDetail, onComposerEditChange }) {
  const [scope, setScope] = useState(TIMELINE_SCOPE.mine);
  // 选中的 agent。空集 = 不过滤（常态）。Timeline 按频道 key 挂载，所以切频道
  // 天然重置，恒不需要自己清。
  const [actorFilter, setActorFilter] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [editNotice, setEditNotice] = useState('');
  const [resumePin, setResumePin] = useState('');
  const [presentationNow, setPresentationNow] = useState(() => Date.now());
	const messageListRef = useRef(null);
	const messageListScrollerRef = useRef(null);
	const messageListScrollCleanupRef = useRef(() => {});
	const listTransitionRef = useRef({ key: '', firstSeq: 0, lastSeq: 0, length: 0, firstItemIndex: VIRTUAL_INDEX_BASE });
	const [messageListAtBottom, setMessageListAtBottom] = useState(true);
	const [messageListUnseen, setMessageListUnseen] = useState(0);
	// Top loading is a level-triggered operation scoped to the current visible
	// projection.  It must not be an anonymous boolean that a later mount effect
	// can erase after Virtuoso already observed the top.
	const historyDemandRef = useRef({ context: '', pending: false, anchorSeq: 0, armed: true });
	const historyTopProbeRef = useRef('');
	const historyInteractionReadyRef = useRef('');
	const historyRevealVersionRef = useRef(Number(history?.revealVersion || 0));
	const previousAccess = useRef(access);
	const setMessageListScroller = useCallback((node) => {
	  if (messageListScrollerRef.current === node) return;
	  messageListScrollCleanupRef.current();
	  messageListScrollerRef.current = node;
	  if (!node) {
		messageListScrollCleanupRef.current = () => {};
		return;
	  }
	  const handleScroll = () => {
		const demand = historyDemandRef.current;
		if (node.scrollTop > 1 && !demand.pending) demand.armed = true;
	  };
	  node.addEventListener('scroll', handleScroll, { passive: true });
	  messageListScrollCleanupRef.current = () => node.removeEventListener('scroll', handleScroll);
	}, []);
	useEffect(() => () => messageListScrollCleanupRef.current(), []);
  const names = useMemo(() => actorNameMap(roster), [roster]);
  // 正在编辑的消息钉在原地：协议上"处理中被编辑"的消息会被打断回队列（Resumed），
  // 但呈现上必须留在用户点下"编辑"的位置原地变可编辑——恒不在编辑中途瞬移。
  // 只钉"从处理中进入编辑"的：等待区消息的编辑本来就发生在等待区原地。
  // 保存/放弃后钉住不放（resumePin），直到账上真正回到处理中——否则解冻帧到达前
  // 的空窗里消息会闪跳进等待区。
  const editingTargetId = editing?.location === 'processing' ? editing.targetId : resumePin;
  const allEntries = useMemo(() => orderedTimeline(state).filter((entry) => {
    // Terminal lifecycle rows remain in the ledger for agents and audit, but
    // they are transport bookkeeping rather than timeline content.
    if (entry.kind === 'standalone' && entry.envelope?.type === 'terminal.session') return false;
    if (entry.kind !== 'turn') return true;
    if ([TYPES.agentHold, TYPES.agentUnhold, TYPES.agentInterrupt, TYPES.agentContext, TYPES.agentFork, TYPES.describe].includes(entry.turn.request.type)) return false;
    // select/new 都不是用户发言；成功终态只收成一条系统确认。select 的
    // pending/failed/superseded 状态留在参数区；new 排队时则仍由等待区承接。
    if ([TYPES.agentSelect, TYPES.agentNew].includes(entry.turn.request.type)) return entry.turn.terminal?.payload?.status === 'completed';
    if (entry.turn.requestId === editingTargetId) return true;
    if (isAgentMessageTurn(entry.turn)) return agentMessageStage(entry.turn) === 'timeline';
    return true;
  }), [state, state.lastSeq, state.turns.size, state.standalone.length, state.orphans.length, editingTargetId]);
  const scoped = useMemo(() => scopeEntries(allEntries, { scope, state, selfId }), [allEntries, scope, state, state.lastSeq, selfId]);
  // 成员过滤只在「@我」下成立：「全部」的意思就是不收窄，摆一列过滤在那里是自相矛盾。
  // 切到「全部」时这一列收起、过滤同时**失效**——恒不留一个看不见却仍在改变画面的
  // 状态。选中本身留着，切回「@我」时那一列连同亮着的选中一起回来。
  const actorFilterApplies = scope === TIMELINE_SCOPE.mine;
  const entries = useMemo(
    () => (actorFilterApplies ? filterEntriesByActors(scoped, actorFilter) : scoped),
    [scoped, actorFilter, actorFilterApplies],
  );
  // 名册里的 agent 才进过滤条：人和工具恒不是"我在跟谁说话"的那个谁。
  const filterableAgents = useMemo(() => (roster || []).filter((row) => row.kind === 'agent'), [roster]);
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
  const latestVisibleSeq = withNarration.at(-1)?.seq || 0;
	const firstVisibleSeq = withNarration[0]?.seq || 0;
	const historyProjectionKey = `${state.channelId}:${scope}:${actorFilterApplies ? [...actorFilter].sort().join(',') : ''}`;
	const previousList = listTransitionRef.current;
	const messageListKey = `${state.channelId}:${scope}`;
	let firstItemIndex = previousList.firstItemIndex;
	if (previousList.key !== messageListKey) firstItemIndex = VIRTUAL_INDEX_BASE;
	else if (firstVisibleSeq && previousList.firstSeq && firstVisibleSeq < previousList.firstSeq) {
	  const prepended = withNarration.findIndex((entry) => entry.seq === previousList.firstSeq);
	  if (prepended > 0) firstItemIndex = previousList.firstItemIndex - prepended;
	}
	const nextListTransition = {
	  key: messageListKey,
	  firstSeq: firstVisibleSeq,
	  lastSeq: latestVisibleSeq,
	  length: withNarration.length,
	  firstItemIndex,
	};
	useLayoutEffect(() => {
	  listTransitionRef.current = nextListTransition;
	}, [messageListKey, firstVisibleSeq, latestVisibleSeq, withNarration.length, firstItemIndex]);
  // The fold's visible window can now be large: Message List virtualizes it.
  // Older historical batches remain outside React in the scheduler reservoir
  // until a top demand releases 32 rows.
  const windowStart = 0;
  const windowed = {
	items: withNarration,
    start: windowStart,
    end: withNarration.length,
    total: withNarration.length,
    hasOlder: windowStart > 0,
  };
	// Day separators used to scan all preceding entries for every row (O(n²)).
	// Keep the last meaningful timestamp in one pass; virtualization then only
	// has to construct DOM for the viewport.
	const previousTimestampByIndex = [];
	let previousTimestampCursor = 0;
	for (let index = 0; index < windowed.items.length; index += 1) {
	  previousTimestampByIndex[index] = previousTimestampCursor;
	  previousTimestampCursor = entryTimestamp(windowed.items[index]) || previousTimestampCursor;
	}
  const queuedTurns = [...state.turns.values()]
    .filter((turn) => agentMessageStage(turn) === 'queued' && turn.requestId !== editingTargetId)
    .sort((left, right) => {
      const leftTarget = argsOf(left.request).target;
      const rightTarget = argsOf(right.request).target;
      const leftSeq = left.request.type === TYPES.agentReplace ? state.turns.get(leftTarget)?.requestSeq || left.requestSeq : left.requestSeq;
      const rightSeq = right.request.type === TYPES.agentReplace ? state.turns.get(rightTarget)?.requestSeq || right.requestSeq : right.requestSeq;
      return leftSeq - rightSeq;
    });
  const frozenByActor = new Map();
  for (const turn of state.turns.values()) {
    const actorId = turn.request?.audience?.length === 1 ? turn.request.audience[0] : '';
    if (actorId && !frozenByActor.has(actorId)) frozenByActor.set(actorId, agentFrozenState(state, actorId, presentationNow));
  }
  const nextFreezeDeadline = Math.min(...[...frozenByActor.values()].filter(Boolean).map((value) => value.until));
  const preemptedSources = new Map();
  const mergedCounts = new Map();
  for (const turn of state.turns.values()) {
    const replacement = preemptedBy(turn);
    if (replacement) preemptedSources.set(replacement, [...(preemptedSources.get(replacement) || []), turn]);
    const owner = mergedInto(turn);
    if (owner) mergedCounts.set(owner, (mergedCounts.get(owner) || 0) + 1);
  }
	function scrollerIsAtBottom() {
	  const scroller = messageListScrollerRef.current;
	  return scroller
		? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 24
		: messageListAtBottom;
	}

	function scrollerIsAtTop() {
	  const scroller = messageListScrollerRef.current;
	  return Boolean(scroller) && scroller.scrollTop <= 1;
	}

	function demandForCurrentProjection() {
	  if (historyDemandRef.current.context !== historyProjectionKey) {
		historyDemandRef.current = { context: historyProjectionKey, pending: false, anchorSeq: 0, armed: true };
	  }
	  return historyDemandRef.current;
	}

	function clearCurrentHistoryDemand({ rearm = false } = {}) {
	  const demand = historyDemandRef.current;
	  if (demand.context !== historyProjectionKey) return;
	  demand.pending = false;
	  demand.anchorSeq = 0;
	  if (rearm) demand.armed = true;
	}

	function markLatestRead() {
	  if (!state.lastSeq || !messageListScrollerRef.current) return;
	  if (document.visibilityState === 'hidden' || !scrollerIsAtBottom()) return;
	  history?.onReadLatest?.(state.lastSeq);
	}

	useEffect(() => {
	  markLatestRead();
	  const handleVisibility = () => markLatestRead();
	  document.addEventListener('visibilitychange', handleVisibility);
	  return () => document.removeEventListener('visibilitychange', handleVisibility);
	}, [state.lastSeq, messageListAtBottom, history?.onReadLatest]);

	useEffect(() => {
	  const physicallyAtBottom = scrollerIsAtBottom();
	  if (previousList.key !== messageListKey || physicallyAtBottom) {
		setMessageListUnseen(0);
		return;
	  }
	  const added = Math.max(0, withNarration.length - previousList.length);
	  if (added > 0 && latestVisibleSeq > previousList.lastSeq) {
		diagnostic('debug', 'timeline.realtime_arrived_while_reading', {
		  channelId: state.channelId, added, latestVisibleSeq, previousLastSeq: previousList.lastSeq,
		});
		setMessageListUnseen((value) => value + added);
	  }
	}, [messageListKey, latestVisibleSeq, withNarration.length]);

	function handleAtBottomChange(isAtBottom) {
	  // Measurement and prepend compensation can transiently report atBottom
	  // using the previous range. Never let that erase an unread marker while
	  // the actual scroller is still in history.
	  const confirmed = isAtBottom && scrollerIsAtBottom();
	  setMessageListAtBottom(confirmed);
	  if (confirmed) {
		historyInteractionReadyRef.current = messageListKey;
		setMessageListUnseen(0);
		// A short or heavily filtered list can be at top and bottom at once.  In
		// that state bottom is not evidence that the top demand was satisfied.
		if (!scrollerIsAtTop()) clearCurrentHistoryDemand({ rearm: true });
		else window.setTimeout(() => requestHistoryAtTop('short-list-ready'), 0);
		markLatestRead();
	  }
	}

	function releaseHistoryForDemand(trigger) {
	  const demand = demandForCurrentProjection();
	  const released = Number(onRevealHistory?.(TIMELINE_HISTORY_REVEAL_SIZE)) || 0;
	  diagnostic('debug', released ? 'timeline.history_revealed' : 'timeline.history_demand_waiting', {
		channelId: state.channelId,
		released,
		buffered: Number(history?.buffered || 0),
		hasOlder: Boolean(history?.hasOlder),
		loading: Boolean(history?.loading),
		attached: Boolean(history?.attached),
		generation: Number(history?.generation || 0),
		firstVisibleSeq,
		demandAnchorSeq: demand.anchorSeq,
		trigger,
	  });
	  return released;
	}

	function requestHistoryAtTop(trigger) {
	  const demand = demandForCurrentProjection();
	  const scroller = messageListScrollerRef.current;
	  const physicallyAtTop = !scroller || scroller.scrollTop <= 1;
	  const detail = {
		channelId: state.channelId,
		trigger,
		demandPending: demand.pending,
		demandArmed: demand.armed,
		demandAnchorSeq: demand.anchorSeq,
		firstVisibleSeq,
		latestVisibleSeq,
		visibleItems: withNarration.length,
		buffered: Number(history?.buffered || 0),
		hasOlder: Boolean(history?.hasOlder),
		loading: Boolean(history?.loading),
		attached: Boolean(history?.attached),
		generation: Number(history?.generation || 0),
		scrollTop: Math.round(Number(scroller?.scrollTop || 0)),
		scrollHeight: Math.round(Number(scroller?.scrollHeight || 0)),
		clientHeight: Math.round(Number(scroller?.clientHeight || 0)),
		physicallyAtTop,
		interactionReady: historyInteractionReadyRef.current === messageListKey,
	  };
	  if (historyInteractionReadyRef.current !== messageListKey) {
		diagnostic('info', 'timeline.history_top_not_ready', detail);
		return;
	  }
	  if (!physicallyAtTop) {
		diagnostic('info', 'timeline.history_top_stale', detail);
		return;
	  }
	  diagnostic('info', demand.pending || !demand.armed ? 'timeline.history_top_ignored' : 'timeline.history_top_observed', detail);
	  if (demand.pending || !demand.armed) return;
	  demand.pending = true;
	  demand.armed = false;
	  demand.anchorSeq = firstVisibleSeq;
	  releaseHistoryForDemand(trigger);
	}

	function handleStartReached() {
	  requestHistoryAtTop('start-reached');
	}

	function handleAtTopChange(isAtTop) {
	  if (isAtTop) {
		requestHistoryAtTop('at-top-state');
		return;
	  }
	  const demand = demandForCurrentProjection();
	  if (!scrollerIsAtTop() && !demand.pending) {
		demand.armed = true;
		diagnostic('debug', 'timeline.history_top_left', {
		  channelId: state.channelId,
		  pending: demand.pending,
		  scrollTop: Math.round(Number(messageListScrollerRef.current?.scrollTop || 0)),
		});
	  }
	}

	useEffect(() => {
	  const demand = historyDemandRef.current;
	  if (demand.context !== historyProjectionKey) return undefined;
	  const version = Number(history?.revealVersion || 0);
	  const exhausted = Boolean(history?.attached)
		&& !history?.loading
		&& !history?.hasOlder
		&& Number(history?.buffered || 0) <= 0;
	  if (demand.pending && exhausted) {
		diagnostic('info', 'timeline.history_demand_exhausted', {
		  channelId: state.channelId, firstVisibleSeq, buffered: Number(history?.buffered || 0),
		  hasOlder: Boolean(history?.hasOlder), attached: Boolean(history?.attached),
		});
		clearCurrentHistoryDemand();
	  }
	  if (version === historyRevealVersionRef.current) return undefined;
	  historyRevealVersionRef.current = version;
	  if (!demand.pending) return undefined;

	  const anchor = demand.anchorSeq;
	  const visiblePrepend = firstVisibleSeq > 0 && (anchor === 0 || firstVisibleSeq < anchor);
	  if (visiblePrepend) {
		const scroller = messageListScrollerRef.current;
		const stillShortAtTop = Boolean(scroller)
		  && scroller.clientHeight > 0
		  && scroller.scrollTop <= 1
		  && scroller.scrollHeight <= scroller.clientHeight + 1;
		if (stillShortAtTop && !exhausted) {
		  demand.anchorSeq = firstVisibleSeq;
		  diagnostic('debug', 'timeline.history_short_list_continues', {
			channelId: state.channelId, firstVisibleSeq,
			scrollHeight: Math.round(scroller.scrollHeight), clientHeight: Math.round(scroller.clientHeight),
		  });
		  const timer = window.setTimeout(() => releaseHistoryForDemand('short-list-fill'), 0);
		  return () => window.clearTimeout(timer);
		}
		diagnostic('info', 'timeline.history_demand_satisfied', {
		  channelId: state.channelId, anchorSeq: anchor, firstVisibleSeq,
		  buffered: Number(history?.buffered || 0), hasOlder: Boolean(history?.hasOlder),
		});
		clearCurrentHistoryDemand();
		if (!scrollerIsAtTop()) demandForCurrentProjection().armed = true;
		return undefined;
	  }
	  if (exhausted) return undefined;

	  // A history batch is a ledger-row batch, not a rendered-item batch.  The
	  // whole batch may be housekeeping, filtered agent traffic, or rows that
	  // merely complete the first visible root turn.  Virtuoso then sees no
	  // prepend and will not emit startReached a second time.  Keep the existing
	  // top demand sticky, but claim only one additional bounded batch per render.
	  const timer = window.setTimeout(() => {
		const current = historyDemandRef.current;
		if (current.context === historyProjectionKey && current.pending) releaseHistoryForDemand('projection-empty');
	  }, 0);
	  return () => window.clearTimeout(timer);
	}, [history?.revealVersion, history?.attached, history?.loading, history?.hasOlder, history?.buffered, firstVisibleSeq, onRevealHistory, historyProjectionKey]);

	// Treat "the current projection is physically at the top" as state, not as
	// a callback edge.  This closes races where Virtuoso emitted startReached
	// before attach/cache metadata settled or while React mount effects ran.
	useEffect(() => {
	  if (historyTopProbeRef.current === historyProjectionKey) return undefined;
	  historyTopProbeRef.current = historyProjectionKey;
	  const canLoad = Number(history?.buffered || 0) > 0
		|| Boolean(history?.hasOlder)
		|| Boolean(history?.loading)
		|| !history?.attached;
	  if (!canLoad) return undefined;
	  const timer = window.setTimeout(() => {
		const demand = demandForCurrentProjection();
		if (scrollerIsAtTop() && !demand.pending) requestHistoryAtTop('top-level-state');
	  }, 0);
	  return () => window.clearTimeout(timer);
	}, [historyProjectionKey, history?.attached, history?.loading, history?.hasOlder, history?.buffered, history?.revealVersion, firstVisibleSeq]);

  useEffect(() => {
	  historyRevealVersionRef.current = Number(history?.revealVersion || 0);
    setScope(TIMELINE_SCOPE.mine);
    setEditNotice('');
  }, [state.channelId]);
  useEffect(() => setPresentationNow(Date.now()), [state.lastSeq]);
  useEffect(() => {
    if (!Number.isFinite(nextFreezeDeadline)) return undefined;
    const timer = window.setTimeout(() => setPresentationNow(Date.now()), Math.max(1, nextFreezeDeadline - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [nextFreezeDeadline]);

  useEffect(() => {
    if (!editing) return;
    if (editing.phase === 'locking') {
      const admission = editAdmission(state, editing);
      if (admission.error) {
        setEditing(null);
        setEditNotice(admission.error);
      }
      else if (admission.ready) setEditing((current) => current && ({ ...current, phase: 'editing', error: '' }));
      return;
    }
    if (editing.phase === 'checking') {
      const contextTurn = state.turns.get(editing.contextId);
      if (!contextTurn?.terminal) return;
      if (contextTurn.terminal.payload?.status !== 'completed') {
        setEditing((current) => current && ({ ...current, phase: 'editing', error: contextTurn.terminal.payload?.detail || '编辑锁已失效' }));
        return;
      }
      const lock = lockFromContext(contextTurn.terminal.payload, editing.holdId);
      if (!lock.valid) {
        setEditing((current) => current && ({ ...current, phase: 'editing', error: lock.error }));
        return;
      }
      const targetTurn = state.turns.get(editing.targetId);
      setEditing((current) => current && ({ ...current, phase: 'submitting', error: '' }));
      Promise.resolve(onTaskControl?.({ channelId: state.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentReplace, payload: { target: editing.targetId, old_text: editing.oldText, new_text: editing.text, ...(editing.attachments.length ? { attachments: editing.attachments } : {}) } }))
        .then((replacementId) => setEditing((current) => current && ({ ...current, phase: 'saving', replacementId: replacementId || '', error: replacementId ? '' : '修改请求未发出' })))
        .catch((failure) => setEditing((current) => current && ({ ...current, phase: 'editing', error: failure.message || String(failure) })));
      return;
    }
    if (editing.phase === 'saving' && editing.replacementId) {
      // 协议形（§4.6）：替换生效的账面事实 = 原行终态 replaced_by 指向 replace 请求；
      // replace 请求自身即新行（入队，不立刻终态）。失败才落在 replace 请求的终态上。
      const replacement = state.turns.get(editing.replacementId);
      if (replacement?.terminal?.payload?.status === 'failed') {
        setEditing((current) => current && ({ ...current, phase: 'editing', error: replacement.terminal.payload?.detail || replacement.terminal.payload?.error_code || '修改失败' }));
        return;
      }
      const target = state.turns.get(editing.targetId);
      const replacedBy = target?.terminal?.payload?.replaced_by ?? target?.terminal?.payload?.value?.replaced_by;
      if (replacedBy !== editing.replacementId) return;
      // 替换已生效，立即解冻让队列续跑——编辑收尾恒不把消息留在暂停的等待区。
      Promise.resolve(onTaskControl?.({ channelId: state.channelId, turn: target, actorId: editing.actorId, type: TYPES.agentUnhold, payload: {} })).catch(() => {});
      if (editing.location === 'processing') setResumePin(editing.replacementId);
      setEditing(null);
    }
  }, [state.lastSeq, editing?.phase, editing?.contextId, editing?.replacementId]);

  useEffect(() => {
    if (!resumePin) return;
    const turn = state.turns.get(resumePin);
    if (!turn || turn.terminal || agentMessageStage(turn) === 'timeline') setResumePin('');
  }, [state.lastSeq, resumePin]);

  useEffect(() => {
    const reconnected = previousAccess.current !== 'member_active' && access === 'member_active';
    previousAccess.current = access;
    if (!reconnected || !editing || editing.phase !== 'editing') return;
    const targetTurn = state.turns.get(editing.targetId);
    setEditing((current) => current && ({ ...current, phase: 'checking', error: '' }));
    Promise.resolve(onTaskControl?.({ channelId: state.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} }))
      .then((contextId) => setEditing((current) => current && ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' })))
      .catch(() => setEditing((current) => current && ({ ...current, phase: 'editing', error: '编辑锁已失效' })));
  }, [access]);

  async function startEditing(turn, actorId) {
    if (editing) return;
    setEditNotice('');
    const location = taskControlContext(turn, { selfId, access }).location;
    const draft = { targetId: turn.requestId, actorId, holdId: '', location, oldText: editableText(turn), text: editableText(turn), attachments: argsOf(turn.request).attachments || [], phase: 'requesting_lock', error: '' };
    setEditing(draft);
    try {
      const holdId = await onTaskControl?.({ channelId: state.channelId, turn, actorId, type: TYPES.agentHold, payload: { target: turn.requestId } });
      if (!holdId) {
        setEditing((current) => current?.targetId === turn.requestId ? ({ ...current, phase: 'editing', error: '无法锁定这条任务' }) : current);
        return;
      }
      setEditing((current) => current?.targetId === turn.requestId ? ({ ...current, holdId, phase: 'locking', error: '' }) : current);
    } catch (failure) {
      setEditing((current) => current?.targetId === turn.requestId ? ({ ...current, phase: 'editing', error: failure?.message || String(failure) || '无法锁定这条任务' }) : current);
    }
  }

  async function verifyAndSave(nextText) {
    if (!editing || editing.phase !== 'editing') return;
    const targetTurn = state.turns.get(editing.targetId);
    const text = typeof nextText === 'string' ? nextText : editing.text;
    setEditing((current) => current && ({ ...current, text, phase: 'checking', error: '' }));
    const contextId = await onTaskControl?.({ channelId: state.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} });
    setEditing((current) => current && ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' }));
  }

  async function abandonEditing() {
    if (!editing) return;
    const targetTurn = state.turns.get(editing.targetId);
    if (editing.location === 'processing') setResumePin(editing.targetId);
    setEditing(null);
    await onTaskControl?.({ channelId: state.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentUnhold, payload: {} });
  }

  useEffect(() => {
    if (!onComposerEditChange) return;
    onComposerEditChange(editing ? { session: editing, onSave: verifyAndSave, onAbandon: abandonEditing } : null);
  }, [onComposerEditChange, editing?.targetId, editing?.phase, editing?.error]);

  useEffect(() => () => onComposerEditChange?.(null), [onComposerEditChange, state.channelId]);

  return <ProgressTrailHost>
	<section id="workspace-panel-dynamic" className="timeline timeline-virtualized" role="tabpanel" aria-labelledby="workspace-tab-dynamic" aria-live="polite" aria-atomic="false" aria-relevant="additions text">
      <div className="timeline-inner">
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
        {history?.loading && <span className="sr-only" role="status">正在读取更早动态</span>}
        {history?.error && <p className="bounded-list-note" role="alert">{history.error}</p>}
	  </div>
	  <TimelineVirtualList>
		<Virtuoso
		  key={messageListKey}
		  ref={messageListRef}
		  scrollerRef={setMessageListScroller}
		  className="timeline-message-list"
		  firstItemIndex={firstItemIndex}
		  initialTopMostItemIndex={import.meta.env.MODE === 'test' ? undefined : { index: 'LAST', align: 'end' }}
		  alignToBottom
		  atBottomThreshold={24}
		  increaseViewportBy={480}
		  data={windowed.items.map((entry, index) => {
			const id = entry.kind === 'turn' ? entry.turn.request.id : entry.kind === 'narration' ? 'narration' : `${entry.kind}-${entry.envelope.id}`;
			return { id, render: () => {
          const continuation = isContinuation(windowed.items, index);
          const timestamp = entryTimestamp(entry);
          const previousTimestamp = previousTimestampByIndex[index] || 0;
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
          if (!content && entry.kind === 'turn' && entry.turn.request.type === TYPES.agentSelect) {
            const actorId = entry.turn.request.audience?.[0] || '';
            const note = selectSystemNote({ usage: entry.turn.terminal?.payload?.usage, describe: capabilityIndex.get(actorId)?.describe, agentName: nameOf(actorId, names) });
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
            const common = { turn: entry.turn, names, roster, selfId, access, capability: capabilityIndex.get(actorId), frozen: frozenByActor.get(actorId), editActive: Boolean(editing && editing.targetId !== entry.turn.requestId), editSession: editing?.targetId === entry.turn.requestId ? editing : null, onControl: (type, payload) => onTaskControl?.({ channelId: state.channelId, turn: entry.turn, actorId, type, payload }), onEdit: () => startEditing(entry.turn, actorId), onEditText: (text) => setEditing((current) => current && ({ ...current, text, error: '' })), onEditSave: verifyAndSave, onEditAbandon: abandonEditing, onDownload: (attachment) => onDownloadResource?.(state.channelId, attachment), onPreview: (attachment) => onPreviewResource?.(state.channelId, attachment), onReply };
            if (isAgentMessageTurn(entry.turn)) {
              content = <div className="timeline-entry" data-entry-id={entry.turn.requestId}><AgentConversationTurn {...common} thread={entry.thread} leadTurns={preemptedSources.get(entry.turn.requestId) || []} mergedCount={mergedCounts.get(entry.turn.requestId) || 0} /></div>;
            } else content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.turn.requestId}><TurnCard turn={entry.turn} thread={entry.thread} roster={roster} names={names} selfId={selfId} access={access} capability={capabilityIndex.get(actorId)} controlState={controlStates[controlKey]} continuation={continuation} detailsOpen={detailsOpen} editSession={editing?.targetId === entry.turn.requestId ? editing : null} editActive={Boolean(editing && editing.targetId !== entry.turn.requestId)} onCancel={() => onCancel?.(state.channelId, entry.turn.requestId)} onControl={(type, payload) => onTaskControl?.({ channelId: state.channelId, turn: entry.turn, actorId, type, payload })} onEdit={() => startEditing(entry.turn, actorId)} onEditText={(text) => setEditing((current) => current && ({ ...current, text, error: '' }))} onEditSave={verifyAndSave} onEditAbandon={abandonEditing} onDownload={(attachment) => onDownloadResource?.(state.channelId, attachment)} onPreview={(attachment) => onPreviewResource?.(state.channelId, attachment)} onReply={onReply} onOpen={() => {
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
            content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.envelope.id}><Standalone envelope={entry.envelope} names={names} roster={roster} selfId={selfId} continuation={continuation} onCreateTask={onCreateTask ? () => onCreateTask(source) : null} onReply={onReply} /></div>;
          }
		  return <>{showDay && <div className="timeline-day"><span>{dayLabel(timestamp)}</span></div>}{content}</>;
			} };
		})}
		  computeItemKey={(_index, item) => item.id}
		  itemContent={(_index, item) => <div className="timeline-virtual-item">{item.render()}</div>}
		  startReached={handleStartReached}
		  atTopStateChange={handleAtTopChange}
		  atBottomStateChange={handleAtBottomChange}
		  followOutput={(atBottom) => atBottom ? 'auto' : false}
		/>
	  </TimelineVirtualList>
	  {messageListUnseen > 0 && <button type="button" className="timeline-jump-latest" onClick={() => {
		setMessageListUnseen(0);
		messageListRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' });
	  }}>↓ {messageListUnseen} 条新动态</button>}
    </section>
    {editNotice && <p className="agent-edit-error" role="alert">{editNotice}</p>}
    <WaitingLayer turns={queuedTurns} state={state} names={names} selfId={selfId} access={access} frozenByActor={frozenByActor} editing={editing} onCancel={onCancel} onControl={(turn, actorId, type, payload) => onTaskControl?.({ channelId: state.channelId, turn, actorId, type, payload })} onEdit={startEditing} onEditText={(text) => setEditing((current) => current && ({ ...current, text, error: '' }))} onEditSave={verifyAndSave} onEditAbandon={abandonEditing} />
  </ProgressTrailHost>;
}
