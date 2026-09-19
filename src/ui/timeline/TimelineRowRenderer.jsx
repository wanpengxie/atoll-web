import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { terminalContentEnvelope, terminalResultState } from '../../model/terminal-result.js';
import { argsOf } from '../../protocol/envelope.js';
import { DECISIONS, TYPES } from '../../protocol/vocab.js';
import { messageTimeLabel } from '../../util/time.js';
import { MarkdownContent } from '../MarkdownContent.jsx';
import { FoldableBody } from './FoldableBody.jsx';

const RESULT_META = new Set(['status', 'reason', 'error_code', 'detail', 'cancelled', 'closed_by']);
const SENSITIVE_FIELD = /^(password|secret|secret_hash|token|access_token|refresh_token|private_key|key|credential)$/i;

function MessageFrame({ className = '', actions = null, identity = null, contentClassName = '', children, ...articleProps }) {
  return <article className={`message-row ${className}`.trim()} tabIndex="0" {...articleProps}>
    {actions}<div className="information-flow-avatar-slot">{identity}</div>
    <div className={`message-body information-flow-content ${contentClassName}`.trim()}>{children}</div>
  </article>;
}

function ContentFrame({ children, contained = false }) {
  return <div className={`information-flow-row ${contained ? 'contained' : ''}`.trim()}>
    <div className="information-flow-avatar-slot" aria-hidden="true" /><div className="information-flow-content">{children}</div>
  </div>;
}

function textContent(payload) {
  for (const value of [payload?.new_text, payload?.text, payload?.body, payload?.answer, payload?.message, payload?.content, payload?.prompt, payload?.input?.text]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (Array.isArray(payload?.content)) return payload.content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text.trim()).filter(Boolean).join('\n\n');
  return '';
}

