import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { isStandardActorIdentity } from '../../model/actor-visibility.js';
import { redactSensitive, terminalContentEnvelope, terminalResultState, turnProcessObservations } from '../../model/terminal-result.js';
import { isMobileProfile } from '../../model/device-profile.js';
import { argsOf, hasCanonicalBody } from '../../protocol/envelope.js';
import { DECISIONS, isSystemWord, TYPES } from '../../protocol/vocab.js';
import { messageTimeLabel } from '../../util/time.js';
import { MarkdownContent } from '../MarkdownContent.jsx';
import { useModalFocus } from '../primitives/useModalFocus.js';
import { FoldableBody } from './FoldableBody.jsx';

const RESULT_META = new Set(['status', 'reason', 'error_code', 'detail', 'cancelled', 'closed_by']);
const FAILURE_LABELS = Object.freeze({
  unanswered_timeout: '请求在截止时间前没有得到最终响应',
  receiver_unavailable: '接收方已不可用',
  receiver_internal_error: '接收方处理失败',
  type_unsupported: '接收方不支持这个操作',
  payload_invalid: '请求参数不符合要求',
  bad_payload: '请求格式不正确',
  forbidden: '没有执行该操作的权限',
  permission_denied: '没有执行该操作的权限',
});

function MessageFrame({ className = '', actions = null, identity = null, contentClassName = '', contentProps = {}, children, ...articleProps }) {
  return <article className={`message-row ${className}`.trim()} tabIndex="0" {...articleProps}>
    {actions}<div className="information-flow-avatar-slot">{identity}</div>
    <div {...contentProps} className={`message-body information-flow-content ${contentClassName}`.trim()}>{children}</div>
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

// System operations are typed protocol facts, not conversational prose. Keep
// their product wording at the existing timeline presentation boundary: known
// words use a closed label table and only their documented identifier field;
// an unknown system word gets a generic safe label. Never stringify an
// operation body to invent a label or expose a wire type to the reader.
const SYSTEM_OPERATION_LABELS = Object.freeze({
  [TYPES.member.create]: '添加参与者',
  [TYPES.member.admit]: '邀请成员加入',
  [TYPES.member.list]: '查看频道成员',
  [TYPES.member.get]: '查看成员状态',
  [TYPES.member.remove]: '移除参与者',
  [TYPES.member.restart]: '重启参与者',
  [TYPES.member.restartAll]: '重启频道内全部成员',
  [TYPES.log.recent]: '读取最近账本',
  [TYPES.log.query]: '查询动态',
  [TYPES.channel.create]: '创建子频道',
  [TYPES.channel.get]: '查看频道信息',
  [TYPES.channel.list]: '列出频道',
  [TYPES.channel.set]: '更新频道配置',
  [TYPES.channel.remove]: '退役频道',
  [TYPES.channelDevice.list]: '查看频道设备',
  [TYPES.channelTemplate.create]: '创建频道模板',
  [TYPES.channelTemplate.get]: '查看频道模板',
  [TYPES.channelTemplate.list]: '查看频道模板',
  [TYPES.channelTemplate.set]: '更新频道模板',
  [TYPES.channelTemplate.remove]: '退役频道模板',
  [TYPES.actorTemplate.create]: '创建参与者模板',
  [TYPES.actorTemplate.get]: '查看参与者模板',
  [TYPES.actorTemplate.list]: '查看参与者模板',
  [TYPES.actorTemplate.set]: '更新参与者模板',
  [TYPES.actorTemplate.remove]: '退役参与者模板',
  [TYPES.actorOverlay.set]: '设置 Actor 频道配置',
  [TYPES.actorOverlay.clear]: '清除 Actor 频道配置',
  [TYPES.principal.create]: '创建账户',
  [TYPES.principal.login]: '登录',
  [TYPES.principal.remove]: '停用账户',
  [TYPES.principal.get]: '查看账户',
  [TYPES.principal.list]: '查看账户列表',
  [TYPES.credential.set]: '重设凭据',
  [TYPES.device.create]: '创建设备凭据',
  [TYPES.device.attach]: '挂载设备到频道',
  [TYPES.device.detach]: '从频道卸载设备',
  [TYPES.device.list]: '查看设备',
  [TYPES.device.remove]: '退役设备',
  [TYPES.narration.memberCreated]: '成员已加入',
  [TYPES.narration.memberDeleted]: '成员已移除',
  [TYPES.narration.channelInbound]: '频道收到新动态',
});

// These are the typed identifier fields accepted by the current protocol
// owners. Values are displayed only when the operation's own contract names
// that field; arbitrary payload keys are deliberately ignored.
const SYSTEM_OPERATION_DETAIL_KEYS = Object.freeze({
  [TYPES.member.create]: 'decl_id',
  [TYPES.member.admit]: 'principal',
  [TYPES.member.get]: 'member',
  [TYPES.member.remove]: 'member',
  [TYPES.member.restart]: 'member',
  [TYPES.channel.create]: 'name',
  [TYPES.channel.get]: 'channel_id',
  [TYPES.channel.list]: 'parent_id',
  [TYPES.channel.set]: 'channel_id',
  [TYPES.channel.remove]: 'channel_id',
  [TYPES.actorTemplate.create]: 'id',
  [TYPES.actorTemplate.get]: 'id',
  [TYPES.actorTemplate.set]: 'id',
  [TYPES.actorTemplate.remove]: 'id',
  [TYPES.channelTemplate.create]: 'id',
  [TYPES.channelTemplate.get]: 'id',
  [TYPES.channelTemplate.set]: 'id',
  [TYPES.channelTemplate.remove]: 'id',
  [TYPES.actorOverlay.set]: 'decl_id',
  [TYPES.actorOverlay.clear]: 'decl_id',
  [TYPES.principal.get]: 'principal',
  [TYPES.principal.remove]: 'principal',
  [TYPES.device.remove]: 'device_id',
  [TYPES.device.create]: 'name',
  [TYPES.device.attach]: 'device_id',
  [TYPES.device.detach]: 'device_id',
});

function textFact(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function memberEvent(envelope, kind) {
  const body = argsOf(envelope);
  const memberId = textFact(body.member);
  if (!memberId) return null;
  return {
    kind,
    memberId,
    declarationId: textFact(body.decl_id),
    principalId: textFact(body.principal),
    reason: kind === 'member_left' ? textFact(body.reason) : '',
  };
}

const SYSTEM_EVENT_DECODERS = new Map([
  [TYPES.narration.memberCreated, (envelope) => memberEvent(envelope, 'member_joined')],
  [TYPES.narration.memberDeleted, (envelope) => memberEvent(envelope, 'member_left')],
  [TYPES.narration.channelInbound, (envelope) => {
    const body = argsOf(envelope);
    const fromChannel = textFact(body.from);
    const requestType = textFact(body.type);
    const localRequestId = textFact(body.local_request_id);
    if (!fromChannel || !requestType || !localRequestId) return null;
    return { kind: 'channel_inbound', fromChannel, requestType, localRequestId };
  }],
]);

function decodeSystemEvent(envelope) {
  const type = textFact(envelope?.type);
  const decoder = SYSTEM_EVENT_DECODERS.get(type);
  if (!decoder) return { kind: 'unknown', type, valid: false };
  const decoded = decoder(envelope);
  return decoded ? { ...decoded, type, valid: true } : { kind: 'invalid', type, valid: false };
}

function systemOperationStatus(body) {
  if (body?.status === 'failed') return '失败';
  if (body?.status === 'completed') return '已完成';
  if (body?.status === 'processing') return '处理中';
  if (body?.status === 'queued') return '排队中';
  return '';
}

function systemOperationText(envelope, body) {
  const type = String(envelope?.type || '');
  if (!isSystemWord(type)) return '';
  const label = SYSTEM_OPERATION_LABELS[type] || '系统操作';
  const detailKey = SYSTEM_OPERATION_DETAIL_KEYS[type];
  const detail = detailKey && (typeof body?.[detailKey] === 'string' || typeof body?.[detailKey] === 'number')
    ? String(body[detailKey]).trim()
    : '';
  const status = systemOperationStatus(body);
  return `${label}${status ? `（${status}）` : ''}${detail ? `：${detail}` : ''}`;
}

function isTimelineSystemEvent(envelope) {
  return envelope?.visibility === 'system' || SYSTEM_EVENT_DECODERS.has(envelope?.type);
}

function systemEventPresentation(envelope, names) {
  if (!isTimelineSystemEvent(envelope)) return null;
  // Flat historical payloads are intentionally ignored by argsOf(); do not
  // let a renderer-only fallback turn them back into business facts.
  if (!hasCanonicalBody(envelope)) return { handled: true, hidden: true, text: '' };

  const event = decodeSystemEvent(envelope);
  if (event.kind === 'member_joined' || event.kind === 'member_left') {
    const hidden = isStandardActorIdentity({ id: event.memberId, declarationId: event.declarationId });
    if (hidden) return { handled: true, hidden: true, text: '', standalone: true, event };
    const name = nameOf(event.memberId, names);
    const title = event.kind === 'member_joined' ? `${name} 已加入频道` : `${name} 已离开频道`;
    const detail = event.kind === 'member_left' && event.reason ? `（原因：${event.reason}）` : '';
    return { handled: true, hidden: false, standalone: true, text: `${title}${detail}`, event };
  }
  if (event.kind === 'channel_inbound') {
    return {
      handled: true,
      hidden: false,
      standalone: true,
      text: `收到来自 ${event.fromChannel} 的频道请求：${event.requestType}`,
      event,
    };
  }

  // A known system operation still uses its existing closed label table. An
  // unknown/invalid narration never reads arbitrary JSON keys as prose.
  const type = String(envelope?.type || '');
  if (SYSTEM_EVENT_DECODERS.has(type)) {
    return { handled: true, hidden: false, standalone: true, text: '无法识别的频道活动', event };
  }
  if (SYSTEM_OPERATION_LABELS[type]) {
    return { handled: true, hidden: false, standalone: false, text: systemOperationText(envelope, argsOf(envelope)), event };
  }
  return {
    handled: true,
    hidden: false,
    standalone: true,
    text: event.kind === 'invalid' ? '无法识别的频道活动' : '后台状态已更新',
    event,
  };
}

function textOf(envelope, names) {
  if (!hasCanonicalBody(envelope)) return '';
  const system = systemEventPresentation(envelope, names);
  if (system?.handled) return system.text;
  const body = argsOf(envelope);
  const text = textContent(body);
  if (text) return text;
  // A typed operation label is only a fallback: when the canonical body
  // carries prose, the reader must see that user-authored content verbatim.
  const systemText = systemOperationText(envelope, body);
  if (systemText) return systemText;
  const result = body.result ?? body.output;
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try { return `\`\`\`json\n${JSON.stringify(redactSensitive(result), null, 2)}\n\`\`\``; } catch { return '结构化结果'; }
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

const TOUCH_LONG_PRESS_MS = 500;

function isInteractiveTouchTarget(target) {
  return Boolean(target && typeof target.closest === 'function'
    && target.closest('button, a, input, textarea, select, summary, [role="button"], [contenteditable="true"]'));
}

function useMessageActionController(envelope, onReply) {
  const feedbackTimer = useRef(0);
  const gestureRef = useRef({ active: null, suppressClick: false, suppressTimer: 0 });
  const [copyState, setCopyState] = useState('');
  const body = textOf(envelope).trim();
  useEffect(() => () => {
    globalThis.clearTimeout(feedbackTimer.current);
    if (gestureRef.current.active?.timer) globalThis.clearTimeout(gestureRef.current.active.timer);
    globalThis.clearTimeout(gestureRef.current.suppressTimer);
  }, []);
  const copy = body ? async () => {
    globalThis.clearTimeout(feedbackTimer.current);
    try { await copyMessageText(body); setCopyState('copied'); } catch { setCopyState('error'); }
    feedbackTimer.current = globalThis.setTimeout(() => setCopyState(''), 1600);
  } : null;
  const reply = onReply ? () => onReply({ id: envelope.id, sender: envelope.sender, text: body }) : null;
  const beginTouch = (kind) => (event) => {
    if (event.pointerType !== 'touch') {
      gestureRef.current.suppressClick = false;
      return;
    }
    if (kind === 'surface' && isInteractiveTouchTarget(event.target)) return;
    const previous = gestureRef.current.active;
    if (previous?.timer) globalThis.clearTimeout(previous.timer);
    globalThis.clearTimeout(gestureRef.current.suppressTimer);
    gestureRef.current.suppressClick = false;
    const gesture = { kind, completed: false, timer: 0, startX: event.clientX, startY: event.clientY };
    if (kind === 'copy' || kind === 'surface') {
      gesture.timer = globalThis.setTimeout(() => {
        if (gestureRef.current.active !== gesture) return;
        gesture.completed = true;
        void copy?.();
      }, TOUCH_LONG_PRESS_MS);
    }
    gestureRef.current.active = gesture;
  };
  const endTouch = (kind) => (event) => {
    if (event.pointerType !== 'touch') return;
    const gesture = gestureRef.current.active;
    if (!gesture || gesture.kind !== kind) return;
    if (gesture.timer) globalThis.clearTimeout(gesture.timer);
    gestureRef.current.active = null;
    if (kind !== 'surface') {
      gestureRef.current.suppressClick = true;
      gestureRef.current.suppressTimer = globalThis.setTimeout(() => {
        gestureRef.current.suppressClick = false;
      }, TOUCH_LONG_PRESS_MS);
      event.preventDefault();
    }
    if (gesture.completed || (kind !== 'reply' && kind !== 'surface')) return;
    reply?.();
  };
  const cancelTouch = (event) => {
    if (event.pointerType !== 'touch') return;
    const gesture = gestureRef.current.active;
    if (!gesture) return;
    if (gesture.timer) globalThis.clearTimeout(gesture.timer);
    gestureRef.current.active = null;
    if (gesture.kind !== 'surface') {
      gestureRef.current.suppressClick = true;
      gestureRef.current.suppressTimer = globalThis.setTimeout(() => {
        gestureRef.current.suppressClick = false;
      }, TOUCH_LONG_PRESS_MS);
      event.preventDefault();
    }
  };
  const moveTouch = (event) => {
    if (event.pointerType !== 'touch') return;
    const gesture = gestureRef.current.active;
    if (!gesture || !Number.isFinite(gesture.startX) || !Number.isFinite(gesture.startY)) return;
    const dx = Number(event.clientX) - gesture.startX;
    const dy = Number(event.clientY) - gesture.startY;
    if (Math.hypot(dx, dy) > 8) cancelTouch(event);
  };
  const click = (action) => (event) => {
    // A touch pointer-up can be followed by the browser's compatibility click
    // (detail > 0). Keyboard activation is detail === 0 and must remain a
    // direct public action even when it follows a touch gesture.
    if (gestureRef.current.suppressClick && event.detail !== 0) {
      gestureRef.current.suppressClick = false;
      globalThis.clearTimeout(gestureRef.current.suppressTimer);
      event.preventDefault();
      return;
    }
    action?.();
  };
  const gestureProps = (kind) => ({
    onPointerDown: beginTouch(kind),
    onPointerMove: moveTouch,
    onPointerUp: endTouch(kind),
    onPointerCancel: cancelTouch,
    onPointerLeave: cancelTouch,
  });
  return {
    copy,
    copyState,
    reply,
    onCopyClick: click(copy),
    onReplyClick: click(reply),
    actionGestureProps: gestureProps,
    surfaceProps: gestureProps('surface'),
  };
}

function MessageActions({ envelope, turn = null, onReply, onCreateTask, onOpen, copy, copyState, onCopyClick, onReplyClick, actionGestureProps }) {
  if (!copy && !onReply && !onCreateTask && !onOpen) return null;
  const feedback = copyState === 'copied' ? '已复制正文' : copyState === 'error' ? '复制失败' : '';
  return <div className={`message-actions${feedback ? ' has-feedback' : ''}`} aria-label="条目操作">
    {copy && <button type="button" onClick={onCopyClick} {...actionGestureProps('copy')}>{copyState === 'copied' ? '✓ 已复制' : '复制'}</button>}
    {onReply && <button type="button" onClick={onReplyClick} {...actionGestureProps('reply')}>↩ 回复</button>}
    {onCreateTask && <button type="button" onClick={() => turn ? onCreateTask(envelope, turn) : onCreateTask(envelope)}>创建任务</button>}
    {onOpen && turn && <button type="button" onClick={() => onOpen(turn)}>查看过程</button>}
    <span className="message-copy-feedback" role="status">{feedback}</span>
  </div>;
}

function ReplyableMessageFrame({ envelope, turn = null, onReply, onCreateTask, onOpen, children, className = '', ...props }) {
  const actions = useMessageActionController(envelope, onReply);
  return <MessageFrame {...props} className={`replyable-message ${className}`.trim()}
    contentProps={actions.surfaceProps}
    actions={<MessageActions envelope={envelope} turn={turn} onReply={onReply} onCreateTask={onCreateTask} onOpen={onOpen}
      copy={actions.copy} copyState={actions.copyState} onCopyClick={actions.onCopyClick}
      onReplyClick={actions.onReplyClick} actionGestureProps={actions.actionGestureProps} />}
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

function resultTitle(requestType, payload) {
  if (requestType === TYPES.describe || (payload.words && payload.class)) return payload.class ? `${payload.class} 的能力` : 'Actor 能力';
  if (requestType === TYPES.channel.list) return requestType;
  return '结构化结果';
}

function failureTitle(payload) {
  if (payload.cancelled === true) return '任务已取消';
  const code = payload.error_code || payload.reason || '';
  return FAILURE_LABELS[code] || FAILURE_LABELS[payload.reason] || '请求失败';
}

function controlsAllowed(access) {
  return access === 'member_active' || access === 'member'
    || (access?.relationship === 'member' && access?.unavailable !== true);
}

function latestControlFrame(turn) {
  return [...(turn?.provisional || [])]
    .sort((left, right) => Number(right.seq || 0) - Number(left.seq || 0))
    .map((item) => argsOf(item.envelope))
    .find((body) => body?.status === 'queued' || body?.status === 'processing') || null;
}

function targetIsCurrent(turn, authority) {
  const actorId = turn?.request?.audience?.length === 1 ? turn.request.audience[0] : '';
  return Boolean(actorId && authority?.current === true
    && authority.actorIDs instanceof Set && authority.actorIDs.has(actorId));
}

function canInterrupt(turn, { access, targetAuthority }) {
  if (!turn?.request || turn.terminal || turn.local || !controlsAllowed(access)) return false;
  if (turn.request.type !== TYPES.agentAsk || !targetIsCurrent(turn, targetAuthority)) return false;
  return latestControlFrame(turn)?.controls?.some((entry) => entry?.word === TYPES.agentInterrupt) === true;
}

function StructuredResult({ requestType = '', payload = {}, contentKey }) {
  const safe = redactSensitive(payload);
  const business = Object.fromEntries(Object.entries(safe).filter(([key]) => !RESULT_META.has(key)));
  if (payload.status === 'failed') {
    const code = payload.cancelled === true ? 'cancelled' : payload.error_code || payload.reason || '';
    return <div className="failure-result"><strong>{failureTitle(payload)}</strong>{code && <code>{code}</code>}{payload.detail && <p>{payload.detail}</p>}{Object.keys(business).length > 0 && <StructuredData title="错误数据" value={business} />}</div>;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'text')) {
    const text = String(payload.text ?? '');
    if (!text) return <p className="empty-result">返回了空文本</p>;
    const parsed = parseJSON(text);
    return parsed === undefined ? <MarkdownContent contentKey={contentKey} text={text} /> : <StructuredData title="JSON 结果" value={parsed} />;
  }
  if (Object.keys(business).length > 0) return <StructuredData title={resultTitle(requestType, payload)} value={business} />;
  return <p className="completion-ack">✓ 已完成</p>;
}

function WireErrorLine({ error }) {
  const code = error?.code || (typeof error === 'string' ? error : '');
  const detail = error?.detail || error?.message || '';
  return <div className="wire-error" role="alert"><strong>操作失败{code && <> <code>{code}</code></>}</strong>{detail && <details><summary>详情</summary>{detail}</details>}</div>;
}

function consumeActionPromise(result) {
  if (result && typeof result.catch === 'function') void result.catch(() => {});
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
    setFormError(''); consumeActionPromise(onResolve?.(request.id, '', { text }));
  }
  function decide(decision) {
    setFormError(''); const note = answer.trim(); consumeActionPromise(onResolve?.(request.id, decision, note ? { note } : {}));
  }
  return <article className={`approval-card ${settled ? 'settled' : ''}`} data-request-id={turn.requestId} data-request-type={request.type}>
    <header><span>{isText ? '需要你的回答' : '需要你的决定'}</span><small>{nameOf(request.sender?.id, names)} · {messageTimeLabel(request.ts)}</small></header>
    <div className="approval-summary"><strong>{payload.title || payload.text || request.type}</strong>{payload.detail && <p>{payload.detail}</p>}{payload.impact && <p><b>影响：</b>{payload.impact}</p>}</div>
    {!settled && onResolve && <label className="approval-answer"><span>{isText ? '回答' : '备注（可选）'}</span><textarea rows={isText ? 4 : 2} value={answer} disabled={busy || expired} onChange={(event) => { setAnswer(event.target.value); setFormError(''); }} /></label>}
    {expiresAt > 0 && <p className={expired ? 'approval-expired' : 'approval-deadline'}>{expired ? '已过期，不能再处理' : `截止：${new Date(expiresAt).toLocaleString('zh-CN')}`}</p>}
    <div className="approval-actions">{!settled && onResolve && (isText ? <button type="button" className="approve" disabled={busy || expired} onClick={submitAnswer}>提交回答</button> : <><button type="button" className="approve" disabled={busy || expired} onClick={() => decide(DECISIONS.approve)}>批准</button><button type="button" className="reject" disabled={busy || expired} onClick={() => decide(DECISIONS.reject)}>拒绝</button></>)}{settled && <span>已回执</span>}</div>
    {formError && <p className="approval-form-error" role="alert">{formError}</p>}
    {terminal && <footer className={turn.status === 'failed' ? 'final-answer failed' : 'final-answer'}><p className="answer-label">RESPONSE · {String(argsOf(terminal).status || '').toUpperCase()}</p><p className="approval-resolver">处理者：{nameOf(terminal.sender?.id, names)}{argsOf(terminal).decision && ` · ${argsOf(terminal).decision}`}</p><StructuredResult requestType={request.type} payload={argsOf(terminal)} contentKey={`terminal:${terminal.id || turn.requestId}:body`} /></footer>}
    {turn.terminalClosureOnly && <footer className="final-answer unavailable">{terminalResultState(turn).error}</footer>}{error && <WireErrorLine error={error} />}
  </article>;
}

function readProcessField(process, field) {
  try {
    if (!process || typeof process !== 'object' || !Object.prototype.hasOwnProperty.call(process, field)) return undefined;
    return process[field];
  } catch {
    // A malformed/proxy process must not make the presentation walk arbitrary
    // data or fail the whole timeline. Its field simply has no projection.
    return undefined;
  }
}

function processScalar(process, field) {
  const value = readProcessField(process, field);
  return (typeof value === 'string' || typeof value === 'number') && String(value).trim()
    ? String(value).trim()
    : '';
}

function hasProcessSummary(turn) {
  // Read only the documented scalar identifiers here. The former
  // turnProcessAuditFacts path recursively redacted the entire raw process
  // before this owner selected its public fields.
  const hasAuditFacts = turnProcessObservations(turn).some(({ process }) => {
    const auditId = processScalar(process, 'audit_id') || processScalar(process, 'auditId');
    const callId = processScalar(process, 'tool_call_id') || processScalar(process, 'toolCallId');
    const phase = processScalar(process, 'phase') || processScalar(process, 'stage');
    return Boolean(auditId) || (phase === 'ended' && Boolean(callId));
  });
  return hasAuditFacts || progressRows(turn).some((row) => !row.stateOnly
    && ((typeof row.body === 'string' && row.body.trim()) || hasToolData(row.toolData)));
}
function conversationObservations(turn) {
  return turnProcessObservations(turn).filter(({ process }) => process.kind === 'stage' && process.stage === 'text' && typeof process.text === 'string' && process.text.trim());
}

const MOBILE_TOOL_OUTPUT = Object.freeze({ head: 4096, threshold: 6144 });

function abbreviateMobileToolText(value) {
  if (typeof value !== 'string' || value.length <= MOBILE_TOOL_OUTPUT.threshold) return value;
  return `${value.slice(0, MOBILE_TOOL_OUTPUT.head)}\n…（手机上只保留了开头，此处省略 ${value.length - MOBILE_TOOL_OUTPUT.head} 字符）`;
}

function mobileToolOutputText(output) {
  if (output == null) return '';
  if (typeof output === 'string') return abbreviateMobileToolText(output);
  if (typeof output !== 'object') return String(output);
  let value = output;
  if (!Array.isArray(output)) {
    value = Object.fromEntries(Object.entries(output).map(([key, item]) => [
      key,
      typeof item === 'string' ? abbreviateMobileToolText(item) : item,
    ]));
  }
  try {
    const serialized = abbreviateMobileToolText(JSON.stringify(value, null, 2));
    return `\`\`\`json\n${serialized}\n\`\`\``;
  } catch {
    return '';
  }
}

function toolPresentationBody(detail, toolData) {
  if (!isMobileProfile()) return detail;
  const output = mobileToolOutputText(toolData?.output);
  if (!output) return detail;
  if (!detail) return output;
  return `${detail}\n\n${output}`;
}

// Tool input/output is a presentation-only projection. Select only these two
// documented fields before traversing anything, then redact and bound them in
// one shared-budget pass. The raw process/envelope is never recursively
// visited by this owner.
const TOOL_DATA_LIMITS = Object.freeze({
  depth: 3,
  nodes: 128,
  fields: 48,
  items: 48,
  stringChars: 8192,
  stringLength: 4096,
});

const TOOL_DATA_OMITTED = '…（内容已省略）';
const TOOL_DATA_COLLAPSED = '…（内容已折叠）';
const TOOL_DATA_HIDDEN = '已隐藏';
const TOOL_DATA_ERROR = Symbol('tool-data-error');
// Keep this complete-field set aligned with terminal-result.js; unlike the
// generic helper, this local check never receives or walks the raw process.
const TOOL_SENSITIVE_FIELD = /^(password|secret|secret_hash|token|access_token|refresh_token|private_key|key|credential)$/i;

function toolDataBudget() {
  return {
    depth: TOOL_DATA_LIMITS.depth,
    nodes: TOOL_DATA_LIMITS.nodes,
    fields: TOOL_DATA_LIMITS.fields,
    items: TOOL_DATA_LIMITS.items,
    stringChars: TOOL_DATA_LIMITS.stringChars,
  };
}

function boundedToolValue(value, budget, depth = 0, key = '', seen = new WeakSet()) {
  try {
    if (key && TOOL_SENSITIVE_FIELD.test(String(key))) return TOOL_DATA_HIDDEN;
    if (budget.nodes <= 0) return TOOL_DATA_OMITTED;
    budget.nodes -= 1;
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (budget.stringChars <= 0) return TOOL_DATA_OMITTED;
      const limit = Math.min(value.length, TOOL_DATA_LIMITS.stringLength, budget.stringChars);
      budget.stringChars -= limit;
      if (value.length <= limit) return value;
      return `${value.slice(0, limit)}\n…（已省略 ${value.length - limit} 字符）`;
    }
    if (typeof value !== 'object') return TOOL_DATA_OMITTED;
    if (depth >= budget.depth) return TOOL_DATA_COLLAPSED;
    if (seen.has(value)) return TOOL_DATA_ERROR;
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const bounded = [];
        for (const item of value) {
          if (budget.items <= 0) break;
          budget.items -= 1;
          const child = boundedToolValue(item, budget, depth + 1, '', seen);
          if (child !== TOOL_DATA_ERROR) bounded.push(child);
        }
        if (value.length > bounded.length && budget.items <= 0) bounded.push(TOOL_DATA_OMITTED);
        return bounded;
      }
      const bounded = {};
      let omitted = false;
      for (const field in value) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
        if (budget.fields <= 0) { omitted = true; break; }
        budget.fields -= 1;
        const child = boundedToolValue(value[field], budget, depth + 1, field, seen);
        if (child !== TOOL_DATA_ERROR) bounded[field] = child;
      }
      if (omitted) bounded['…'] = TOOL_DATA_OMITTED;
      return bounded;
    } finally {
      seen.delete(value);
    }
  } catch {
    // Getters, proxies, cyclic/non-JSON values, and other malformed tool data
    // fail closed: the offending field is omitted instead of exposing raw data.
    return TOOL_DATA_ERROR;
  }
}

