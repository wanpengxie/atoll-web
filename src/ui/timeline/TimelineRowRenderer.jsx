import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { terminalContentEnvelope, terminalResultState } from '../../model/terminal-result.js';
import { argsOf } from '../../protocol/envelope.js';
import { DECISIONS, TYPES } from '../../protocol/vocab.js';
import { messageTimeLabel } from '../../util/time.js';
import { MarkdownContent } from '../MarkdownContent.jsx';
import { FoldableBody } from './FoldableBody.jsx';

function MessageFrame({ className = '', actions = null, identity = null, contentClassName = '', children, ...articleProps }) {
  return <article className={`message-row ${className}`.trim()} tabIndex="0" {...articleProps}>
    {actions}
    <div className="information-flow-avatar-slot">{identity}</div>
    <div className={`message-body information-flow-content ${contentClassName}`.trim()}>{children}</div>
  </article>;
}

function ContentFrame({ children, contained = false }) {
  return <div className={`information-flow-row ${contained ? 'contained' : ''}`.trim()}>
    <div className="information-flow-avatar-slot" aria-hidden="true" />
    <div className="information-flow-content">{children}</div>
  </div>;
}

function textOf(envelope) {
  const body = argsOf(envelope);
  const value = body.text ?? body.body ?? body.answer ?? body.detail ?? body.title ?? body.message;
  if (value != null && typeof value !== 'object') return String(value);
  const result = body.result ?? body.output ?? value;
  if (result != null) {
    if (typeof result === 'string') return result;
    try { return `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``; }
    catch { return String(result); }
  }
  return '';
}

function nameOf(id, names) {
  return actorNameFromMap(id, names);
}

function attachmentName(attachment) {
  return attachment?.name || attachment?.resource_id || attachment?.id || '附件';
}

function Attachments({ envelope, onDownload, onPreview }) {
  const attachments = argsOf(envelope).attachments || argsOf(envelope).files || [];
  if (!attachments.length) return null;
  return <section className="message-attachments" aria-label="附件列表">
    {attachments.map((attachment, index) => <article
      className="message-attachment"
      key={attachment.resource_id || attachment.id || `${attachmentName(attachment)}:${index}`}
    >
      <button type="button" className="message-attachment-open" onClick={() => onPreview?.(attachment)}>
        <span className="attachment-icon" aria-hidden="true">◇</span>
        <span><strong>{attachmentName(attachment)}</strong><small>{attachment.media_type || '文件'}</small></span>
      </button>
      {onDownload && <button type="button" className="message-attachment-download" onClick={() => onDownload(attachment)}>↓</button>}
    </article>)}
  </section>;
}

function MessageActions({ envelope, onReply, onCreateTask }) {
  if (!onReply && !onCreateTask) return null;
  return <div className="message-actions" aria-label="条目操作">
    {onReply && <button type="button" onClick={() => onReply({
      id: envelope.id,
      sender: envelope.sender,
      text: textOf(envelope),
    })}>↩ 回复</button>}
    {onCreateTask && <button type="button" onClick={() => onCreateTask(envelope)}>创建任务</button>}
  </div>;
}

function EnvelopeBody({ envelope, fold, onDownload, onPreview }) {
  const text = textOf(envelope);
  const foldID = `${envelope?.id || 'message'}:body`;
  return <>
    {text && <FoldableBody
      id={foldID}
      text={text}
      exempt={fold?.latest === true}
      automaticExpanded={fold?.automaticExpanded === true}
      expanded={fold?.overrides?.get(foldID)}
      onToggle={fold?.onToggle}
    ><MarkdownContent contentKey={`message:${envelope?.id || foldID}:body`} text={text} /></FoldableBody>}
    <Attachments envelope={envelope} onDownload={onDownload} onPreview={onPreview} />
  </>;
}

function ApprovalCard({ turn, names, state, onResolve }) {
  const request = turn.request;
  const terminal = terminalContentEnvelope(turn);
  const settled = Boolean(turn.terminal);
  const busy = state === 'sending';
  return <article className={`approval-card${settled ? ' settled' : ''}`}>
    <header><span>需要你的决定</span><small>{nameOf(request.sender?.id, names)} · {messageTimeLabel(request.ts)}</small></header>
    <div className="approval-summary"><MarkdownContent contentKey={`approval:${request.id}`} text={textOf(request)} /></div>
    {!settled && <div className="approval-actions">
      <button type="button" className="approve" disabled={busy} onClick={() => onResolve?.(request.id, DECISIONS.approve, {})}>批准</button>
      <button type="button" className="reject" disabled={busy} onClick={() => onResolve?.(request.id, DECISIONS.reject, {})}>拒绝</button>
    </div>}
    {terminal && <footer className="final-answer"><EnvelopeBody envelope={terminal} /></footer>}
    {turn.terminalClosureOnly && <footer className="final-answer unavailable">{terminalResultState(turn).error}</footer>}
  </article>;
}

function TurnCard({
  turn,
  names,
  selfId,
  fold,
  approvalState,
  editing,
  onResolve,
  onCancel,
  onControl,
  onEdit,
  onDownload,
  onPreview,
  onReply,
  onCreateTask,
  onOpen,
}) {
  const request = turn.request;
  const actorId = request.audience?.[0] || '';
  if ([TYPES.humanAsk, TYPES.humanApprove].includes(request.type)
    && request.audience?.includes(selfId)) {
    return <ContentFrame><ApprovalCard turn={turn} names={names} state={approvalState} onResolve={onResolve} /></ContentFrame>;
  }
  const terminal = terminalContentEnvelope(turn);
  const senderName = nameOf(request.sender?.id, names);
  const pending = !turn.terminal;
  const local = request.local_submission_state;
  return <MessageFrame
    className={`turn-card status-${turn.status || (pending ? 'pending' : 'completed')}`}
    identity={<span className={`actor-icon kind-${request.sender?.kind || 'human'}`}>{String(senderName || '?').slice(0, 1).toUpperCase()}</span>}
    actions={<MessageActions envelope={request} onReply={onReply} onCreateTask={onCreateTask} />}
  >
    <header><strong>{senderName}</strong><time>{messageTimeLabel(request.ts)}</time>{local && <small>{local}</small>}</header>
    <EnvelopeBody envelope={request} fold={fold} onDownload={onDownload} onPreview={onPreview} />
    {terminal && <section className="final-answer">
      <header><strong>{nameOf(terminal.sender?.id || actorId, names)}</strong><time>{messageTimeLabel(terminal.ts)}</time></header>
      <EnvelopeBody envelope={terminal} fold={fold} onDownload={onDownload} onPreview={onPreview} />
    </section>}
    {turn.terminalClosureOnly && <p className="final-answer unavailable">{terminalResultState(turn).error}</p>}
    {turn.thread?.length > 0 && <details className="turn-thread"><summary>{turn.thread.length} 次关联调用</summary>
      <ol>{turn.thread.map((entry) => <li key={entry.turn.requestId}>{textOf(entry.turn.request) || entry.turn.request.type}</li>)}</ol>
    </details>}
    <div className="task-controls">
      {pending && request.type === TYPES.agentAsk && onEdit && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, actorId)}>编辑</button>}
      {pending && request.type === TYPES.agentAsk && onControl && <button type="button" onClick={() => onControl(turn, actorId, TYPES.agentInterrupt, {})}>停止</button>}
      {local && onCancel && <button type="button" onClick={() => onCancel(turn.requestId)}>取消</button>}
      {onOpen && <button type="button" onClick={() => onOpen(turn)}>详情</button>}
    </div>
    {editing?.targetId === turn.requestId && <p className="agent-wait-editing-label">正在编辑</p>}
  </MessageFrame>;
}

function Standalone({ envelope, names, selfId, continuation, fold, onDownload, onPreview, onReply, onCreateTask }) {
  const senderName = nameOf(envelope.sender?.id, names);
  return <MessageFrame
    className={`standalone-row${continuation ? ' continuation' : ''}${envelope.sender?.id === selfId ? ' self' : ''}`}
    identity={<span className={`actor-icon kind-${envelope.sender?.kind || 'human'}`}>{String(senderName || '?').slice(0, 1).toUpperCase()}</span>}
    actions={<MessageActions envelope={envelope} onReply={onReply} onCreateTask={onCreateTask} />}
  >
    {!continuation && <header><strong>{senderName}</strong><time>{messageTimeLabel(envelope.ts)}</time></header>}
    <EnvelopeBody envelope={envelope} fold={fold} onDownload={onDownload} onPreview={onPreview} />
  </MessageFrame>;
}

function Narration({ rows, names }) {
  return <div className="timeline-narration">{(rows || []).map(({ seq, envelope }) => <p key={envelope.id || seq}>
    <strong>{nameOf(envelope.sender?.id, names)}</strong> {textOf(envelope) || envelope.type}
  </p>)}</div>;
}

export function useTimelineRowRenderer({
  state,
  names,
  selfId,
  presentationEditing,
  browsingExpandedSlots,
  effectiveFoldOverrides,
  approvalStates,
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
  toggleFold,
}) {
  const actionsRef = useRef(null);
  useLayoutEffect(() => {
    actionsRef.current = {
      state,
      onResolve,
      onCancel,
      onTaskControl,
      onDownloadResource,
      onPreviewResource,
      onOpenTurn,
      onCreateTask,
      onReply,
      startEditing,
    };
  });
  const rowRenderRevision = useCallback((_index, row) => {
    const foldID = row.body?.kind === 'turn'
      ? `${row.body.turn.requestId}:body`
      : `${row.body?.envelope?.id || row.id}:body`;
    return [
      row.contentRevision,
      row.id === latestRowID ? 1 : 0,
      browsingExpandedSlots.has(row.visualSlotID || row.id) ? 1 : 0,
      effectiveFoldOverrides.get(foldID),
      presentationEditing?.targetId === row.id ? presentationEditing.phase : '',
      approvalStates?.[row.id] || '',
    ].join('\u0001');
  }, [approvalStates, browsingExpandedSlots, effectiveFoldOverrides, latestRowID, presentationEditing]);
  const fold = useMemo(() => ({
    latest: false,
    automaticExpanded: false,
    overrides: effectiveFoldOverrides,
    onToggle: toggleFold,
  }), [effectiveFoldOverrides, toggleFold]);
  const renderRow = useCallback((row) => {
    const entry = row.body;
    const port = actionsRef.current;
    const rowFold = {
      ...fold,
      latest: row.id === latestRowID,
      automaticExpanded: browsingExpandedSlots.has(row.visualSlotID || row.id),
    };
    let content = null;
    if (entry?.kind === 'narration') content = <ContentFrame><Narration rows={state.narration} names={names} /></ContentFrame>;
    else if (entry?.kind === 'turn') content = <TurnCard
      turn={{ ...entry.turn, thread: entry.thread || [] }}
      names={names}
      selfId={selfId}
      fold={rowFold}
      approvalState={approvalStates?.[entry.turn.request.id]}
      editing={presentationEditing}
      onResolve={(requestID, decision, payload) => port?.onResolve?.(state.channelId, requestID, decision, payload)}
      onCancel={(requestID) => port?.onCancel?.(state.channelId, requestID)}
      onControl={(turn, actorId, type, payload) => port?.onTaskControl?.({ channelId: state.channelId, turn, actorId, type, payload })}
      onEdit={port?.startEditing}
      onDownload={(attachment) => port?.onDownloadResource?.(state.channelId, attachment)}
      onPreview={(attachment) => port?.onPreviewResource?.(state.channelId, attachment)}
      onReply={port?.onReply}
      onCreateTask={port?.onCreateTask}
      onOpen={port?.onOpenTurn}
    />;
    else if (entry?.envelope) content = <Standalone
      envelope={entry.envelope}
      names={names}
      selfId={selfId}
      continuation={row.continuation}
      fold={rowFold}
      onDownload={(attachment) => port?.onDownloadResource?.(state.channelId, attachment)}
      onPreview={(attachment) => port?.onPreviewResource?.(state.channelId, attachment)}
      onReply={port?.onReply}
      onCreateTask={port?.onCreateTask}
    />;
    return <div data-message-id={row.id} data-seq-low={row.seqLow} data-seq-high={row.seqHigh}>
      {content || <ContentFrame><p>无法显示此条目</p></ContentFrame>}
      {row.boundaryAfterTimestamp > 0 && <div className="day-separator"><span>{new Date(row.boundaryAfterTimestamp).toLocaleDateString('zh-CN')}</span></div>}
    </div>;
  }, [approvalStates, browsingExpandedSlots, fold, latestRowID, names, presentationEditing, selfId, state]);
  return { rowRenderRevision, renderRow };
}