function textOf(envelope) {
  const body = argsOf(envelope);
  const text = textContent(body);
  if (text) return text;
  const result = body.result ?? body.output;
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try { return `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``; } catch { return String(result); }
}

function nameOf(id, names) { return actorNameFromMap(id, names); }

function actorIcon(envelope, names, fallbackKind = 'human') {
  const kind = envelope?.sender?.kind || fallbackKind;
  const name = nameOf(envelope?.sender?.id, names);
  return <span className={`actor-icon kind-${kind}`}>{String(name || kind || '?').slice(0, 1).toUpperCase()}</span>;
}

function attachmentName(attachment) { return attachment?.name || attachment?.resource_id || attachment?.id || '附件'; }
function attachmentType(attachment) {
  const mediaType = attachment?.media_type || attachment?.mediaType || '';
  if (mediaType.startsWith('image/')) return '图片';
  if (mediaType === 'application/pdf') return 'PDF';
  if (mediaType.startsWith('audio/')) return '音频';
  if (mediaType.startsWith('video/')) return '视频';
  if (mediaType.startsWith('text/')) return '文本';
  return '文件';
}

function Attachments({ envelope, onDownload, onPreview }) {
  const attachments = argsOf(envelope).attachments || argsOf(envelope).files || [];
  if (!attachments.length) return null;
  return <section className="message-attachments" aria-label="附件列表">{attachments.map((attachment, index) => <article
    className="message-attachment" key={attachment.resource_id || attachment.id || `${attachmentName(attachment)}:${index}`}
  >
    <button type="button" className="message-attachment-open" onClick={onPreview ? () => onPreview(attachment) : undefined} disabled={!onPreview}>
      <span className="attachment-icon" aria-hidden="true">{attachmentType(attachment) === 'PDF' ? 'PDF' : '◇'}</span>
      <span><strong>{attachmentName(attachment)}</strong><small>{attachmentType(attachment)}</small></span>
    </button>
    {onDownload && <button type="button" className="message-attachment-download" aria-label={`下载 ${attachmentName(attachment)}`} onClick={() => onDownload(attachment)}>↓</button>}
  </article>)}</section>;
}

async function copyMessageText(text) {
  if (globalThis.navigator?.clipboard?.writeText) { await globalThis.navigator.clipboard.writeText(text); return; }
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') throw new Error('clipboard unavailable');
  const field = document.createElement('textarea');
  field.value = text; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0';
  document.body.appendChild(field); field.select();
  const copied = document.execCommand('copy'); field.remove();
  if (!copied) throw new Error('copy failed');
}

function MessageActions({ envelope, turn = null, onReply, onCreateTask, onOpen }) {
  const feedbackTimer = useRef(0);
  const [copyState, setCopyState] = useState('');
  const body = textOf(envelope).trim();
  useEffect(() => () => globalThis.clearTimeout(feedbackTimer.current), []);
  if (!body && !onReply && !onCreateTask && !onOpen) return null;
  const copy = body ? async () => {
    globalThis.clearTimeout(feedbackTimer.current);
    try { await copyMessageText(body); setCopyState('copied'); } catch { setCopyState('error'); }
    feedbackTimer.current = globalThis.setTimeout(() => setCopyState(''), 1600);
  } : null;
  const feedback = copyState === 'copied' ? '已复制正文' : copyState === 'error' ? '复制失败' : '';
  return <div className={`message-actions${feedback ? ' has-feedback' : ''}`} aria-label="条目操作">
    {copy && <button type="button" onClick={copy}>{copyState === 'copied' ? '✓ 已复制' : '复制'}</button>}
    {onReply && <button type="button" onClick={() => onReply({ id: envelope.id, sender: envelope.sender, text: body })}>↩ 回复</button>}
    {onCreateTask && <button type="button" onClick={() => onCreateTask(envelope)}>创建任务</button>}
    {onOpen && turn && <button type="button" onClick={() => onOpen(turn)}>查看过程</button>}
    <span className="message-copy-feedback" role="status">{feedback}</span>
  </div>;
}

function ReplyableMessageFrame({ envelope, turn = null, onReply, onCreateTask, onOpen, children, className = '', ...props }) {
  return <MessageFrame {...props} className={`replyable-message ${className}`.trim()}
    actions={<MessageActions envelope={envelope} turn={turn} onReply={onReply} onCreateTask={onCreateTask} onOpen={onOpen} />}
  >{children}</MessageFrame>;
}

function EnvelopeBody({ envelope, fold, onDownload, onPreview, contentKeyPrefix = 'message' }) {
  const text = textOf(envelope);
  const foldID = `${envelope?.id || 'message'}:body`;
  return <>{text && <FoldableBody id={foldID} text={text} exempt={fold?.latest === true}
    automaticExpanded={fold?.automaticExpanded === true} expanded={fold?.overrides?.get(foldID)} onToggle={fold?.onToggle}
  ><MarkdownContent contentKey={`${contentKeyPrefix}:${envelope?.id || foldID}:body`} text={text} /></FoldableBody>}
  <Attachments envelope={envelope} onDownload={onDownload} onPreview={onPreview} /></>;
}

function redactSensitive(value, key = '') {
  if (key && SENSITIVE_FIELD.test(key)) return '已隐藏';
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSensitive(item, name)]));
  return value;
}

function Scalar({ value }) {
  if (value === null) return <span className="structured-null">null</span>;
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  return <span>{String(value)}</span>;
}

function StructuredTree({ value, depth = 0 }) {
  if (value == null || typeof value !== 'object') return <Scalar value={value} />;
  if (Array.isArray(value)) return <div className="structured-array"><p>{value.length} 项</p>{value.slice(0, 20).map((item, index) => <div className="structured-array-item" key={index}><code>{index + 1}</code><StructuredTree value={item} depth={depth + 1} /></div>)}</div>;
  const entries = Object.entries(value);
  if (!entries.length) return <span>空对象</span>;
  const tree = <dl className="structured-object">{entries.map(([key, item]) => <div key={key}><dt>{key}</dt><dd><StructuredTree value={item} depth={depth + 1} /></dd></div>)}</dl>;
  return depth >= 2 ? <details><summary>{entries.length} 个字段</summary>{tree}</details> : tree;
}

function parseJSON(text) {
  const source = String(text || '').trim();
  if (!source || !['{', '['].includes(source[0])) return undefined;
  try { const parsed = JSON.parse(source); return parsed && typeof parsed === 'object' ? parsed : undefined; } catch { return undefined; }
}

function StructuredData({ title, value }) {
  const safe = redactSensitive(value);
  const summary = Array.isArray(safe) ? `${safe.length} 项` : safe && typeof safe === 'object' ? `${Object.keys(safe).length} 个字段` : '';
  return <div className="structured-result"><details className="structured-result-details"><summary><span>{title}</span><small>{summary}</small><span className="structured-result-action">展开</span></summary><div className="structured-result-scroll"><StructuredTree value={safe} /></div></details></div>;
}

function StructuredResult({ payload = {}, contentKey }) {
  const safe = redactSensitive(payload);
  const business = Object.fromEntries(Object.entries(safe).filter(([key]) => !RESULT_META.has(key)));
  if (payload.status === 'failed') return <div className="failure-result"><strong>{payload.cancelled ? '任务已取消' : '请求失败'}</strong>{(payload.error_code || payload.reason) && <code>{payload.error_code || payload.reason}</code>}{payload.detail && <p>{payload.detail}</p>}{Object.keys(business).length > 0 && <StructuredData title="错误数据" value={business} />}</div>;
  if (Object.prototype.hasOwnProperty.call(payload, 'text')) {
    const text = String(payload.text ?? '');
    if (!text) return <p className="empty-result">返回了空文本</p>;
    const parsed = parseJSON(text);
    return parsed === undefined ? <MarkdownContent contentKey={contentKey} text={text} /> : <StructuredData title="JSON 结果" value={parsed} />;
  }
  if (Object.keys(business).length > 0) return <StructuredData title="结构化结果" value={business} />;
  return <p className="completion-ack">✓ 已完成</p>;
}

function WireErrorLine({ error }) {
  const code = error?.code || (typeof error === 'string' ? error : '');
  const detail = error?.detail || error?.message || '';
  return <div className="wire-error" role="alert"><strong>操作失败{code && <> <code>{code}</code></>}</strong>{detail && <details><summary>详情</summary>{detail}</details>}</div>;
}

function ApprovalCard({ turn, names, state, onResolve }) {
  const request = turn.request;
  const payload = argsOf(request);
  const terminal = terminalContentEnvelope(turn);
  const isText = request.type === TYPES.humanAsk;
  const settled = state === 'resolved' || Boolean(turn.terminal);
  const busy = state === 'sending';
  const error = typeof state === 'object' ? state.error : null;
  const expiresAt = Number(request.expires_at || payload.expires_at || 0);
  const expired = expiresAt > 0 && expiresAt <= Date.now();
  const [answer, setAnswer] = useState('');
  const [formError, setFormError] = useState('');
  function submitAnswer() {
    const text = answer.trim();
    if (!text) { setFormError('回答不能为空'); return; }
    setFormError(''); onResolve?.(request.id, '', { text });
  }
  function decide(decision) {
    setFormError(''); const note = answer.trim(); onResolve?.(request.id, decision, note ? { note } : {});
  }
  return <article className={`approval-card ${settled ? 'settled' : ''}`} data-request-id={turn.requestId} data-request-type={request.type}>
    <header><span>{isText ? '需要你的回答' : '需要你的决定'}</span><small>{nameOf(request.sender?.id, names)} · {messageTimeLabel(request.ts)}</small></header>
    <div className="approval-summary"><strong>{payload.title || payload.text || request.type}</strong>{payload.detail && <p>{payload.detail}</p>}{payload.impact && <p><b>影响：</b>{payload.impact}</p>}</div>
    {!settled && onResolve && <label className="approval-answer"><span>{isText ? '回答' : '备注（可选）'}</span><textarea rows={isText ? 4 : 2} value={answer} disabled={busy || expired} onChange={(event) => { setAnswer(event.target.value); setFormError(''); }} /></label>}
    {expiresAt > 0 && <p className={expired ? 'approval-expired' : 'approval-deadline'}>{expired ? '已过期，不能再处理' : `截止：${new Date(expiresAt).toLocaleString('zh-CN')}`}</p>}
    <div className="approval-actions">{!settled && onResolve && (isText ? <button type="button" className="approve" disabled={busy || expired} onClick={submitAnswer}>提交回答</button> : <><button type="button" className="approve" disabled={busy || expired} onClick={() => decide(DECISIONS.approve)}>批准</button><button type="button" className="reject" disabled={busy || expired} onClick={() => decide(DECISIONS.reject)}>拒绝</button></>)}{settled && <span>已回执</span>}</div>
    {formError && <p className="approval-form-error" role="alert">{formError}</p>}
    {terminal && <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}><p className="answer-label">RESPONSE · {String(argsOf(terminal).status || '').toUpperCase()}</p><p className="approval-resolver">处理者：{nameOf(terminal.sender?.id, names)}{argsOf(terminal).decision && ` · ${argsOf(terminal).decision}`}</p><StructuredResult payload={argsOf(terminal)} contentKey={`terminal:${terminal.id || turn.requestId}:body`} /></footer>}
    {turn.terminalClosureOnly && <footer className="final-answer unavailable">{terminalResultState(turn).error}</footer>}{error && <WireErrorLine error={error} />}
  </article>;
}

function processObservations(turn) {
  return (turn?.provisional || []).map((item) => ({ seq: Number(item.seq), envelope: item.envelope, process: argsOf(item.envelope).process }))
    .filter((item) => Number.isFinite(item.seq) && item.process && typeof item.process === 'object').sort((a, b) => a.seq - b.seq);
}
function conversationObservations(turn) {
  return processObservations(turn).filter(({ process }) => process.kind === 'stage' && process.stage === 'text' && typeof process.text === 'string' && process.text.trim());
}
function progressRows(turn) {
  const rows = []; const tools = new Map();
  for (const { process, seq, envelope } of processObservations(turn)) {
    if (process.kind === 'stage' && process.stage !== 'text') { rows.push({ key: `stage:${seq}`, seq, line: process.text || (process.stage === 'thinking' ? '思考中…' : process.stage || '处理中'), ts: envelope.ts }); continue; }
    if (process.kind !== 'tool') continue;
    const key = process.tool_call_id || String(seq);
    if (process.phase === 'started') { const row = { key: `tool:${key}`, seq, line: `tool: ${process.tool || '工具'} …`, ts: envelope.ts }; rows.push(row); tools.set(key, row); }
    else if (process.phase === 'ended') { const started = tools.get(key); if (started) { started.seq = seq; started.line = `tool: ${process.tool || '工具'} ${process.outcome === 'failed' ? '失败' : '完成'}`; } else rows.push({ key: `tool:${key}`, seq, line: `tool: ${process.tool || '工具'} ${process.outcome === 'failed' ? '失败' : '完成'}`, ts: envelope.ts }); }
  }
  return rows.sort((a, b) => a.seq - b.seq);
}

function ProgressTrail({ turn, title }) {
  const [open, setOpen] = useState(false);
  const rows = progressRows(turn); const running = !turn.terminal;
  if (!rows.length && !running) return null;
  if (!running) return <div className="progress-trail settled"><button type="button" className="progress-trail-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span aria-hidden="true">⤷</span><span>{rows.length} 条过程记录</span><span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>{open && <ol className="progress-trail-list">{rows.map((row) => <li className="progress-row is-state" key={row.key}><span className="progress-row-line">{row.line}</span></li>)}</ol>}</div>;
  return <div className={`progress-trail running agent-processing-status${open ? ' is-open' : ''}`} role="status" aria-live="polite"><button type="button" className="progress-running-header" aria-expanded={open} onClick={() => setOpen((value) => !value)}><strong><i aria-hidden="true" />处理中: {title || '任务'}</strong><span className="progress-running-time">PROCESSING</span></button>{rows.length > 0 && <ol className="progress-trail-list">{(open ? rows : rows.slice(-2)).map((row) => <li className="progress-row is-state" key={row.key}><span className="progress-row-line">{row.line}</span></li>)}</ol>}</div>;
}

function finalEchoObservation(observations, terminalText) {
  const answer = String(terminalText || '').trim(); const last = String(observations.at(-1)?.process?.text || '').trim();
  if (!answer || !last) return null;
  const body = last.endsWith('…[truncated]') ? last.slice(0, -'…[truncated]'.length) : last;
  return body && answer.startsWith(body) ? observations.at(-1) : null;
}
function ConversationAnswerSlot({ text, terminalPayload = null, contentKey }) {
  if (!terminalPayload) return <MarkdownContent contentKey={contentKey} text={text} />;
  if (Object.prototype.hasOwnProperty.call(terminalPayload, 'text') && terminalPayload.text !== '' && parseJSON(terminalPayload.text) === undefined) return <MarkdownContent contentKey={contentKey} text={String(terminalPayload.text)} />;
  return <StructuredResult payload={terminalPayload} contentKey={contentKey} />;
}

function AgentAnswer({ turn, names, fold, onDownload, onPreview, onReply, onCreateTask, onOpen }) {
  const request = turn.request; const terminal = terminalContentEnvelope(turn);
  const liveEnvelope = terminal || turn.provisional?.at(-1)?.envelope || null;
  const agentId = terminal?.sender?.id || liveEnvelope?.sender?.id || request.audience?.[0] || '';
  const observations = conversationObservations(turn); const terminalText = terminal ? textContent(argsOf(terminal)) : '';
  const echo = terminal ? finalEchoObservation(observations, terminalText) : null;
  const visible = echo ? observations.slice(0, -1) : observations;
  const foldText = [...visible.map((item) => item.process.text), terminalText].filter(Boolean).join('\n\n');
  const content = visible.map(({ seq, envelope, process }) => { const slot = envelope.id || `${turn.requestId}:${seq}`; return <div key={slot} className="agent-progress-text" data-seq={seq}><ConversationAnswerSlot text={process.text} contentKey={`answer:${turn.requestId}:${slot}:body`} /></div>; });
  if (terminal) content.push(echo ? <div key={echo.envelope.id || `${turn.requestId}:${echo.seq}`} className="agent-final-text" data-seq={echo.seq} data-answer-slot={turn.requestId}><ConversationAnswerSlot text={echo.process.text} terminalPayload={argsOf(terminal)} contentKey={`answer:${turn.requestId}:${echo.envelope.id || echo.seq}:body`} /></div> : <div key={terminal.id || `${turn.requestId}:terminal`} className="agent-final-text" data-answer-slot={turn.requestId}><StructuredResult payload={argsOf(terminal)} contentKey={`answer:${turn.requestId}:terminal:body`} /></div>);
  const answerEnvelope = terminal || liveEnvelope || { id: `${turn.requestId}:answer`, sender: { id: agentId, kind: 'agent' }, payload: { body: { text: '' } } };
  return <ReplyableMessageFrame envelope={answerEnvelope} turn={turn} onReply={terminal ? onReply : null} onCreateTask={terminal ? onCreateTask : null} onOpen={onOpen}
    className={`agent-turn-bubble ${turn.terminal ? 'settled' : 'processing'}`} contentClassName="response-body"
    identity={<span className="actor-icon kind-agent">{String(nameOf(agentId, names) || 'A').slice(0, 1).toUpperCase()}</span>}
  >
    <header><strong>{nameOf(agentId, names)}</strong><small className="ai-label">AI</small>{liveEnvelope?.ts && <time>{messageTimeLabel(liveEnvelope.ts)}</time>}{turn.terminal && (turn.status === 'failed' ? <span className="response-failed">处理失败</span> : <small>已完成</small>)}</header>
    {content.length > 0 && <div className="response-content"><FoldableBody id={`${turn.requestId}:response`} text={foldText} exempt={fold?.latest === true} automaticExpanded={fold?.automaticExpanded === true} expanded={fold?.overrides?.get(`${turn.requestId}:response`)} onToggle={fold?.onToggle}>{content}</FoldableBody></div>}
    <ProgressTrail turn={turn} title={textOf(request)} />{turn.terminalClosureOnly && <p className="terminal-result-unavailable">{terminalResultState(turn).error}</p>}<Attachments envelope={answerEnvelope} onDownload={onDownload} onPreview={onPreview} />
  </ReplyableMessageFrame>;
}

function threadDepths(root, thread) {
  const parentByID = new Map(thread.map(({ turn }) => [turn.requestId, String(turn.request?.parent_id || '')]));
  return thread.map((item) => { let depth = 1; let parent = parentByID.get(item.turn.requestId); const visited = new Set([item.turn.requestId]); while (parent && parent !== root.requestId && parentByID.has(parent) && !visited.has(parent)) { visited.add(parent); depth += 1; parent = parentByID.get(parent); } return { ...item, depth }; });
}
function ThreadCall({ item, names }) {
  const [open, setOpen] = useState(false); const child = item.turn; const terminal = terminalContentEnvelope(child);
  const receivers = (child.request.audience || []).map((id) => nameOf(id, names)).join('、');
  const status = child.terminal ? (child.status === 'failed' ? '失败' : '已完成') : '处理中';
  return <li className={`turn-thread-item status-${child.status}`} style={{ '--thread-depth': item.depth }}><button type="button" className="turn-thread-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}><strong>{textOf(child.request) || child.request.type}</strong><small>{nameOf(child.request.sender?.id, names)} → {receivers || '—'} · {status} · {messageTimeLabel(child.request.ts)}</small></button>{open && (terminal ? <div className="turn-thread-result"><StructuredResult payload={argsOf(terminal)} contentKey={`thread:${terminal.id || child.requestId}:body`} /></div> : <p className="turn-thread-result empty">{child.terminalClosureOnly ? terminalResultState(child).error : '还没有终态。'}</p>)}</li>;
}
function ThreadCalls({ root, thread, names }) {
  const [open, setOpen] = useState(false); const items = threadDepths(root, thread || []);
  if (!items.length) return null;
  const failed = items.filter((item) => item.turn.status === 'failed').length; const running = items.filter((item) => !item.turn.terminal).length;
  return <ContentFrame contained><button type="button" className={`turn-thread-toggle${failed ? ' has-failure' : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span className={running ? 'pulse' : 'pulse done'} /><span>{items.length} 次关联调用</span><small>{running ? `${running} 处理中` : failed ? `${failed} 失败` : '已完成'}</small><span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>{open && <ol className="turn-thread-list">{items.map((item) => <ThreadCall key={item.turn.requestId} item={item} names={names} />)}</ol>}</ContentFrame>;
}

function TurnCard({ turn, names, selfId, fold, approvalState, editing, onResolve, onCancel, onControl, onEdit, onDownload, onPreview, onReply, onCreateTask, onOpen }) {
  const request = turn.request; const actorId = request.audience?.[0] || '';
  if ([TYPES.humanAsk, TYPES.humanApprove].includes(request.type) && request.audience?.includes(selfId)) return <ContentFrame><ApprovalCard turn={turn} names={names} state={approvalState} onResolve={onResolve} /></ContentFrame>;
  const pending = !turn.terminal; const local = request.local_submission_state;
  const recipients = (request.audience || []).map((id) => nameOf(id, names)).join('、');
  return <section className={`turn-card agent-conversation-turn${request.sender?.id === selfId ? ' self' : ''} status-${turn.status || (pending ? 'pending' : 'completed')}`} data-request-id={turn.requestId} data-request-type={request.type}>
    <ReplyableMessageFrame envelope={request} turn={turn} onReply={onReply} onCreateTask={onCreateTask} onOpen={onOpen} className="request-message" identity={actorIcon(request, names)}>
      <header><strong>{nameOf(request.sender?.id, names)}</strong>{request.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{messageTimeLabel(request.ts)}</time>{recipients && <span className="recipient-label">发送给 {recipients}</span>}{local && <small>{local}</small>}</header>
      <div className="request-text"><EnvelopeBody envelope={request} fold={fold} onDownload={onDownload} onPreview={onPreview} contentKeyPrefix="request" /></div>{editing?.targetId === turn.requestId && <small className="message-editing-state">正在输入框中编辑</small>}
    </ReplyableMessageFrame>
    {pending && !local && <ContentFrame contained><div className="task-controls"><div className="task-control-buttons">{request.type === TYPES.agentAsk && onEdit && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, actorId)}>编辑</button>}{request.type === TYPES.agentAsk && onControl && <button type="button" onClick={() => onControl(turn, actorId, TYPES.agentInterrupt, {})}>停止</button>}</div></div></ContentFrame>}
    {local && onCancel && <ContentFrame contained><div className="task-controls"><div className="task-control-buttons"><button type="button" onClick={() => onCancel(turn.requestId)}>取消</button></div></div></ContentFrame>}
    <AgentAnswer turn={turn} names={names} fold={fold} onDownload={onDownload} onPreview={onPreview} onReply={onReply} onCreateTask={onCreateTask} onOpen={onOpen} />
    <ThreadCalls root={turn} thread={turn.thread} names={names} />
  </section>;
}

function Standalone({ envelope, names, selfId, continuation, fold, onDownload, onPreview, onReply, onCreateTask }) {
  const senderName = nameOf(envelope.sender?.id, names);
  return <ReplyableMessageFrame envelope={envelope} onReply={onReply} onCreateTask={onCreateTask} className={`standalone-row${continuation ? ' continuation' : ''}${envelope.sender?.id === selfId ? ' self' : ''}`} identity={continuation ? <time className="continuation-time" aria-label={`${senderName}，${messageTimeLabel(envelope.ts)}`}>{messageTimeLabel(envelope.ts)}</time> : actorIcon(envelope, names)}>
    {!continuation && <header><strong>{senderName}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{messageTimeLabel(envelope.ts)}</time></header>}<EnvelopeBody envelope={envelope} fold={fold} onDownload={onDownload} onPreview={onPreview} />
  </ReplyableMessageFrame>;
}
function Narration({ rows, names }) { return <div className="timeline-narration">{(rows || []).map(({ seq, envelope }) => <p key={envelope.id || seq}><strong>{nameOf(envelope.sender?.id, names)}</strong> {textOf(envelope) || envelope.type}</p>)}</div>; }

export function useTimelineRowRenderer({ state, names, selfId, presentationEditing, browsingExpandedSlots, effectiveFoldOverrides, approvalStates, latestRowID = '', onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, startEditing, toggleFold }) {
  const currentActions = { state, onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, startEditing };
  const actionsRef = useRef(currentActions);
  useLayoutEffect(() => { actionsRef.current = currentActions; });
  const rowRenderRevision = useCallback((_index, row) => {
    const foldID = row.body?.kind === 'turn' ? `${row.body.turn.requestId}:body` : `${row.body?.envelope?.id || row.id}:body`;
    return [row.contentRevision, row.id === latestRowID ? 1 : 0, browsingExpandedSlots.has(row.visualSlotID || row.id) ? 1 : 0, effectiveFoldOverrides.get(foldID), presentationEditing?.targetId === row.id ? presentationEditing.phase : '', approvalStates?.[row.id] || ''].join('\u0001');
  }, [approvalStates, browsingExpandedSlots, effectiveFoldOverrides, latestRowID, presentationEditing]);
  const fold = useMemo(() => ({ latest: false, automaticExpanded: false, overrides: effectiveFoldOverrides, onToggle: toggleFold }), [effectiveFoldOverrides, toggleFold]);
  const renderRow = useCallback((row) => {
    const entry = row.body; const port = actionsRef.current;
    const rowFold = { ...fold, latest: row.id === latestRowID, automaticExpanded: browsingExpandedSlots.has(row.visualSlotID || row.id) };
    let content = null;
    if (entry?.kind === 'narration') content = <ContentFrame><Narration rows={state.narration} names={names} /></ContentFrame>;
    else if (entry?.kind === 'turn') content = <TurnCard turn={{ ...entry.turn, thread: entry.thread || [] }} names={names} selfId={selfId} fold={rowFold} approvalState={approvalStates?.[entry.turn.request.id]} editing={presentationEditing}
      onResolve={port?.onResolve ? (requestID, decision, payload) => port.onResolve(state.channelId, requestID, decision, payload) : undefined}
      onCancel={port?.onCancel ? (requestID) => port.onCancel(state.channelId, requestID) : undefined}
      onControl={port?.onTaskControl ? (turn, actorId, type, payload) => port.onTaskControl({ channelId: state.channelId, turn, actorId, type, payload }) : undefined}
      onEdit={port?.startEditing}
      onDownload={port?.onDownloadResource ? (attachment) => port.onDownloadResource(state.channelId, attachment) : undefined}
      onPreview={port?.onPreviewResource ? (attachment) => port.onPreviewResource(state.channelId, attachment) : undefined}
      onReply={port?.onReply} onCreateTask={port?.onCreateTask} onOpen={port?.onOpenTurn}
    />;
    else if (entry?.envelope) content = <Standalone envelope={entry.envelope} names={names} selfId={selfId} continuation={row.continuation} fold={rowFold}
      onDownload={port?.onDownloadResource ? (attachment) => port.onDownloadResource(state.channelId, attachment) : undefined}
      onPreview={port?.onPreviewResource ? (attachment) => port.onPreviewResource(state.channelId, attachment) : undefined}
      onReply={port?.onReply} onCreateTask={port?.onCreateTask}
    />;
    return <div data-message-id={row.id} data-seq-low={row.seqLow} data-seq-high={row.seqHigh}>{content || <ContentFrame><p>无法显示此条目</p></ContentFrame>}{row.boundaryAfterTimestamp > 0 && <div className="day-separator"><span>{new Date(row.boundaryAfterTimestamp).toLocaleDateString('zh-CN')}</span></div>}</div>;
  }, [approvalStates, browsingExpandedSlots, fold, latestRowID, names, presentationEditing, selfId, state]);
  return { rowRenderRevision, renderRow };
}
