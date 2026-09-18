import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap, actorNameMap } from '../model/actor-display.js';
import { resolveFormSpec } from '../model/dynamic-form.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { attachmentFromFileReference } from '../model/file-references.js';
import { LIST_WINDOW_SIZE } from '../model/list-window.js';
import { messagePresentation } from '../model/message-presentation.js';
import { replyTargetOf } from '../model/reply-target.js';
import { READING_MODE } from '../model/reading-session.js';
import { systemEventPresentation } from '../model/system-event-presentation.js';
import { controlLabel, controlPayload, extraControls, taskControlContext } from '../model/task-controls.js';
import { agentFrozenStates, agentMessageStage, editAdmission, editableText, isAgentMessageTurn, lockFromContext, mergedInto, preemptedBy } from '../model/agent-control.js';
import { selectSystemNote } from '../model/agent-selection.js';
import { TIMELINE_SCOPE, TIMELINE_SCOPE_LABELS } from '../model/timeline-scope.js';
import { projectTimeline } from '../model/timeline-projection.js';
import { createConversationPresentation, createConversationRoleFinalizer } from '../model/conversation-presentation.js';
import { latestHumanProgress, turnProcessSummary, turnStatusLabel } from '../model/turn-presentation.js';
import { conversationTextObservations, finalEchoObservation, processCount, turnStartObservation, withoutFinalEcho } from '../model/turn-process.js';
import { argsOf } from '../protocol/envelope.js';
import { DECISIONS, TYPES } from '../protocol/vocab.js';
import { messageTimeLabel } from '../util/time.js';
import { newId } from '../util/id.js';
import { StructuredResult, terminalPresentation } from './StructuredResult.jsx';
import { MarkdownContent, MarkdownFileReferenceProvider } from './MarkdownContent.jsx';
import { TurnInlineDetail } from './context/TurnContext.jsx';
import { ContentFrame, MessageFrame } from './timeline/InformationFlow.jsx';
import { ProgressTrail, ProgressTrailHost } from './timeline/ProgressTrail.jsx';
import { createMessageLayoutStore, MessageLayoutProvider, useMessageLayoutState } from './timeline/MessageLayoutState.jsx';
import { FoldableBody } from './timeline/FoldableBody.jsx';
import { useReadingSession } from './timeline/useReadingSession.js';
import { ReadingContainerHandoff } from './timeline/ReadingContainerHandoff.jsx';
import { ConversationSurface } from './conversation/ConversationSurface.jsx';
import { ReadingIntentProvider } from './conversation/ReadingIntentContext.jsx';
import {
  acknowledgeLivePresentationArrivals,
  acknowledgeLiveTimelineArrivals,
  livePresentationArrivals,
  liveTimelineArrivals,
  registerLivePresentationArrivalConsumer,
  registerLiveTimelineArrivalConsumer,
} from '../model/fold.js';
import { selectLocalWaitingTurns, selectWaitingPresentation } from '../model/waiting-presentation.js';
import { diagnostic } from '../model/diagnostics.js';

// 平台叙事（成员进出、跨频道入站）暂时不进时间线。它和真正的往来平铺在同一条流里，
// 每次 agent 干活就刷出一串，把人要读的东西淹掉。数据仍然在 state.narration 里，
// 什么都没丢——等它有了合适的落位（侧栏或频道信息页）再接回来。
const SHOW_CHANNEL_NARRATION = false;
const EMPTY_FROZEN_STATES = new Map();
// 默认参数写成字面量等于每帧新建一个空容器，行的保留判据会被这份空壳直接废掉。
const EMPTY_CAPABILITY_INDEX = new Map();
const EMPTY_CONTROL_STATES = {};
// 行摘要是应用侧最大的一笔主线程自耗（回底 235ms / 快滚 147ms，见 after2 轨迹）：
// 窗口里每一行、每一次 itemContent 都要算一遍。所以这里不给通用序列化器留活——
// 字段先化成标量再拼；只有确实是对象的那几格才落到 JSON，而它们在绝大多数行上
// 都是空的。分隔符用正文里不会出现的控制符，自由文本（系统提示、编辑中的正文）
// 额外带上长度前缀，杜绝跨格拼接撞车。
const REVISION_SEP = '\u0001';

function revisionSlot(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function revisionText(value) {
  return value ? `${value.length}${REVISION_SEP}${value}` : '0';
}
const WAITING_HANDOFF_DURATION_MS = 180;
const WAITING_HANDOFF_LEDGER_LIMIT = 512;
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
          <StructuredResult requestType={request.type} payload={argsOf(turn.terminal)} renderText={(text) => <MarkdownContent contentKey={`terminal:${turn.terminal.id || turn.requestId}:body`} text={text} />} />
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

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setReduced(query.matches === true);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function useWaitingHandoff(channelId, queuedTurns, presentationRows) {
  const reducedMotion = useReducedMotionPreference();
  const previousRef = useRef({ channelId, turns: new Map() });
  const completedRef = useRef(new Map());
  const timersRef = useRef(new Map());
  const [settling, setSettling] = useState(() => new Map());
  const currentTurns = useMemo(
    () => new Map(queuedTurns.map((turn, order) => [turn.requestId, { turn, order }])),
    [queuedTurns],
  );
  const rowIDs = useMemo(
    () => new Set(presentationRows.map((row) => row.id)),
    [presentationRows],
  );
  const sameChannel = previousRef.current.channelId === channelId;
  const fresh = sameChannel ? [...previousRef.current.turns].flatMap(([requestId, entry]) => (
    !currentTurns.has(requestId)
    && rowIDs.has(requestId)
    && !completedRef.current.has(requestId)
      ? [[requestId, entry]]
      : []
  )) : [];
  let visibleHandoffs = settling;
  if (!sameChannel || reducedMotion) visibleHandoffs = new Map();
  else if (fresh.length) {
    visibleHandoffs = new Map(settling);
    for (const [requestId, entry] of fresh) visibleHandoffs.set(requestId, entry);
  }

  useLayoutEffect(() => {
    if (previousRef.current.channelId !== channelId) {
      for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
      timersRef.current.clear();
      completedRef.current.clear();
      previousRef.current = { channelId, turns: currentTurns };
      setSettling((current) => current.size ? new Map() : current);
      return;
    }
    previousRef.current = { channelId, turns: currentTurns };
    if (!fresh.length) return;
    for (const [requestId] of fresh) completedRef.current.set(requestId, true);
    while (completedRef.current.size > WAITING_HANDOFF_LEDGER_LIMIT) {
      completedRef.current.delete(completedRef.current.keys().next().value);
    }
    if (reducedMotion) return;
    setSettling((current) => {
      const next = new Map(current);
      for (const [requestId, entry] of fresh) next.set(requestId, entry);
      return next;
    });
    for (const [requestId] of fresh) {
      const timer = globalThis.setTimeout(() => {
        timersRef.current.delete(requestId);
        setSettling((current) => {
          if (!current.has(requestId)) return current;
          const next = new Map(current);
          next.delete(requestId);
          return next;
        });
      }, WAITING_HANDOFF_DURATION_MS);
      timersRef.current.set(requestId, timer);
    }
  }, [channelId, currentTurns, fresh, reducedMotion]);

  useLayoutEffect(() => {
    if (!reducedMotion || !settling.size) return;
    for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
    timersRef.current.clear();
    setSettling(new Map());
  }, [reducedMotion, settling.size]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
    timersRef.current.clear();
  }, [channelId]);

  const exiting = useMemo(
    () => [...visibleHandoffs].map(([requestId, entry]) => ({ requestId, ...entry })),
    [visibleHandoffs],
  );
  const enteringRequestIDs = useMemo(() => new Set(visibleHandoffs.keys()), [visibleHandoffs]);
  return { exiting, enteringRequestIDs };
}