function hasToolData(value) {
  if (value === TOOL_DATA_ERROR) return false;
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasToolData(item));
  if (typeof value === 'object') return Object.values(value).some((item) => hasToolData(item));
  return true;
}

function toolDataFromProcess(process) {
  if (!process || typeof process !== 'object') return null;
  // This is the only raw-process read in the tool-data path. It is a shallow
  // field selection; the selected values are traversed exactly once below.
  const selected = {};
  for (const field of ['input', 'output']) {
    const value = readProcessField(process, field);
    if (value !== undefined) selected[field] = value;
  }
  if (!Object.keys(selected).length) return null;
  const bounded = boundedToolValue(selected, toolDataBudget());
  if (bounded === TOOL_DATA_ERROR || !bounded || typeof bounded !== 'object') return null;
  return hasToolData(bounded) ? bounded : null;
}

function mergeToolData(previous, next) {
  const merged = {};
  for (const field of ['input', 'output']) {
    const value = hasToolData(next?.[field]) ? next[field] : previous?.[field];
    if (hasToolData(value)) merged[field] = value;
  }
  return Object.keys(merged).length ? merged : null;
}

function toolInputOnly(data) {
  if (!data || typeof data !== 'object') return null;
  const input = Object.fromEntries(Object.entries(data).filter(([field]) => field === 'input'));
  return Object.keys(input).length ? input : null;
}

function progressRows(turn) {
  const rows = []; const tools = new Map();
  for (const { process, seq, envelope } of turnProcessObservations(turn)) {
    // Read only scalar process fields and the typed input/output projection;
    // never recursively redact or stringify the raw process object here.
    const kind = processScalar(process, 'kind');
    if (kind === 'stage' && processScalar(process, 'stage') !== 'text') {
      const stage = processScalar(process, 'stage');
      const text = readProcessField(process, 'text');
      const stageText = typeof text === 'string' ? text : '';
      rows.push({
        key: `stage:${seq}`,
        seq,
        line: stageText || (stage === 'thinking' ? '思考中…' : stage || '处理中'),
        body: stageText,
        ts: envelope.ts,
        kind: 'stage',
        stateOnly: !stageText.trim(),
      });
      continue;
    }
    if (kind !== 'tool') continue;
    const callID = processScalar(process, 'tool_call_id') || String(seq);
    const tool = processScalar(process, 'tool');
    const phase = processScalar(process, 'phase');
    const outcome = processScalar(process, 'outcome');
    const detailValue = readProcessField(process, 'detail');
    const detail = typeof detailValue === 'string' ? detailValue : '';
    const toolData = toolDataFromProcess(process);
    const body = toolPresentationBody(detail, toolData);
    const mobileOutputShown = isMobileProfile() && hasToolData(toolData?.output);
    if (phase === 'started') {
      const row = {
        key: `tool:${callID}`,
        seq,
        line: `tool: ${tool || '工具'} …`,
        body,
        ts: envelope.ts,
        kind: 'tool',
        toolData,
        mobileOutputShown,
        stateOnly: !body.trim() && !hasToolData(toolData),
      };
      rows.push(row);
      tools.set(callID, row);
    } else if (phase === 'ended') {
      const started = tools.get(callID);
      if (started) {
        const endedBody = body.trim() ? body : started.body;
        const mergedToolData = mergeToolData(started.toolData, toolData);
        started.seq = seq;
        started.line = `tool: ${tool || '工具'} ${outcome === 'failed' ? '失败' : '完成'}`;
        started.body = endedBody;
        started.ts = envelope.ts || started.ts;
        started.toolData = mergedToolData;
        started.mobileOutputShown = started.mobileOutputShown || mobileOutputShown;
        started.stateOnly = !String(endedBody || '').trim() && !hasToolData(mergedToolData);
      } else rows.push({
        key: `tool:${callID}`,
        seq,
        line: `tool: ${tool || '工具'} ${outcome === 'failed' ? '失败' : '完成'}`,
        body,
        ts: envelope.ts,
        kind: 'tool',
        toolData,
        mobileOutputShown,
        stateOnly: !body.trim() && !hasToolData(toolData),
      });
    }
  }
  return rows.sort((a, b) => a.seq - b.seq);
}