function WaitingLayer({ turns, handoffs = [], state, names, selfId, access, targetAuthority, capabilityIndex, frozenByActor, editing, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon }) {
  const [bulk, setBulk] = useState({ actorId: '', error: '' });
  const [collapsed, setCollapsed] = useState(false);
  if (!turns.length && !handoffs.length) return null;
  const presented = [
    ...turns.map((turn, order) => ({ turn, order, exiting: false })),
    ...handoffs.map((entry) => ({ turn: entry.turn, order: entry.order, exiting: true })),
  ].sort((left, right) => left.order - right.order);
  const groups = [];
  const byActor = new Map();
  for (const item of presented) {
    const { turn } = item;
    const actorId = turn.request.audience?.[0] || '';
    if (!byActor.has(actorId)) {
      const group = { actorId, turns: [], items: [] };
      byActor.set(actorId, group);
      groups.push(group);
    }
    const group = byActor.get(actorId);
    group.items.push(item);
    if (!item.exiting) group.turns.push(turn);
  }

  async function cancelAll(group) {
    if (bulk.actorId) return;
    const cancellable = group.turns.filter((turn) => {
      const context = taskControlContext(turn, { selfId, access, targetAuthority });
      return context.targetControlsEligible && context.canCancel;
    });
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
          await onCancel?.(state.channelId, turn.requestId, taskControlContext(turn, { selfId, access, targetAuthority }).cancelsAsDismiss);
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
  const handoffOnly = turns.length === 0;
  return <div className={`agent-wait-dock${collapsed ? ' is-collapsed' : ''}${handoffOnly ? ' is-handoff-only' : ''}`}>
    <section className={`agent-wait-layer${collapsed ? ' is-collapsed' : ''}${hasQueuedEditor ? ' is-editing' : ''}${handoffOnly ? ' is-handoff-only' : ''}`} aria-label={handoffOnly ? undefined : '等待区'} aria-hidden={handoffOnly ? 'true' : undefined} inert={handoffOnly ? true : undefined}>
      {collapsed && <div className="agent-wait-collapsed"><span aria-hidden="true">↳</span><strong>{turns.length || handoffs.length} 条等待消息</strong>{!handoffOnly && <button type="button" aria-expanded="false" onClick={() => setCollapsed(false)}>展开</button>}</div>}
      {!collapsed && <header className="agent-wait-header" aria-label="等待区操作">
        {!handoffOnly && <div>
          {renderedGroups.map((group) => {
            const canInsertAll = group.turns.some((turn) => taskControlContext(turn, { selfId, access, targetAuthority }).canInsert);
            return canInsertAll && <button type="button" className="agent-wait-insert-all" key={`insert-${group.actorId}`} onClick={() => onControl(group.turns[0], group.actorId, TYPES.agentSteer, { all: true })}>{soleGroup ? '全部插入' : `插入 ${nameOf(group.actorId, names)} 全部`}</button>;
          })}
          {renderedGroups.map((group) => {
            const canCancelAll = group.turns.some((turn) => {
              const context = taskControlContext(turn, { selfId, access, targetAuthority });
              return context.targetControlsEligible && context.canCancel;
            });
            return canCancelAll && <button type="button" className="agent-wait-cancel-all" key={group.actorId} disabled={Boolean(bulk.actorId)} onClick={() => cancelAll(group)}>{bulk.actorId === group.actorId ? '正在取消…' : soleGroup ? '全部取消' : `取消 ${nameOf(group.actorId, names)} 全部`}</button>;
          })}
          <button type="button" onClick={() => setCollapsed(true)}>收起</button>
        </div>}
      </header>}
      {!collapsed && renderedGroups.map((group) => {
      const paused = frozenByActor.get(group.actorId)?.source === TYPES.agentHold;
      return <section className="agent-wait-group" key={group.actorId} data-agent-id={group.actorId}>
        {!hasQueuedEditor && !soleGroup && <header><strong>{nameOf(group.actorId, names)}{paused ? '（已暂停）' : ''}</strong></header>}
        <ol>{group.items.map(({ turn, exiting }) => {
          const context = taskControlContext(turn, { selfId, access, targetAuthority });
          const view = messagePresentation(turn.request);
          const session = editing?.targetId === turn.requestId ? editing : null;
          const localStateLabel = turn.waitingPresentation === 'stored-local'
            ? '已保存在本机'
            : turn.waitingPresentation === 'transmitting'
              ? '正在发送'
              : turn.waitingPresentation === 'confirming'
                ? '等待账本确认'
                : '';
          return <li key={turn.requestId} className={`agent-wait-item${session ? ' is-editing' : ''}${exiting ? ' is-handoff-exiting' : ''}`} data-request-id={turn.requestId} data-handoff-state={exiting ? 'exit' : undefined} aria-hidden={exiting ? 'true' : undefined} inert={exiting ? true : undefined}>
            {exiting
              ? <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div>
              : session
              ? <><div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div><span className="agent-wait-editing-label">正在编辑</span></>
              : <>
                <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div>
                <div className="agent-wait-actions">
                  {localStateLabel && <span className="agent-wait-local-state">{localStateLabel}</span>}
                  {paused && <span className="agent-wait-paused">已暂停</span>}
                  {context.steering && <span className="agent-wait-paused">正在并入…</span>}
                  {context.targetCurrentness === 'unknown' && <span className="agent-wait-paused">正在核验收件人</span>}
                  {context.targetCurrentness === 'departed' && <span className="agent-wait-paused">收件人已离席，等待账本关闭</span>}
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
  const [open, setOpen] = useMessageLayoutState(`thread-call:${item.turn.requestId}`, false);
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
        ? <div className="turn-thread-result"><StructuredResult requestType={child.request.type} payload={argsOf(child.terminal)} renderText={(text) => <MarkdownContent contentKey={`terminal:${child.terminal.id || child.requestId}:body`} text={text} />} /></div>
        : <p className="turn-thread-result empty">还没有终态。</p>)}
    </li>
  );
}

// 回合里被叫出来的那些调用。默认收起：读的人先看到"这一问的答案"，需要时才展开
// "为了答它做了什么"。展开后按深度缩进，孙代看得出是谁叫出来的。
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

// A text stage and a matching terminal answer are two protocol envelopes but
// one visible answer slot. Keeping this component and contentKey stable lets
// MarkdownContent preserve completed blocks, native selection, and expensive
// embedded renderers across the protocol hand-off. Structured/empty results
// retain StructuredResult's established presentation instead of pretending
// they are the same Markdown tree.
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
  const terminal = turn.terminal;
  const responseFoldId = `${turn.requestId}:response`;
  const stopped = argsOf(terminal)?.status === 'failed' && argsOf(terminal)?.error_code === 'interrupted';
  const resumable = stopped && frozen?.source === TYPES.agentInterrupt && (!frozen.target_id || frozen.target_id === turn.requestId);
  const liveEnvelope = latestTurnEnvelope(turn);
  const agentId = terminal?.sender?.id || liveEnvelope?.sender?.id || request.audience?.[0];
  const bubbleTs = terminal?.ts || liveEnvelope?.ts;
  const processStartedTs = turnStartedAt(turn);
  const terminalText = terminal && !stopped ? messagePresentation(terminal).text : '';
  const allConversationTexts = conversationTextObservations(turn);
  const echoObservation = terminal && !stopped ? finalEchoObservation(allConversationTexts, terminalText) : null;
  const conversationTexts = withoutFinalEcho(allConversationTexts, terminalText);
  const foldText = [...conversationTexts.map(({ process }) => process.text), terminalText].filter(Boolean).join('\n\n');
  const className = `agent-turn-bubble${terminal ? ' settled' : ' processing'}${compact ? ' compact' : ''}${hasThreadChildren ? ' has-thread-children' : ''}`;
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

function AgentConversationTurn({ turn, thread = [], leadTurns = [], mergedCount = 0, names, roster, selfId, access, targetAuthority, frozen, fold = null, editActive, editSession = null, onControl, onEdit, onDownload, onPreview, onReply, onCreateTask }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const requestText = requestView.text;
  const requestFoldId = `${turn.requestId}:request`;
  const controlContext = taskControlContext(turn, { selfId, access, targetAuthority });
  const lead = leadTurns.map((item) => messagePresentation(item.request).text);
  const processingTitle = [...lead, requestText].join(' ＋ ');
  const suppressAgentBubble = Boolean(turn.local || mergedInto(turn) || preemptedBy(turn));
  return <section className={`turn-card agent-conversation-turn self status-${turn.status}`} data-request-id={turn.requestId} data-request-type={request.type} tabIndex="0">
    <MessageFrame className="request-message" identity={<span className="actor-icon kind-human">H</span>}>
      <header><strong>{nameOf(request.sender?.id, names)}</strong><time>{timeLabel(request.ts)}</time></header>
      <div className="request-text"><FoldableBody id={requestFoldId} text={requestText} exempt={Boolean(fold?.latest)} expanded={fold?.overrides?.get(requestFoldId)} onToggle={fold?.onToggle}><MarkdownContent contentKey={`request:${request.id}:body`} text={requestText} /></FoldableBody></div>
      {editSession && <small className="message-editing-state">正在输入框中编辑</small>}
      <AttachmentCards attachments={argsOf(request).attachments} onDownload={onDownload} onPreview={onPreview} />
    </MessageFrame>
    {!turn.local && !turn.terminal && !editSession && <ContentFrame contained><ActiveTaskControls context={controlContext} editActive={editActive} onControl={onControl} onEdit={onEdit} /></ContentFrame>}
    {!suppressAgentBubble && <AgentBubble key={`${turn.requestId}:agent-answer`} turn={turn} title={processingTitle} mergedCount={mergedCount} frozen={frozen} names={names} roster={roster} selfId={selfId} fold={fold} onReply={onReply} onCreateTask={onCreateTask} hasThreadChildren={thread.some((item) => isAgentMessageTurn(item.turn) && item.turn.request?.sender?.kind === 'agent')} />}
    <AgentThreadMessages thread={thread} names={names} onDownload={onDownload} onPreview={onPreview} />
  </section>;
}

function TurnCard({ turn, thread = [], roster, names, selfId, access, targetAuthority, capability, controlState, continuation = false, detailsOpen = false, fold = null, editSession = null, editActive = false, queuePosition = 0, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon, onDownload, onPreview, onOpen, onCreateTask, onReply, onCloseDetail }) {
  const request = turn.request;
  const requestView = messagePresentation(request);
  const self = request.sender?.id === selfId;
  const controlContext = taskControlContext(turn, { selfId, access, targetAuthority });
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
          <div className="request-text"><FoldableBody id={requestFoldId} text={requestView.text} exempt={Boolean(fold?.latest)} expanded={fold?.overrides?.get(requestFoldId)} onToggle={fold?.onToggle}><MarkdownContent contentKey={`request:${request.id}:body`} text={requestView.text} /></FoldableBody>{requestView.detail && <p className="message-detail">{requestView.detail}</p>}</div>
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
      {!turn.local && !turn.terminal && !detailsOpen && <ContentFrame contained><ActiveTaskControls context={controlContext} editActive={editActive} onControl={onControl} onEdit={onEdit} /></ContentFrame>}
      {editSession && <ContentFrame contained><p className="message-editing-state">正在输入框中编辑</p></ContentFrame>}
      {turn.terminal && (
        <MessageFrame className={turn.status === 'failed' ? 'final-answer turn-response failed' : 'final-answer turn-response'} contentClassName="response-body" identity={<span className={`actor-icon kind-${turn.terminal.sender?.kind || 'agent'}`}>{(turn.terminal.sender?.kind || 'agent').slice(0, 1).toUpperCase()}</span>}>
          <header><strong>{nameOf(turn.terminal.sender?.id || request.audience?.[0], names)}</strong><small className="ai-label">AI</small><time>{timeLabel(turn.terminal.ts)}</time>{turn.status === 'failed' && <span className="response-failed">处理失败</span>}</header><div className="response-content"><FoldableBody id={responseFoldId} text={messagePresentation(turn.terminal).text} exempt={foldExempt} expanded={fold?.overrides?.get(responseFoldId)} onToggle={fold?.onToggle}><StructuredResult requestType={request.type} payload={argsOf(turn.terminal)} renderText={(text) => <MarkdownContent contentKey={`terminal:${turn.terminal.id || turn.requestId}:body`} text={text} />} /></FoldableBody></div>
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

function Standalone({ envelope, names, roster, selfId, continuation = false, fold = null, onCreateTask, onReply }) {
  const view = messagePresentation(envelope);
  const self = envelope.sender?.id === selfId;
  const replyTarget = replyTargetOf(envelope, { roster, selfId });
  const foldId = `${envelope.id}:message`;
  return (
    <ReplyableMessageFrame replyTarget={replyTarget} copyText={view.text} onReply={onReply} onCreateTask={onCreateTask} className={`standalone-row ${continuation ? 'continuation' : ''} ${self ? 'self' : ''}`} identity={continuation ? <time className="continuation-time" aria-label={`${nameOf(envelope.sender?.id, names)}，${timeLabel(envelope.ts)}`}>{timeLabel(envelope.ts)}</time> : <span className={`actor-icon kind-${envelope.sender?.kind}`}>{envelope.sender?.kind?.slice(0, 1).toUpperCase()}</span>}>
      {!continuation && <header><strong>{nameOf(envelope.sender?.id, names)}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{timeLabel(envelope.ts)}</time></header>}<FoldableBody id={foldId} text={view.text} exempt={Boolean(fold?.latest)} expanded={fold?.overrides?.get(foldId)} onToggle={fold?.onToggle}><MarkdownContent contentKey={`message:${envelope.id}:body`} text={view.text} /></FoldableBody>{view.detail && <p className="message-detail">{view.detail}</p>}
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

export function Timeline({ state, history = {}, composer = null, viewSessions, roster, waitingRosterAuthority = null, selfId, agentActivity, onAcknowledgeAgentActivity, pending, approvalStates, controlStates = EMPTY_CONTROL_STATES, capabilityIndex = EMPTY_CAPABILITY_INDEX, access = '', surfaceVisible = false, onTailCaughtUp, onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, turnDetail, onComposerEditChange, onFocusAgentChange }) {
  const initialViewSessionRef = useRef(null);
  if (!initialViewSessionRef.current) initialViewSessionRef.current = viewSessions?.read(state.channelId) || {};
  const messageLayoutStoreRef = useRef(null);
  if (!messageLayoutStoreRef.current) messageLayoutStoreRef.current = createMessageLayoutStore(
    initialViewSessionRef.current.layoutChoices,
    (layoutChoices) => viewSessions?.writeConversation(state.channelId, { layoutChoices }),
  );
  const presentationRef = useRef(null);
  if (!presentationRef.current) presentationRef.current = createConversationPresentation();
  const roleFinalizerRef = useRef(null);
  if (!roleFinalizerRef.current) roleFinalizerRef.current = createConversationRoleFinalizer();
  const [presentationCommitVersion, setPresentationCommitVersion] = useState(0);
  const requestedInitialScope = initialViewSessionRef.current.scope || TIMELINE_SCOPE.mine;
  // Scope is the reader's durable preference, not a derivative of whether the
  // current roster has resolved this browser's actor id yet. With no self id,
  // Mine temporarily projects the complete ledger (the only honest answer),
  // but it must remain Mine so identity arrival restores the requested view
  // and the temporary fallback is never persisted as an explicit All choice.
  const [scope, setScope] = useState(() => requestedInitialScope);
  const [knownSelfId, setKnownSelfId] = useState(() => selfId || '');
  // 选中的 agent。空集 = 不过滤（常态）。Timeline 按频道 key 挂载，所以切频道
  // 天然重置，恒不需要自己清。
  const [actorFilter, setActorFilter] = useState(() => new Set(initialViewSessionRef.current.actorFilter || []));
  // 读者手动展开 / 收起过的正文，按正文 id 记（true 展开、false 收起）。没记的按
  // 当前 Presentation 位置推导默认：tail/活跃行展开，历史长文折叠。默认从不写进
  // choices；只有读者点击产生 override，因而 append 可让未操作旧 tail 自然转为
  // 历史折叠，却不会推翻任何显式展开/收起。
  const [foldOverrides, setFoldOverrides] = useState(() => new Map(initialViewSessionRef.current.foldOverrides || []));
  const [editing, setEditing] = useState(null);
  const editSessionSerialRef = useRef(0);
  const editingRef = useRef(null);
  const editReleasePendingRef = useRef(new Set());
  const editReleaseAcceptedRef = useRef(new Set());
  const editReleaseInFlightRef = useRef(new Map());
  const editRuntimeRef = useRef(null);
  const editSessionOwnersRef = useRef(new Map());
  const rowActionsRef = useRef(null);
  const [editNotice, setEditNotice] = useState('');
  const [resumePin, setResumePin] = useState('');
  const [presentationNow, setPresentationNow] = useState(() => Date.now());
	const waitingContinuityRef = useRef({ channelId: '', ids: new Set() });
	const previousAccess = useRef(access);
	const openFileReference = useCallback((reference) => {
	  onPreviewResource?.(state.channelId, attachmentFromFileReference(reference));
	}, [onPreviewResource, state.channelId]);
  const names = useMemo(() => actorNameMap(roster), [roster]);
  useEffect(() => {
    if (selfId) setKnownSelfId(selfId);
  }, [selfId]);
  const projectionSelfId = selfId || knownSelfId;
  const identityPending = !projectionSelfId;
  const projectionScope = identityPending && scope === TIMELINE_SCOPE.mine
    ? TIMELINE_SCOPE.all
    : scope;
  // 正在编辑的消息钉在原地：协议上"处理中被编辑"的消息会被打断回队列（Resumed），
  // 但呈现上必须留在用户点下"编辑"的位置原地变可编辑——恒不在编辑中途瞬移。
  // 只钉"从处理中进入编辑"的：等待区消息的编辑本来就发生在等待区原地。
  // 保存/放弃后钉住不放（resumePin），直到账上真正回到处理中——否则解冻帧到达前
  // 的空窗里消息会闪跳进等待区。
  const editingTargetId = editing?.location === 'processing' ? editing.targetId : resumePin;
  const actorFilterApplies = projectionScope === TIMELINE_SCOPE.mine;
  // Scope and actor filters replace the visible conversation and therefore get
  // a fresh presentation/geometry identity. Editing only changes an existing
  // row and deliberately does not reset either identity.
  const messageListKey = `${state.channelId}:${scope}:${actorFilterApplies ? [...actorFilter].sort().join(',') : ''}`;
  const projectionVersion = state._timelineProjectionVersion ?? state.lastSeq;
  const contentVersion = state._timelineRevision ?? state.lastSeq;
  const controlVersion = state._timelineControlVersion ?? state.lastSeq;
  const historyViewSpec = useMemo(() => ({
    scope: projectionScope,
    selfId: projectionSelfId,
    actorFilter,
    editingTargetId,
    showNarration: SHOW_CHANNEL_NARRATION,
    incremental: true,
  }), [actorFilter, editingTargetId, projectionScope, projectionSelfId]);
  const localWaitingTurns = useMemo(
    () => selectLocalWaitingTurns(pending || [], projectionSelfId),
    [pending, projectionSelfId],
  );
  const localWaitingIDs = useMemo(
    () => new Set(localWaitingTurns.map((turn) => turn.requestId)),
    [localWaitingTurns],
  );
  const timelineLocalEchoes = useMemo(
    () => (pending || []).filter((submission) => !localWaitingIDs.has(submission.messageId)),
    [localWaitingIDs, pending],
  );
  const projection = useMemo(() => {
    const admission = history.status?.presentationAdmission;
    let admissionCandidate = null;
    let presentationCandidate = null;
    const presentation = presentationRef.current;
    // projectTimeline remains a pure projection during React render. Capture
    // its admission decision locally; the layout effect below is the sole
    // authority that may publish that candidate after React commits it.
    const renderAdmission = admission?.evaluate ? {
      admit(channelID, items, meta) {
        admissionCandidate = admission.evaluate(channelID, items, meta);
        return admissionCandidate.items;
      },
      sourceFence(channelID) {
        return admission.sourceFence?.(channelID);
      },
    } : admission;
    const renderPresentation = presentation.evaluate ? {
      project(items, meta) {
        presentationCandidate = presentation.evaluate(items, meta);
        return presentationCandidate.snapshot;
      },
    } : presentation;
    return {
      ...projectTimeline(state, {
        ...historyViewSpec,
        presentation: renderPresentation,
        presentationKey: messageListKey,
        dataEpoch: `${state.channelId}:${history.status?.generation || 0}`,
        localEchoes: timelineLocalEchoes,
        presentationAdmission: renderAdmission,
      }),
      admissionCandidate,
      presentationCandidate,
    };
  }, [
    state, projectionVersion, contentVersion, historyViewSpec, messageListKey,
    history.status?.generation, history.status?.presentationAdmission,
    history.status?.presentationAdmissionState?.phase,
    presentationCommitVersion, timelineLocalEchoes,
  ]);
  useLayoutEffect(() => {
    if (!projection.presentationCandidate) return;
    const committed = presentationRef.current.commitCandidate(projection.presentationCandidate);
    if (!committed && presentationRef.current.current() !== projection.presentation) {
      setPresentationCommitVersion((value) => value + 1);
    }
  }, [projection.presentationCandidate]);
  useLayoutEffect(() => {
    if (!projection.admissionCandidate) return;
    history.status?.presentationAdmission?.commitCandidate?.(
      state.channelId,
      projection.admissionCandidate,
    );
  }, [
    history.status?.presentationAdmission,
    projection.admissionCandidate,
    state.channelId,
  ]);
  useLayoutEffect(() => {
    history.status?.presentationAdmission?.reconcileCurrent?.(state.channelId, {
      viewID: messageListKey,
      epoch: `${state.channelId}:${history.status?.generation || 0}`,
    });
  }, [
    history.status?.generation,
    history.status?.presentationAdmission,
    messageListKey,
    state.channelId,
  ]);
  useEffect(() => () => {
    history.status?.presentationAdmission?.reset?.(state.channelId);
  }, [history.status?.presentationAdmission, state.channelId]);
  useLayoutEffect(() => {
    if (history.status?.presentationAdmissionState?.phase !== 'pending-baseline-commit') return;
    history.status?.presentationAdmission?.prepareCommit?.(
      state.channelId,
      projection.presentation,
    );
  }, [
    history.status?.presentationAdmission,
    history.status?.presentationAdmissionState?.phase,
    projection.presentation,
    state.channelId,
  ]);
  const historyReveal = history.status?.presentationAdmissionState?.phase === 'committed-awaiting-layout'
    ? history.status.presentationAdmissionState.committed
    : null;
  // 名册里的 agent 才进过滤条：人和工具恒不是"我在跟谁说话"的那个谁。
  const filterableAgents = useMemo(() => (roster || []).filter((row) => row.kind === 'agent'), [roster]);
  const currentFilterActorIDs = useMemo(() => new Set(filterableAgents.map((row) => row.id)), [filterableAgents]);
  const staleActorFilters = useMemo(
    () => [...actorFilter].filter((actorID) => !currentFilterActorIDs.has(actorID)).sort(),
    [actorFilter, currentFilterActorIDs],
  );
  // 过滤条恰好只选中一个 agent 时，屏幕上就只剩「我和他」的往来。此时 composer
  // 的默认收件人恒该是他——否则人照着屏幕打字，消息发去了另一个 agent。多选或
  // 空集恒不构成"一个目标"，报空让判据链继续往下走。
  const focusAgentId = useMemo(() => {
    if (!actorFilterApplies || actorFilter.size !== 1) return '';
    const [only] = [...actorFilter];
    return filterableAgents.some((row) => row.id === only) ? only : '';
  }, [actorFilterApplies, actorFilter, filterableAgents]);
  useEffect(() => { onFocusAgentChange?.(focusAgentId); }, [focusAgentId, onFocusAgentChange]);
  // Scope/filter identity still owns its own Presentation and ReadingSession,
  // but a non-empty local projection does not need a new physical scroller.
  // Keeping the same Legend DOM lets an installed matching row replace the
  // prior view in the filter commit instead of exposing a blank virtualizer
  // mount while the new semantic activation is already selected.
  const messageListRenderKey = state.channelId;
  const liveArrivalConsumerTokenRef = useRef(null);
  if (!liveArrivalConsumerTokenRef.current) {
    liveArrivalConsumerTokenRef.current = Symbol('timeline-live-arrival-consumer');
  }
  useLayoutEffect(
    () => registerLiveTimelineArrivalConsumer(state, liveArrivalConsumerTokenRef.current),
    [state],
  );
  const livePresentationConsumerTokenRef = useRef(null);
  if (!livePresentationConsumerTokenRef.current) {
    livePresentationConsumerTokenRef.current = Symbol('timeline-live-presentation-consumer');
  }
  useLayoutEffect(() => {
    let release = null;
    const reconcile = () => {
      const eligible = surfaceVisible === true
        && globalThis.document?.visibilityState !== 'hidden';
      if (eligible && !release) {
        release = registerLivePresentationArrivalConsumer(
          state,
          livePresentationConsumerTokenRef.current,
        );
      } else if (!eligible && release) {
        release();
        release = null;
      } else if (!eligible) {
        // A hidden/inactive Timeline is not guaranteed another React commit.
        // Clear its ephemeral visual baseline synchronously instead of letting
        // those rows impersonate fresh arrivals when the surface returns.
        acknowledgeLivePresentationArrivals(state, state._livePresentationArrivalRevision);
      }
    };
    reconcile();
    globalThis.document?.addEventListener?.('visibilitychange', reconcile);
    return () => {
      globalThis.document?.removeEventListener?.('visibilitychange', reconcile);
      release?.();
    };
  }, [messageListKey, state, surfaceVisible]);
  const livePresentationArrivalSnapshot = livePresentationArrivals(
    state,
    Number(projection.presentation?.sourceRevision || 0),
  );
  // foldOverrides 已经是不可变替换的 Map（toggleFold 用 new Map(current).set），
  // 没有任何一处改写它。再复制一份既是每帧一次白白的分配，也让行拿到的
  // overrides 身份每帧都变——那恰好废掉行子树的保留判据。
  const effectiveFoldOverrides = foldOverrides;
	const viewport = useReadingSession({
	  channelID: state.channelId,
	  viewKey: messageListKey,
	  snapshot: projection.presentation,
	  history: {
	    ...history,
	    status: { ...history.status, historyReveal },
	  },
	  viewSessions,
	  historyViewSpec,
	  surfaceVisible,
	  arrivals: {
	    ...liveTimelineArrivals(state),
	    acknowledge(revision) {
	      acknowledgeLiveTimelineArrivals(state, revision);
	    },
	  },
	});
  // 通知兜底的唯一上报口：把"活动频道此刻已追平"这条只读读数交给 App，频道栏
  // 徽标据此在派生层压成 0。这里不改任何未读真相，也不接收任何回调。
  useLayoutEffect(() => {
    if (typeof onTailCaughtUp !== 'function') return undefined;
    onTailCaughtUp(viewport.tailCaughtUp);
    return () => onTailCaughtUp({ ...viewport.tailCaughtUp, caughtUp: false });
  }, [onTailCaughtUp, viewport.tailCaughtUp]);
  useLayoutEffect(() => {
    if (!historyReveal?.commitID) return;
    const bound = history.status?.presentationAdmission?.bindPresentation?.(
      state.channelId,
      Number(projection.presentation?.revision || 0),
    );
    if (!bound?.commitID) return;
    const changes = projection.presentation?.changes || {};
    const inserted = changes.frontInsertedIDs || [];
    const staged = bound.stagedIDs || [];
    const exactIDs = inserted.length === staged.length
      && inserted.every((id, index) => id === staged[index]);
    const exactRevision = Number(projection.presentation?.revision || 0)
      === Number(bound.candidatePresentationRevision || 0);
    const pureStructuralCommit = changes.kind === 'prepend'
      && (changes.backInsertedIDs || []).length === 0
      && (changes.removed || []).length === 0
      && (changes.updated || []).length === 0;
    const exactOwner = viewport.activationID === bound.activationID
      && viewport.session.inputEpoch === bound.inputEpoch;
    diagnostic('debug', 'history.admission_commit_check', {
      channelId: state.channelId,
      operationID: bound.operationID,
      exactIDs,
      exactRevision,
      exactOwner,
      pureStructuralCommit,
      presentationRevision: projection.presentation?.revision || 0,
      candidatePresentationRevision: bound.candidatePresentationRevision || 0,
      inserted,
      staged,
      backInsertedIDs: changes.backInsertedIDs || [],
      updated: changes.updated || [],
      removed: changes.removed || [],
      ownerInputEpoch: viewport.session.inputEpoch,
      tokenInputEpoch: bound.inputEpoch,
    });
    if (!exactIDs || !exactRevision || !exactOwner || !pureStructuralCommit) return;
    diagnostic('debug', 'history.admission_commit', {
      channelId: state.channelId,
      operationID: bound.operationID,
      activationID: bound.activationID,
      inputEpoch: bound.inputEpoch,
      presentationRevision: projection.presentation.revision,
      stagedIDs: staged,
    });
    history.status?.presentationAdmission?.acknowledge?.(state.channelId, bound.commitID);
  }, [
    history.status?.presentationAdmission,
    historyReveal,
    projection.presentation?.changes,
    projection.presentation?.revision,
    state.channelId,
    viewport.activationID,
    viewport.session.inputEpoch,
  ]);
  const roleCandidate = useMemo(
    () => roleFinalizerRef.current.evaluate(projection.presentation, viewport.presentationAuthority),
    [projection.presentation, viewport.presentationAuthority],
  );
	const rolePresentation = roleCandidate.snapshot;
  useLayoutEffect(() => {
    // Role authority is subordinate to the exact committed Presentation. If
    // an older concurrent candidate lost that owner race, neither owner may
    // publish it; synchronously recompute from the winner before paint.
    const presentationCurrent = presentationRef.current.current() === projection.presentation;
    const committed = presentationCurrent
      && roleFinalizerRef.current.commitCandidate(roleCandidate);
    if (!presentationCurrent
      || (!committed && roleFinalizerRef.current.current() !== rolePresentation)) {
      setPresentationCommitVersion((value) => value + 1);
    }
  }, [projection.presentation, roleCandidate, rolePresentation]);
	useLayoutEffect(() => {
	  // Visual provenance is one-commit evidence, not a backlog. Consume every
	  // live batch after its exact Presentation candidate commits, including a
	  // batch filtered out of this view, rendered while hidden, or observed in
	  // browsing mode. None of those may replay on a later presentation choice.
	  if (presentationRef.current.current() !== projection.presentation) return;
	  acknowledgeLivePresentationArrivals(state, livePresentationArrivalSnapshot.revision);
	}, [
	  livePresentationArrivalSnapshot.revision,
	  projection.presentation,
	  state,
	]);
	const withNarration = rolePresentation.rows;
  // 展开/收起只提交 Presentation choice。它不表示读者离开尾部，也不创建
  // navigation epoch；following 与 browsing 都继续使用动作前的容器。
  const toggleFold = useCallback((id, expanded) => {
    setFoldOverrides((current) => new Map(current).set(id, expanded));
  }, []);
  const timelineControl = useMemo(() => {
    const actorIds = new Set();
    const preempted = new Map();
    const merged = new Map();
    let hasFreezeOperations = false;
    for (const turn of state.turns.values()) {
      const actorId = turn.request?.audience?.length === 1 ? turn.request.audience[0] : '';
      if (actorId) actorIds.add(actorId);
      const replacement = preemptedBy(turn);
      if (replacement) preempted.set(replacement, [...(preempted.get(replacement) || []), turn]);
      const owner = mergedInto(turn);
      if (owner) merged.set(owner, (merged.get(owner) || 0) + 1);
      if (argsOf(turn.terminal)?.status === 'completed'
        && (turn.request?.type === TYPES.agentHold || turn.request?.type === TYPES.agentInterrupt)) {
        hasFreezeOperations = true;
      }
    }
    return { actorIds, preempted, merged, hasFreezeOperations };
  }, [state, controlVersion]);
  const schedulerStatus = history.status || null;
  // Replica is the sole folded-state authority for Waiting. Cached rows may
  // paint immediately, but absence of a terminal is operationally meaningful
  // only after the attached tail is current.
  const controlCurrent = schedulerStatus ? schedulerStatus.controlCurrent === true : true;
  const continuityIDs = waitingContinuityRef.current.channelId === state.channelId
    ? waitingContinuityRef.current.ids
    : new Set();
  const queuedTurns = useMemo(() => selectWaitingPresentation(state, {
    controlCurrent,
    editingTargetId,
    localTurns: localWaitingTurns,
    continuityIDs,
  }), [continuityIDs, controlCurrent, controlVersion, editingTargetId, localWaitingTurns, state]);
  useLayoutEffect(() => {
    const next = new Set(localWaitingIDs);
    for (const requestId of continuityIDs) {
      const turn = state.turns.get(requestId);
      if (turn && !turn.terminal && agentMessageStage(turn) === '') next.add(requestId);
    }
    waitingContinuityRef.current = { channelId: state.channelId, ids: next };
  }, [continuityIDs, controlVersion, localWaitingIDs, state]);
  const waitingHandoff = useWaitingHandoff(state.channelId, queuedTurns, rolePresentation.rows);
  const rowPresentationState = useCallback(
    (row) => waitingHandoff.enteringRequestIDs.has(row.id) ? 'handoff-enter' : '',
    [waitingHandoff.enteringRequestIDs],
  );
  const bottomIntentPresentation = useMemo(() => {
    const intent = viewport.session.bottomIntent;
    const messageIDs = intent?.targetMessageIDs || [];
    if (!intent?.id || !messageIDs.length) return null;
    const destinations = messageIDs.map((messageID) => {
      // A durable local agent request already owns the Waiting destination.
      // Do not wait for its ledger request/progress pair to round-trip before
      // satisfying the send-start correlation; that later replacement keeps
      // the same id and must not create a second bottom obligation.
      if (queuedTurns.some((item) => item.requestId === messageID)) {
        return { messageID, destination: 'waiting' };
      }
      const turn = state.turns.get(messageID);
      if (turn && isAgentMessageTurn(turn)) {
        const stage = agentMessageStage(turn);
        if (stage === 'timeline' && projection.presentation.rows.some((row) => (
          row.id === messageID && !row.localState && row.body?.local !== true
        ))) return {
          messageID,
          destination: 'timeline',
          targetListRevision: Number(projection.presentation.revision || 0),
        };
        return null;
      }
      const row = projection.presentation.rows.find((candidate) => candidate.id === messageID);
      return row && !row.localState && row.body?.local !== true
        ? {
          messageID,
          destination: 'timeline',
          targetListRevision: Number(projection.presentation.revision || 0),
        }
        : null;
    });
    return Object.freeze({
      intentID: intent.id,
      activationID: viewport.activationID,
      inputEpoch: viewport.session.inputEpoch,
      presentationRevision: Number(projection.presentation.revision || 0),
      ready: destinations.every(Boolean),
      destinations: Object.freeze(destinations.filter(Boolean)),
    });
  }, [projection.presentation, queuedTurns, state, viewport.activationID, viewport.session]);
  const presentationEmpty = !withNarration.length && !queuedTurns.length;
  const frozenByActor = useMemo(
    () => timelineControl.hasFreezeOperations
      ? agentFrozenStates(state, timelineControl.actorIds, presentationNow)
      : EMPTY_FROZEN_STATES,
    [state, controlVersion, timelineControl.actorIds, timelineControl.hasFreezeOperations, presentationNow],
  );
  // Editing callbacks and frozen-state evidence form one commit-owned port.
  // Its consumers are user events, passive cleanup and Promise continuations,
  // all of which run after the whole layout phase. A suspended render cannot
  // publish it, and a session keeps the runtime that acquired its hold rather
  // than inheriting a later callback merely because the parent rerendered.
  useLayoutEffect(() => {
    const runtime = Object.freeze({
      channelId: state.channelId,
      state,
      frozenByActor,
      capabilityIndex,
      onTaskControl,
    });
    editingRef.current = editing;
    editRuntimeRef.current = runtime;
    if (editing?.sessionId
      && editing.channelId === state.channelId
      && !editSessionOwnersRef.current.has(editing.sessionId)) {
      editSessionOwnersRef.current.set(editing.sessionId, runtime);
    }
  }, [capabilityIndex, editing, frozenByActor, onTaskControl, state]);

  function editSessionRuntimes(session) {
    const current = editRuntimeRef.current;
    const owner = editSessionOwnersRef.current.get(session?.sessionId)
      || (current?.channelId === session?.channelId ? current : null);
    const authority = current?.channelId === session?.channelId ? current : owner;
    return { owner, authority };
  }

  function releaseEditSession(session, targetTurn = null, ownerRuntime = null) {
    if (!session) return Promise.resolve(false);
    if (editReleaseAcceptedRef.current.has(session.sessionId)) return Promise.resolve(true);
    const inFlight = editReleaseInFlightRef.current.get(session.sessionId);
    if (inFlight) return inFlight;
    if (!session.holdId) {
      editReleasePendingRef.current.add(session.sessionId);
      return Promise.resolve(false);
    }
    editReleasePendingRef.current.delete(session.sessionId);
    const resolved = editSessionRuntimes(session);
    const runtime = ownerRuntime || resolved.owner;
    // The callback belongs to the runtime that acquired the hold, but a later
    // committed render of the same channel carries the newest revocation fact.
    // A different channel must never authorize or route this release.
    const authorityRuntime = resolved.authority || runtime;
    const observed = authorityRuntime?.frozenByActor?.get(session.actorId);
    // Against an older backend that has not advertised lease CAS yet, this
    // front-side guard still avoids an observed newer interrupt/hold. With a
    // new backend, expected_hold_id closes the remaining wire race.
    if (!runtime) return Promise.reject(new Error('编辑锁释放 owner 已失效'));
    if (observed && (observed.source !== TYPES.agentHold || observed.held_by !== session.holdId)) {
      // A newer ledger control already superseded this lease. There is no hold
      // left for this session to release, and no unhold request is fabricated.
      editSessionOwnersRef.current.delete(session.sessionId);
      return Promise.resolve(true);
    }
    const turn = authorityRuntime?.state?.turns?.get(session.targetId) || targetTurn;
    const release = Promise.resolve(runtime?.onTaskControl?.({
      channelId: session.channelId,
      turn,
      actorId: session.actorId,
      type: TYPES.agentUnhold,
      messageId: session.releaseMessageId,
      payload: withExpectedHold(authorityRuntime?.capabilityIndex || new Map(), session.actorId, TYPES.agentUnhold, {}, session.holdId),
    })).then((releaseId) => {
      if (!releaseId) throw new Error('解除编辑锁请求未进入发送队列');
      // handleTaskControl resolves only after the immutable unhold frame has a
      // durable outbox id. Ledger terminal remains the only fact that the hold
      // was actually released; this set only deduplicates local submission.
      editReleaseAcceptedRef.current.add(session.sessionId);
      editSessionOwnersRef.current.delete(session.sessionId);
      return true;
    }).finally(() => {
      if (editReleaseInFlightRef.current.get(session.sessionId) === release) {
        editReleaseInFlightRef.current.delete(session.sessionId);
      }
    });
    editReleaseInFlightRef.current.set(session.sessionId, release);
    return release;
  }
  useEffect(() => {
    const liveSessionId = editing?.sessionId;
    for (const sessionId of editReleaseAcceptedRef.current) {
      if (sessionId !== liveSessionId) editReleaseAcceptedRef.current.delete(sessionId);
    }
  }, [editing?.sessionId]);
  const nextFreezeDeadline = Math.min(...[...frozenByActor.values()].filter(Boolean).map((value) => value.until));
	const preemptedSources = timelineControl.preempted;
	const mergedCounts = timelineControl.merged;
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
  // 这几格对每一行都是同一个值，却被每行拼一遍。先拼成一段，行摘要直接用。
  const sharedRowRevision = useMemo(
    () => `${namesRevision}${REVISION_SEP}${access}${REVISION_SEP}${selfId}${REVISION_SEP}${hasCreateTask ? 1 : 0}${REVISION_SEP}${hasReply ? 1 : 0}`,
    [access, hasCreateTask, hasReply, namesRevision, selfId],
  );
  // 审批态与控制态在常态下是空对象。先问一次有没有，省掉每行一次键拼接与查表。
  const hasApprovalStates = useMemo(() => Boolean(approvalStates) && Object.keys(approvalStates).length > 0, [approvalStates]);
  const hasControlStates = useMemo(() => Boolean(controlStates) && Object.keys(controlStates).length > 0, [controlStates]);
  // capability 摘要只随 capabilityIndex 变，却被每一行、每一次装入各算一遍：同样
  // 一次 keys().sort().join()，一屏三十行就做三十遍。按 actor 归约一次，行摘要直接
  // 取。新鲜度与原来完全相同——原来的闭包也只在 capabilityIndex 换身份时才更新。
  const capabilityRevisions = useMemo(() => {
    const rows = new Map();
    for (const [actorId, capability] of capabilityIndex) {
      rows.set(actorId, `${[...(capability?.describe?.types?.keys?.() || [])].sort().join(',')}|${capability?.loading === true}|${capability?.error || ''}`);
    }
    return rows;
  }, [capabilityIndex]);
  // A live publish must not invalidate every materialized row. Each row gets a
  // compact revision made only from the local UI facts it actually consumes;
  // unchanged rows retain their mounted subtree, intrinsic measurements and
  // nested disclosure state while another request streams or arrives.
  const rowRenderRevision = useCallback((_index, row) => {
    const entry = row.body;
    const isLatest = row.role?.latest === true ? 1 : 0;
    if (entry?.kind === 'turn') {
      const requestId = entry.turn.requestId;
      const actorId = entry.turn.request.audience?.[0] || '';
      const targetCurrentness = waitingRosterAuthority?.current === true
        && waitingRosterAuthority.actorIDs instanceof Set
        ? (waitingRosterAuthority.actorIDs.has(actorId) ? 'current' : 'departed')
        : 'unknown';
      const selectNote = entry.turn.request.type === TYPES.agentSelect
        ? selectSystemNote({
          usage: argsOf(entry.turn.terminal)?.usage,
          describe: capabilityIndex.get(actorId)?.describe,
          agentName: nameOf(actorId, names),
        })
        : '';
      // 这一条恒不能预先归约：lastSeq 随进度帧原地增长，而 preemptedSources 的
      // 身份只随控制事实变。提前算一次就等于把行钉在旧的进度上。
      const preemptedTurns = preemptedSources.get(requestId);
      let preempted = '';
      if (preemptedTurns) {
        for (const turn of preemptedTurns) preempted += `${turn.requestId}:${turn.lastSeq || turn.requestSeq || 0},`;
      }
      // 审批态、控制态、冻结态是这张摘要里仅有的三格对象，而且在绝大多数行上
      // 都不存在：空就整格跳过，恒不进序列化器。
      const approval = hasApprovalStates ? approvalStates[entry.turn.request.id] : undefined;
      const controlState = hasControlStates ? controlStates[`${state.channelId}:${requestId}:cancel`] : undefined;
      const frozen = frozenByActor.get(actorId);
      const edit = editing
        ? (editing.targetId === requestId
          ? `2${REVISION_SEP}${editing.phase}${REVISION_SEP}${editing.location}${REVISION_SEP}${revisionText(editing.text)}`
          : '1')
        : '0';
      return `${sharedRowRevision}${REVISION_SEP}${row.contentRevision}${REVISION_SEP}${targetCurrentness}${REVISION_SEP}${isLatest}`
        + `${REVISION_SEP}${effectiveFoldOverrides.get(`${requestId}:request`)}${REVISION_SEP}${effectiveFoldOverrides.get(`${requestId}:response`)}`
        + `${REVISION_SEP}${turnDetail?.selected?.requestId === requestId}${REVISION_SEP}${resumePin === requestId}`
        + `${REVISION_SEP}${capabilityRevisions.get(actorId) || ''}${REVISION_SEP}${mergedCounts.get(requestId) || 0}${REVISION_SEP}${preempted}`
        + `${REVISION_SEP}${revisionSlot(approval)}${REVISION_SEP}${revisionSlot(controlState)}${REVISION_SEP}${revisionSlot(frozen)}`
        + `${REVISION_SEP}${revisionText(selectNote)}${REVISION_SEP}${edit}`;
    }
    if (entry?.kind === 'standalone') {
      return `${sharedRowRevision}${REVISION_SEP}${row.contentRevision}${REVISION_SEP}${isLatest}`
        + `${REVISION_SEP}${effectiveFoldOverrides.get(`${entry.envelope.id}:message`)}`;
    }
    return `${sharedRowRevision}${REVISION_SEP}${row.contentRevision}${REVISION_SEP}${isLatest}`;
  }, [
    approvalStates, capabilityIndex, capabilityRevisions, controlStates, editing,
    effectiveFoldOverrides, frozenByActor, hasApprovalStates, hasControlStates,
    mergedCounts, names, preemptedSources, resumePin, sharedRowRevision,
    state.channelId, targetAuthorityRevision, turnDetail?.selected?.requestId,
  ]);

  // 行子树在 revision 不变的重渲染里被原样留住，所以一行恒不能捏着造它那一帧的
  // 回调不放。所有命令式动作都经这个 commit 阶段发布的端口发出：它只转存已经存在
  // 的回调与 Replica 引用，不持有任何事实的副本，读取只发生在用户事件里——与本文件
  // 上面那个编辑端口同一条纪律。对 turn 它回 Replica 现取，比闭包里捕获的那份更新。
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
    editText(text) { setEditing((current) => current && ({ ...current, text, error: '' })); },
    openTurnDetails(turn, detailsOpen) {
      if (detailsOpen) rowActionsRef.current?.closeTurnDetail?.();
      else {
        // Details are a local presentation choice, not a reading-position
        // command. Native displacement remains the sole browsing takeover.
        rowActionsRef.current?.onOpenTurn?.(turn);
      }
    },
    closeTurnDetails() {
      rowActionsRef.current?.closeTurnDetail?.();
    },
  }), []);
  // 缺席的回调必须继续缺席：行靠它是不是 null 决定要不要给出这个入口，
  // rowRenderRevision 也只记它的有无。
  const rowReply = useMemo(() => hasReply ? ((...args) => rowActions.reply(...args)) : null, [hasReply, rowActions]);
  // renderRow 与 rowRenderRevision 同寿：依赖表就是上面那份摘要覆盖的同一批事实。
  // 命令式回调一律不进这张表——它们经端口现取，所以 App 重建一批箭头函数恒不会
  // 让已经装入的行整棵重建。
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
      const detailsOpen = rowSelectedTurnID === entry.turn.requestId;
      const fold = { latest: row.role?.latest === true, overrides: effectiveFoldOverrides, onToggle: toggleFold };
      const common = { turn: entry.turn, names, roster, selfId, access, targetAuthority: waitingRosterAuthority, capability: capabilityIndex.get(actorId), frozen: frozenByActor.get(actorId), fold, editActive: Boolean(editing && editing.targetId !== entry.turn.requestId), editSession: editing?.targetId === entry.turn.requestId ? editing : null, onControl: (type, payload) => rowActions.control(entry.turn, actorId, type, payload), onEdit: () => rowActions.startEditing(entry.turn, actorId), onEditText: rowActions.editText, onEditSave: rowActions.saveEdit, onEditAbandon: rowActions.abandonEdit, onDownload: rowActions.download, onPreview: rowActions.preview, onCreateTask: hasCreateTask ? () => rowActions.createTask(source) : null, onReply: rowReply };
      if (isAgentMessageTurn(entry.turn)) {
        content = <div className="timeline-entry" data-entry-id={entry.turn.requestId}><AgentConversationTurn {...common} thread={entry.thread} leadTurns={preemptedSources.get(entry.turn.requestId) || []} mergedCount={mergedCounts.get(entry.turn.requestId) || 0} /></div>;
      } else content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.turn.requestId}><TurnCard turn={entry.turn} thread={entry.thread} roster={roster} names={names} selfId={selfId} access={access} targetAuthority={waitingRosterAuthority} capability={capabilityIndex.get(actorId)} controlState={controlStates[controlKey]} continuation={continuation} detailsOpen={detailsOpen} fold={fold} editSession={editing?.targetId === entry.turn.requestId ? editing : null} editActive={Boolean(editing && editing.targetId !== entry.turn.requestId)} onCancel={() => rowActions.cancel(entry.turn.requestId)} onControl={(type, payload) => rowActions.control(entry.turn, actorId, type, payload)} onEdit={() => rowActions.startEditing(entry.turn, actorId)} onEditText={rowActions.editText} onEditSave={rowActions.saveEdit} onEditAbandon={rowActions.abandonEdit} onDownload={rowActions.download} onPreview={rowActions.preview} onReply={rowReply} onOpen={() => rowActions.openTurnDetails(entry.turn, detailsOpen)} onCloseDetail={rowActions.closeTurnDetails} onCreateTask={hasCreateTask ? () => rowActions.createTask(source) : null} /></div>;
    }
    if (!content) {
      const source = { view: 'dynamic', objectType: 'message', objectId: entry.envelope.id, seq: entry.seq };
      content = <div className="timeline-entry" data-continuation={continuation || undefined} data-entry-id={entry.envelope.id}><Standalone envelope={entry.envelope} names={names} roster={roster} selfId={selfId} continuation={continuation} fold={{ latest: row.role?.latest === true, overrides: effectiveFoldOverrides, onToggle: toggleFold }} onCreateTask={hasCreateTask ? () => rowActions.createTask(source) : null} onReply={rowReply} /></div>;
    }
    return <div className="timeline-virtual-item">{content}{boundaryAfterTimestamp > 0 && <div className="timeline-day"><span>{dayLabel(boundaryAfterTimestamp)}</span></div>}</div>;
  }, [
    access, approvalStates, capabilityIndex, controlStates, editing,
    effectiveFoldOverrides, frozenByActor, hasCreateTask, mergedCounts, names,
    preemptedSources, roster, rowActions, rowReply, rowSelectedTurnID, selfId,
    state, toggleFold, waitingRosterAuthority,
  ]);

  useEffect(() => {
    viewSessions?.writeConversation(state.channelId, {
      scope,
      actorFilter: [...actorFilter],
      foldOverrides: [...foldOverrides],
      foldDefaults: [],
    });
  }, [viewSessions, state.channelId, scope, actorFilter, foldOverrides]);
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
      if (actorGone) {
        editSessionOwnersRef.current.delete(session.sessionId);
      }
      else void releaseEditSession(session, targetTurn).catch((error) => {
        diagnostic('warn', 'timeline.edit_release_failed', {
          channelId: session.channelId,
          targetId: session.targetId,
          holdId: session.holdId,
          error,
        });
      });
      return;
    }
    if (editing.phase === 'locking') {
      const admission = editAdmission(state, editing);
      if (admission.error) {
        editSessionOwnersRef.current.delete(activeEditSessionId);
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
      const runtime = editSessionRuntimes(editing);
      const replacementPayload = withExpectedHold(runtime.authority?.capabilityIndex || new Map(), editing.actorId, TYPES.agentReplace, { target: editing.targetId, old_text: editing.oldText, new_text: editing.text, ...(editing.attachments.length ? { attachments: editing.attachments } : {}) }, editing.holdId);
      Promise.resolve(runtime.owner?.onTaskControl?.({ channelId: editing.channelId, turn: runtime.authority?.state?.turns?.get(editing.targetId) || targetTurn, actorId: editing.actorId, type: TYPES.agentReplace, payload: replacementPayload }))
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
    const runtime = editSessionRuntimes(editing);
    const targetTurn = runtime.authority?.state?.turns?.get(editing.targetId) || state.turns.get(editing.targetId);
    setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'checking', error: '' }) : current);
    Promise.resolve(runtime.owner?.onTaskControl?.({ channelId: editing.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} }))
      .then((contextId) => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' }) : current))
      .catch(() => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: '编辑锁已失效' }) : current));
  }, [access]);

  async function startEditing(turn, actorId) {
    if (editing) return;
    setEditNotice('');
    const location = taskControlContext(turn, { selfId, access, targetAuthority: waitingRosterAuthority }).location;
    // Editing moves focus and draft ownership to the Composer; it does not
    // express a reading direction or a new viewport anchor. Keep the current
    // adapter so a Following edit cannot cold-mount browsing before the editor
    // receives its text/focus. A later trusted scroll still takes browsing
    // through the native input owner, independently of this edit lease.
    const sessionId = ++editSessionSerialRef.current;
    const draft = { sessionId, releaseMessageId: newId(), channelId: state.channelId, targetId: turn.requestId, actorId, holdId: '', location, oldText: editableText(turn), text: editableText(turn), attachments: argsOf(turn.request).attachments || [], phase: 'requesting_lock', error: '' };
    const ownerRuntime = editRuntimeRef.current;
    if (ownerRuntime?.channelId === draft.channelId) {
      editSessionOwnersRef.current.set(sessionId, ownerRuntime);
    }
    setEditing(draft);
    try {
      const holdId = await ownerRuntime?.onTaskControl?.({ channelId: draft.channelId, turn, actorId, type: TYPES.agentHold, payload: { target: turn.requestId } });
      if (!holdId) {
        editSessionOwnersRef.current.delete(sessionId);
        setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: '无法锁定这条任务' }) : current);
        return;
      }
      if (editReleasePendingRef.current.has(sessionId)) {
        void releaseEditSession({ ...draft, holdId }, turn, ownerRuntime).catch((error) => {
          diagnostic('warn', 'timeline.edit_release_failed', {
            channelId: draft.channelId,
            targetId: draft.targetId,
            holdId,
            error,
          });
        });
        return;
      }
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, holdId, phase: 'locking', error: '' }) : current);
    } catch (failure) {
      editSessionOwnersRef.current.delete(sessionId);
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure?.message || String(failure) || '无法锁定这条任务' }) : current);
    }
  }

  async function verifyAndSave(nextText) {
    if (!editing || editing.phase !== 'editing') return;
    const sessionId = editing.sessionId;
    const runtime = editSessionRuntimes(editing);
    const targetTurn = runtime.authority?.state?.turns?.get(editing.targetId) || state.turns.get(editing.targetId);
    const text = typeof nextText === 'string' ? nextText : editing.text;
    setEditing((current) => current?.sessionId === sessionId ? ({ ...current, text, phase: 'checking', error: '' }) : current);
    try {
      const contextId = await runtime.owner?.onTaskControl?.({ channelId: editing.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} });
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' }) : current);
    } catch (failure) {
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure?.message || String(failure) || '无法确认编辑锁' }) : current);
    }
  }

  async function abandonEditing() {
    if (!editing || editing.phase === 'releasing') return;
    const sessionId = editing.sessionId;
    if (!editing.holdId) {
      // The hold request is already in flight. Record the release obligation
      // before hiding the editor; a late hold receipt must submit the fixed-id
      // unhold instead of leaving an orphaned lease.
      editReleasePendingRef.current.add(sessionId);
      setEditing((current) => current?.sessionId === sessionId ? null : current);
      return;
    }
    const targetTurn = state.turns.get(editing.targetId);
    if (editing.location === 'processing') setResumePin(editing.targetId);
    setEditing((current) => current?.sessionId === sessionId
      ? ({ ...current, phase: 'releasing', error: '' })
      : current);
    try {
      const released = await releaseEditSession(editing, targetTurn);
      if (!released) throw new Error('正在等待编辑锁编号，稍后会自动解除');
      setEditing((current) => current?.sessionId === sessionId ? null : current);
    } catch (failure) {
      setEditing((current) => current?.sessionId === sessionId ? ({
        ...current,
        phase: 'editing',
        error: failure?.message || String(failure) || '解除编辑锁失败，请重试',
      }) : current);
    }
  }

  useEffect(() => {
    if (!onComposerEditChange) return;
    onComposerEditChange(editing ? { session: editing, onSave: verifyAndSave, onAbandon: abandonEditing } : null);
  }, [onComposerEditChange, editing?.targetId, editing?.phase, editing?.error]);

  useEffect(() => () => {
    const session = editingRef.current;
    if (session) void releaseEditSession(session).catch((error) => {
      diagnostic('warn', 'timeline.edit_release_failed', {
        channelId: session.channelId,
        targetId: session.targetId,
        holdId: session.holdId,
        error,
      });
    });
    onComposerEditChange?.(null);
  }, [onComposerEditChange, state.channelId]);


  const floatingInput = <>
    {editNotice && <p className="agent-edit-error" role="alert">{editNotice}</p>}
    <WaitingLayer turns={queuedTurns} handoffs={waitingHandoff.exiting} state={state} names={names} selfId={selfId} access={access} targetAuthority={waitingRosterAuthority} capabilityIndex={capabilityIndex} frozenByActor={frozenByActor} editing={editing} onCancel={onCancel} onControl={(turn, actorId, type, payload) => onTaskControl?.({ channelId: state.channelId, turn, actorId, type, payload })} onEdit={startEditing} onEditText={(text) => setEditing((current) => current && ({ ...current, text, error: '' }))} onEditSave={verifyAndSave} onEditAbandon={abandonEditing} />
  </>;

  const acceptedComposerTokensRef = useRef(new WeakSet());
  const readingIntent = useMemo(() => ({
    composerSendStarted(channelID) {
      if (channelID !== state.channelId) return null;
      const before = viewport.captureBottomIntent();
      if (!before || !viewport.requestBottom('composer:send-start', before, {
        afterPresentationRevision: before.presentationRevision,
        baselineTailID: before.baselineTailID,
      })) return null;
      // Return the post-intent revision. The list may consume bottomIntent
      // before IndexedDB accepts the send, but native input/scope replacement
      // will change this authority and make the later acceptance stale.
      return viewport.captureBottomIntent();
    },
    composerAccepted(channelID, messageIDs, token) {
      if (channelID !== state.channelId
        || !messageIDs?.length
        || !token
        || typeof token.activationID !== 'string'
        || !Number.isSafeInteger(token.inputEpoch)
        || !Number.isSafeInteger(token.intentRevision)
        || !['following', 'browsing'].includes(token.mode)) return false;
      if (acceptedComposerTokensRef.current.has(token)) return false;
      const current = viewport.captureBottomIntent();
      if (!current
        || current.activationID !== token.activationID
        || current.inputEpoch !== token.inputEpoch
        || current.intentRevision !== token.intentRevision) return false;
      acceptedComposerTokensRef.current.add(token);
      if (viewport.bindBottomIntentTargets?.(token, messageIDs) === false) return false;
      // Acceptance only consumes the send correlation token. Send-start has
      // already published the one bottom intent; receipt/feed ordering cannot
      // cause a second request.
      return true;
    },
    composerRejected(channelID, token) {
      if (channelID !== state.channelId || !token) return false;
      // A local durable failure revokes only the exact send-start authority.
      // The viewport validates activation/input epochs and the bottom-intent id,
      // so a late failure cannot consume a newer send or an explicit return.
      return viewport.revokeBottomIntent?.(token) === true;
    },
  }), [state.channelId, viewport.bindBottomIntentTargets, viewport.captureBottomIntent, viewport.requestBottom, viewport.revokeBottomIntent]);

  return <ReadingIntentProvider value={readingIntent}><MessageLayoutProvider store={messageLayoutStoreRef.current}><MarkdownFileReferenceProvider onOpen={openFileReference}><ProgressTrailHost><ConversationSurface input={composer} floating={floatingInput}>
		<section id="workspace-panel-dynamic" className="timeline timeline-virtualized" role="tabpanel" aria-labelledby="workspace-tab-dynamic" data-viewport-mode={viewport.session.mode} data-has-initial-anchor={viewport.session.bookmark ? true : undefined}>
      <div className={state.rows.size ? 'timeline-inner timeline-controls-overlay' : 'timeline-inner'}>
        {projectionSelfId && Boolean(state.rows.size) && <div className="timeline-scope-bar">
          <div className="timeline-scope" role="group" aria-label="动态范围">
            <button
              type="button"
              aria-pressed={scope === TIMELINE_SCOPE.mine}
              title={`切换为${TIMELINE_SCOPE_LABELS[scope === TIMELINE_SCOPE.mine ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine]}`}
              onClick={() => {
                setScope((value) => value === TIMELINE_SCOPE.mine ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine);
              }}
            >{TIMELINE_SCOPE_LABELS[scope]}</button>
            {actorFilterApplies && (filterableAgents.length > 0 || staleActorFilters.length > 0) && <div className="timeline-actor-filter" role="group" aria-label="按成员过滤">
              {filterableAgents.map((row) => {
                const on = actorFilter.has(row.id);
                const activity = agentActivity?.agents?.[row.id];
                const activityState = activity?.state || '';
                const actorName = names.get(row.id) || row.id;
                return <div className="timeline-actor-filter-item" key={row.id}>
                  <button
                    type="button"
                    className={[on && 'is-on', activityState && `activity-${activityState}`].filter(Boolean).join(' ')}
                    aria-pressed={on}
                    title={on ? `取消只看 ${actorName}` : `只看我与 ${actorName} 的往来`}
                    onClick={() => {
                      // 选择成员仍是唯一的交互入口；若这位成员的本轮活动已经
                      // settled，同一次点击顺便退役提示，不增加额外确认步骤。
                      if (activityState === 'settled') onAcknowledgeAgentActivity?.(row.id);
                      setActorFilter((current) => {
                        const next = new Set(current);
                        if (!next.delete(row.id)) next.add(row.id);
                        return next;
                      });
                    }}
                  >{activityState && <i className="agent-activity-dot" aria-hidden="true" />}{actorName}</button>
                </div>;
              })}
              {staleActorFilters.map((actorID) => <button
                key={actorID}
                type="button"
                className="is-on is-stale"
                aria-pressed="true"
                aria-label={`移除已失效成员筛选 ${actorID}`}
                title={`已失效成员：${actorID}；点击移除筛选`}
                onClick={() => setActorFilter((current) => {
                  const next = new Set(current);
                  next.delete(actorID);
                  return next;
                })}
              >已失效 · {actorID}</button>)}
            </div>}
          </div>
        </div>}
		{presentationEmpty && viewport.availability === 'empty-known' && (
		  viewport.emptyReason === 'channel'
		    ? <div className="empty-ledger"><span>#</span><h2>这本账还没有可见条目</h2><p>从下方编辑器 @ 一位成员开始。</p></div>
		    : <div className="empty-ledger"><span>@</span>{staleActorFilters.length
		      ? <><h2>当前应用了已失效的成员筛选。</h2><p>从上方移除已失效筛选后即可查看当前范围。</p></>
		      : viewport.historyBoundary?.actorFiltered
		        ? <><h2>已扫描到频道开头，没有符合当前成员筛选的往来</h2><p>这不表示频道为空；切回「全部」可查看其他动态。</p></>
		        : <><h2>这个频道里还没有与你相关的往来</h2><p>切回「全部」可以看到频道里其他人的动态。</p></>}</div>
		)}
		{presentationEmpty && viewport.availability === 'partial' && (
		  <div className="empty-ledger" data-scope-state="partial"><span>@</span>{staleActorFilters.length
		    ? <><h2>当前应用了已失效的成员筛选。</h2><p>从上方移除已失效筛选后即可查看当前范围。</p></>
		    : <><h2>正在查找符合筛选的往来…</h2><p>会继续读取更早内容，找到后自动显示。</p></>}</div>
		)}
	  </div>
		  {((presentationEmpty && ['syncing', 'unknown'].includes(viewport.availability)) || viewport.availability === 'materializing') && <div className="timeline-history-status" role="status">正在确认频道内容…</div>}
		  {presentationEmpty && viewport.availability === 'partial' && viewport.historyDemand?.phase === 'pending' && <div
		    className="timeline-history-status timeline-history-demand"
		    data-phase="pending"
		    data-revision={viewport.historyDemand.revision}
		    role="status"
		  >正在读取更早动态…</div>}
		  {presentationEmpty && viewport.availability === 'error' && <div
      className="timeline-history-status timeline-history-demand"
      data-phase="error"
      data-revision={viewport.historyDemand?.revision || 0}
      role="alert"
    ><span>{viewport.availabilityError || '确认频道内容失败'}</span><button type="button" onClick={() => viewport.retryAvailability()}>重试</button></div>}
	  {!presentationEmpty && identityPending && <div className="timeline-history-status" role="status">正在确认你的频道身份，当前显示全部动态。</div>}
	  {!presentationEmpty && !identityPending && viewport.availability === 'readable'
	    && viewport.freshness?.phase === 'pending' && <div
	      className="timeline-history-status timeline-freshness-status"
	      data-phase="pending"
	      role="status"
	    >正在确认频道最新内容…</div>}
	  {!presentationEmpty && !identityPending && viewport.availability === 'readable'
	    && viewport.freshness?.phase === 'error' && <div
	      className="timeline-history-status timeline-freshness-status"
	      data-phase="error"
	      role="alert"
	    ><span>{viewport.freshness.error || '确认频道最新内容失败'}</span><button type="button" onClick={() => viewport.retryAvailability()}>重试</button></div>}
	  {!presentationEmpty && !identityPending && viewport.availability === 'readable' && viewport.historyDemand?.phase !== 'idle' && <div
      className="timeline-history-status timeline-history-demand"
      data-phase={viewport.historyDemand.phase}
      data-revision={viewport.historyDemand.revision}
      role={viewport.historyDemand.phase === 'error' ? 'alert' : 'status'}
    >{viewport.historyDemand.phase === 'error'
      ? <><span>{viewport.historyDemand.error || '读取更早动态失败'}</span><button type="button" onClick={() => viewport.retryHistoryDemand()}>重试</button></>
      : '正在读取更早动态…'}</div>}
	  {!presentationEmpty && !identityPending && viewport.availability === 'readable'
	    && viewport.historyDemand?.phase === 'idle' && viewport.historyBoundary?.kind === 'exhausted' && <div
	      className="timeline-history-status timeline-history-demand"
	      data-phase="exhausted"
	      data-generation={viewport.historyBoundary.generation}
	      role="status"
	    >{viewport.historyBoundary.actorFiltered
	      ? '已到频道开头，没有更早的符合筛选的往来'
	      : '已到频道最早一条动态'}</div>}
		{/* ReadingSession synchronously owns following/browsing. The adapter only
		  * keeps the outgoing paint while the browsing container materializes the
		  * already-committed bookmark. */}
		<ReadingContainerHandoff
		  key={messageListRenderKey}
		  snapshot={rolePresentation}
		  reading={viewport}
		  surfaceVisible={surfaceVisible}
		  bottomIntentPresentation={bottomIntentPresentation}
		  rowRevision={rowRenderRevision}
			  rowPresentationState={rowPresentationState}
			  livePresentationArrivals={livePresentationArrivalSnapshot}
			  renderRow={renderRow}
		/>
	  {viewport.unseenNotice > 0 && <button type="button" className="timeline-jump-latest" onClick={viewport.jumpToLatest}>↓ {viewport.unseenNotice} 条新动态</button>}
    </section>
  </ConversationSurface></ProgressTrailHost></MarkdownFileReferenceProvider></MessageLayoutProvider></ReadingIntentProvider>;
}