const PROCESS_CLOCK = new Intl.DateTimeFormat('zh-CN', {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function timestampLabel(ts) {
  const value = new Date(ts);
  return Number.isFinite(value.getTime()) ? PROCESS_CLOCK.format(value) : '';
}

function durationLabel(start, now) {
  const started = new Date(start).getTime();
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function RowMeta({ row, active = false, now = 0 }) {
  const timestamp = timestampLabel(row.ts);
  return <span className="progress-row-meta">
    {active && <span className="progress-row-duration" aria-label={`已运行 ${durationLabel(row.ts, now)}`}><i aria-hidden="true" />{durationLabel(row.ts, now)}</span>}
    {timestamp && <time dateTime={new Date(row.ts).toISOString()}>{timestamp}</time>}
  </span>;
}

function ProcessDetailDrawer({ row, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useModalFocus({ dialogRef, initialFocusRef: closeRef, onClose });
  const body = typeof row.body === 'string' ? row.body.trim() : '';
  const rawToolData = row.kind === 'tool' && hasToolData(row.toolData) ? row.toolData : null;
  // Mobile already receives the bounded output markdown owned by this same
  // row projection. Do not duplicate that output in the structured tree;
  // desktop keeps both typed input and output sections in the drawer.
  const toolData = rawToolData && row.mobileOutputShown ? toolInputOnly(rawToolData) : rawToolData;
  return <div className="progress-drawer-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose?.();
  }}>
    <aside ref={dialogRef} tabIndex={-1} className="progress-drawer" role="dialog" aria-modal="true" aria-label={`过程详情：${row.line}`}>
      <header className="progress-drawer-header">
        <div><strong>{row.line}</strong>{timestampLabel(row.ts) && <small>{timestampLabel(row.ts)}</small>}</div>
        <button ref={closeRef} type="button" className="progress-drawer-close" aria-label="关闭详情" onClick={onClose}>×</button>
      </header>
      <div className="progress-drawer-body">
        {row.kind === 'tool' ? <div className="progress-tool-data">
          {toolData && <div className="progress-json-shell" aria-label="工具输入输出"><StructuredTree value={toolData} /></div>}
          {body && <div className="progress-tool-detail"><strong>执行说明</strong><MarkdownContent contentKey={`progress-detail:${row.key}:body`} text={body} /></div>}
          {!toolData && !body && <p className="progress-empty">这次调用没有返回可展示的数据。</p>}
        </div> : body ? <MarkdownContent contentKey={`progress-detail:${row.key}:body`} text={body} /> : <p className="progress-empty">这次过程没有留下可展示的正文。</p>}
      </div>
    </aside>
  </div>;
}

function TrailRow({ row, onOpen, active = false, now = 0, showTime = false }) {
  const meta = showTime ? <RowMeta row={row} active={active} now={now} /> : null;
  if (row.stateOnly) return <li className="progress-row is-state"><span className="progress-row-line">{row.line}</span>{meta}</li>;
  return <li className="progress-row"><button type="button" onClick={() => onOpen?.(row)} title="查看完整内容"><span className="progress-row-line">{row.line}</span>{meta}</button></li>;
}

function PreviewRow({ row, active, now }) {
  return <li className={`progress-row${row.stateOnly ? ' is-state' : ''}`}><span className="progress-row-line">{row.line}</span><RowMeta row={row} active={active} now={now} /></li>;
}

function ProgressTrail({ turn, title }) {
  const [open, setOpen] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const rows = progressRows(turn);
  const running = !turn.terminal;

  // A tool row keeps one stable public key while its started observation is
  // replaced by the ended observation. If the drawer is already open, keep
  // the same owner surface on the newest row (key/seq) so late detail becomes
  // visible without a second host/store or a user reopen.
  useEffect(() => {
    if (!detailRow) return;
    const next = rows.find((row) => row.key === detailRow.key);
    if (!next || Number(next.seq) === Number(detailRow.seq)) return;
    setDetailRow(next);
  }, [detailRow, rows]);

  useEffect(() => {
    if (!running || rows.length === 0) return undefined;
    setNow(Date.now());
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    return () => globalThis.clearInterval(timer);
  }, [running, rows.at(-1)?.key, rows.at(-1)?.seq]);

  if (!rows.length && !running) return null;
  const latestKey = rows.at(-1)?.key;
  const started = rows[0]?.ts;
  let content;

  if (!running) {
    content = (
      <div className="progress-trail settled">
        <button
          type="button"
          className="progress-trail-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">⤷</span>
          <span>{rows.length} 条过程记录</span>
          <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
        {open && (
          <ol className="progress-trail-list">
            {rows.map((row) => <TrailRow key={row.key} row={row} onOpen={setDetailRow} />)}
          </ol>
        )}
      </div>
    );
  } else {
    const visibleRows = open
      ? rows.map((row) => (
        <TrailRow
          key={row.key}
          row={row}
          onOpen={setDetailRow}
          active={row.key === latestKey}
          now={now}
          showTime
        />
      ))
      : rows.slice(-2).map((row) => (
        <PreviewRow key={row.key} row={row} active={row.key === latestKey} now={now} />
      ));
    const runningClassName = 'progress-trail running agent-processing-status' + (open ? ' is-open' : '');
    content = (
      <div className={runningClassName} role="status" aria-live="polite">
        <button
          type="button"
          className="progress-running-header"
          aria-label={(open ? '收起' : '展开') + '过程详情：' + (title || '任务')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <strong><i aria-hidden="true" />处理中: {title || '任务'}</strong>
          <span className="progress-running-time">
            <b>运行 {durationLabel(started, now)}</b>
            {timestampLabel(started) && <time dateTime={new Date(started).toISOString()}>{timestampLabel(started)}</time>}
          </span>
        </button>
        {rows.length > 0 && <ol className="progress-trail-list">{visibleRows}</ol>}
      </div>
    );
  }

  return <>{content}{detailRow && <ProcessDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />}</>;
}
function finalEchoObservation(observations, terminalText) {
  const answer = String(terminalText || '').trim(); const last = String(observations.at(-1)?.process?.text || '').trim();
  if (!answer || !last) return null;
  const body = last.endsWith('…[truncated]') ? last.slice(0, -'…[truncated]'.length) : last;
  return body && answer.startsWith(body) ? observations.at(-1) : null;
}

function isInterruptedTerminal(turn) {
  const payload = argsOf(turn?.terminal);
  return payload?.status === 'failed'
    && (payload.error_code === 'interrupted' || payload.reason === 'interrupted');
}

function ConversationAnswerSlot({ text, requestType = '', terminalPayload = null, contentKey }) {
  if (!terminalPayload) return <MarkdownContent contentKey={contentKey} text={text} />;
  if (Object.prototype.hasOwnProperty.call(terminalPayload, 'text') && terminalPayload.text !== '' && parseJSON(terminalPayload.text) === undefined) return <MarkdownContent contentKey={contentKey} text={String(terminalPayload.text)} />;
  return <StructuredResult requestType={requestType} payload={terminalPayload} contentKey={contentKey} />;
}

function AgentAnswer({ turn, names, fold, onDownload, onPreview, onReply, onOpen }) {
  const request = turn.request; const terminal = terminalContentEnvelope(turn);
  const stopped = isInterruptedTerminal(turn);
  const liveEnvelope = terminal || turn.provisional?.at(-1)?.envelope || null;
  const agentId = terminal?.sender?.id || liveEnvelope?.sender?.id || request.audience?.[0] || '';
  const observations = conversationObservations(turn); const terminalText = terminal && !stopped ? textContent(argsOf(terminal)) : '';
  const echo = terminal ? finalEchoObservation(observations, terminalText) : null;
  const visible = echo ? observations.slice(0, -1) : observations;
  const foldText = [...visible.map((item) => item.process.text), terminalText].filter(Boolean).join('\n\n');
  const content = visible.map(({ seq, envelope, process }) => { const slot = envelope.id || `${turn.requestId}:${seq}`; return <div key={slot} className="agent-progress-text" data-seq={seq}><ConversationAnswerSlot text={process.text} requestType={request.type} contentKey={`answer:${turn.requestId}:${slot}:body`} /></div>; });
  if (terminal && !stopped) content.push(echo ? <div key={echo.envelope.id || `${turn.requestId}:${echo.seq}`} className="agent-final-text" data-seq={echo.seq} data-answer-slot={turn.requestId}><ConversationAnswerSlot text={echo.process.text} requestType={request.type} terminalPayload={argsOf(terminal)} contentKey={`answer:${turn.requestId}:${echo.envelope.id || echo.seq}:body`} /></div> : <div key={terminal.id || `${turn.requestId}:terminal`} className="agent-final-text" data-answer-slot={turn.requestId}><StructuredResult requestType={request.type} payload={argsOf(terminal)} contentKey={`answer:${turn.requestId}:terminal:body`} /></div>);
  const answerEnvelope = terminal || liveEnvelope || { id: `${turn.requestId}:answer`, sender: { id: agentId, kind: 'agent' }, payload: { body: { text: '' } } };
  return <ReplyableMessageFrame envelope={answerEnvelope} turn={turn} onReply={terminal ? onReply : null} onOpen={onOpen}
    className={`agent-turn-bubble ${turn.terminal ? 'settled' : 'processing'}`} contentClassName="response-body"
    identity={<span className="actor-icon kind-agent">{String(nameOf(agentId, names) || 'A').slice(0, 1).toUpperCase()}</span>}
  >
    <header><strong>{nameOf(agentId, names)}</strong><small className="ai-label">AI</small>{liveEnvelope?.ts && <time>{messageTimeLabel(liveEnvelope.ts)}</time>}{turn.terminal && (stopped ? null : turn.status === 'failed' ? <span className="response-failed">处理失败</span> : <small>已完成</small>)}</header>
    {content.length > 0 && <div className="response-content"><FoldableBody id={`${turn.requestId}:response`} text={foldText} exempt={fold?.latest === true} automaticExpanded={fold?.automaticExpanded === true} expanded={fold?.overrides?.get(`${turn.requestId}:response`)} onToggle={fold?.onToggle}>{content}</FoldableBody></div>}
    {stopped && <p className="agent-stopped">✗ 已停止 · 发消息即继续</p>}
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
  return <li className={`turn-thread-item status-${child.status}`} style={{ '--thread-depth': item.depth }}><button type="button" className="turn-thread-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}><strong>{textOf(child.request) || child.request.type}</strong><small>{nameOf(child.request.sender?.id, names)} → {receivers || '—'} · {status} · {messageTimeLabel(child.request.ts)}</small></button>{open && <>{terminal ? <div className="turn-thread-result"><StructuredResult requestType={child.request.type} payload={argsOf(terminal)} contentKey={`thread:${terminal.id || child.requestId}:body`} /></div> : <p className="turn-thread-result empty">{child.terminalClosureOnly ? terminalResultState(child).error : '还没有终态。'}</p>}<ProgressTrail turn={child} title={textOf(child.request)} /></>}</li>;
}
function ThreadCalls({ root, thread, names }) {
  const [open, setOpen] = useState(false); const items = threadDepths(root, thread || []);
  if (!items.length) return null;
  const failed = items.filter((item) => item.turn.status === 'failed').length; const running = items.filter((item) => !item.turn.terminal).length;
  return <ContentFrame contained><button type="button" className={`turn-thread-toggle${failed ? ' has-failure' : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span className={running ? 'pulse' : 'pulse done'} /><span>{items.length} 次关联调用</span><small>{running ? `${running} 处理中` : failed ? `${failed} 失败` : '已完成'}</small><span aria-hidden="true">{open ? '⌃' : '⌄'}</span></button>{open && <ol className="turn-thread-list">{items.map((item) => <ThreadCall key={item.turn.requestId} item={item} names={names} />)}</ol>}</ContentFrame>;
}

function TurnCard({ turn, names, selfId, access, targetAuthority, fold, approvalState, editing, onResolve, onCancel, onControl, onEdit, onDownload, onPreview, onReply, onCreateTask, onOpen }) {
  const request = turn.request; const actorId = request.audience?.[0] || '';
  if ([TYPES.humanAsk, TYPES.humanApprove].includes(request.type) && request.audience?.includes(selfId)) return <ContentFrame><ApprovalCard turn={turn} names={names} state={approvalState} onResolve={onResolve} /></ContentFrame>;
  const pending = !turn.terminal; const local = request.local_submission_state;
  const recipients = (request.audience || []).map((id) => nameOf(id, names)).join('、');
  // WorkspaceApp rejects a reply whose sender is the current user. Keep the
  // renderer aligned with that owner contract so a self-authored request does
  // not advertise a button that can only produce a notice and no draft state.
  const requestReply = request.sender?.id === selfId ? undefined : onReply;
  // The process entry is the owner of the detail affordance. A turn without
  // an execution process must not advertise an action that openTurnDetail
  // cannot materialize; keep this gate at the row owner rather than hiding a
  // stale button with CSS or making the application invent an empty detail.
  const onOpenProcess = hasProcessSummary(turn) ? onOpen : undefined;
  return <section className={`turn-card agent-conversation-turn${request.sender?.id === selfId ? ' self' : ''} status-${turn.status || (pending ? 'pending' : 'completed')}`} data-request-id={turn.requestId} data-request-type={request.type}>
    <ReplyableMessageFrame envelope={request} turn={turn} onReply={requestReply} onCreateTask={onCreateTask} onOpen={onOpenProcess} className="request-message" identity={actorIcon(request, names)}>
      <header><strong>{nameOf(request.sender?.id, names)}</strong>{request.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{messageTimeLabel(request.ts)}</time>{recipients && <span className="recipient-label">发送给 {recipients}</span>}{local && <small>{local}</small>}</header>
      <div className="request-text"><EnvelopeBody envelope={request} fold={fold} onDownload={onDownload} onPreview={onPreview} contentKeyPrefix="request" /></div>{editing?.targetId === turn.requestId && <small className="message-editing-state">正在输入框中编辑</small>}
    </ReplyableMessageFrame>
    {pending && !local && <ContentFrame contained><div className="task-controls"><div className="task-control-buttons">{request.type === TYPES.agentAsk && onEdit && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, actorId)}>编辑</button>}{canInterrupt(turn, { access, targetAuthority }) && onControl && <button type="button" onClick={() => onControl(turn, actorId, TYPES.agentInterrupt, {})}>停止</button>}</div></div></ContentFrame>}
    {local && onCancel && <ContentFrame contained><div className="task-controls"><div className="task-control-buttons"><button type="button" onClick={() => onCancel(turn.requestId)}>取消</button></div></div></ContentFrame>}
    <AgentAnswer turn={turn} names={names} fold={fold} onDownload={onDownload} onPreview={onPreview} onReply={onReply} onOpen={onOpenProcess} />
    <ThreadCalls root={turn} thread={turn.thread} names={names} />
  </section>;
}

function Standalone({ envelope, names, selfId, continuation, fold, onDownload, onPreview, onReply, onCreateTask }) {
  const senderName = nameOf(envelope.sender?.id, names);
  return <ReplyableMessageFrame envelope={envelope} onReply={onReply} onCreateTask={onCreateTask} className={`standalone-row${continuation ? ' continuation' : ''}${envelope.sender?.id === selfId ? ' self' : ''}`} identity={continuation ? <time className="continuation-time" aria-label={`${senderName}，${messageTimeLabel(envelope.ts)}`}>{messageTimeLabel(envelope.ts)}</time> : actorIcon(envelope, names)}>
    {!continuation && <header><strong>{senderName}</strong>{envelope.sender?.kind === 'agent' && <small className="ai-label">AI</small>}<time>{messageTimeLabel(envelope.ts)}</time></header>}<EnvelopeBody envelope={envelope} fold={fold} onDownload={onDownload} onPreview={onPreview} />
  </ReplyableMessageFrame>;
}
function Narration({ rows, names }) {
  return <div className="timeline-narration">{(rows || []).map(({ seq, envelope }) => {
    const presentation = systemEventPresentation(envelope, names);
    if (presentation?.hidden) return null;
    const text = presentation?.handled ? presentation.text : textOf(envelope, names);
    if (!text) return null;
    if (presentation?.standalone) return <p key={envelope.id || seq}>{text}</p>;
    return <p key={envelope.id || seq}><strong>{nameOf(envelope.sender?.id, names)}</strong> {text}</p>;
  })}</div>;
}

export function useTimelineRowRenderer({ state, names, selfId, access = '', targetAuthority = null, presentationEditing, browsingExpandedSlots, effectiveFoldOverrides, approvalStates, latestRowID = '', onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, startEditing, toggleFold }) {
  const currentActions = { state, onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, startEditing };
  const actionsRef = useRef(currentActions);
  actionsRef.current = currentActions;
  const messageActionRevision = (typeof onReply === 'function' ? 1 : 0)
    | (typeof onCreateTask === 'function' ? 2 : 0)
    | (typeof onOpenTurn === 'function' ? 4 : 0);
  const rowRenderRevision = useCallback((_index, row) => {
    const foldIDs = row.body?.kind === 'turn'
      ? [`${row.body.turn.requestId}:body`, `${row.body.turn.requestId}:response`]
      : [`${row.body?.envelope?.id || row.id}:body`];
    return [row.contentRevision, row.layoutClass || '', row.id === latestRowID ? 1 : 0, browsingExpandedSlots.has(row.visualSlotID || row.id) ? 1 : 0, ...foldIDs.map((foldID) => effectiveFoldOverrides.get(foldID)), presentationEditing?.targetId === row.id ? presentationEditing.phase : '', approvalStates?.[row.id] || '', messageActionRevision].join('\u0001');
  }, [approvalStates, browsingExpandedSlots, effectiveFoldOverrides, latestRowID, messageActionRevision, presentationEditing]);
  const fold = useMemo(() => ({ latest: false, automaticExpanded: false, overrides: effectiveFoldOverrides, onToggle: toggleFold }), [effectiveFoldOverrides, toggleFold]);
  const renderRow = useCallback((row) => {
    const entry = row.body; const port = actionsRef.current;
    const rowFold = { ...fold, latest: row.id === latestRowID, automaticExpanded: browsingExpandedSlots.has(row.visualSlotID || row.id) };
    let content = null;
    if (entry?.kind === 'narration') content = <ContentFrame><Narration rows={state.narration} names={names} /></ContentFrame>;
    else if (entry?.kind === 'turn') content = <TurnCard turn={{ ...entry.turn, thread: entry.thread || [] }} names={names} selfId={selfId} access={access} targetAuthority={targetAuthority} fold={rowFold} approvalState={approvalStates?.[entry.turn.request.id]} editing={presentationEditing}
      onResolve={port?.onResolve ? (requestID, decision, payload) => port.onResolve(state.channelId, requestID, decision, payload) : undefined}
      onCancel={port?.onCancel ? (requestID) => port.onCancel(state.channelId, requestID) : undefined}
      onControl={port?.onTaskControl ? (turn, actorId, type, payload) => port.onTaskControl({
        channelId: state.channelId,
        turn,
        actorId,
        type,
        payload,
        controlContext: { source: 'timeline', turn, targetAuthority },
      }) : undefined}
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
  }, [access, approvalStates, browsingExpandedSlots, fold, latestRowID, names, presentationEditing, selfId, state, targetAuthority]);
  return { rowRenderRevision, renderRow };
}
