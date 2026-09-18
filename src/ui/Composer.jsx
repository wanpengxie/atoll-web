import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { FolderOpen, Upload, X } from 'lucide-react';
import { actorDisplayName } from '../model/actor-display.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { replyRecipient } from '../model/reply-target.js';
import { composerDelivery, deliverySourceLabel } from '../model/composer-target.js';
import { addRecipient, normalizeRecipients, removeRecipient, resolveRecipients } from '../model/mention-recipients.js';
import { mentionRing } from '../model/agent-selection.js';
import { resolveManagementActors } from '../model/management-actors.js';
import { diagnostic } from '../model/diagnostics.js';
import { TYPES } from '../protocol/vocab.js';
import { ModelSelector } from './ModelSelector.jsx';
import { useComposerPresentation } from './conversation/ComposerPresentationContext.jsx';
import { useReadingIntent } from './conversation/ReadingIntentContext.jsx';

// 两个 Suggestion 插件同挂一个编辑器，各自要一把键——同键会在建 view 时直接抛
// "Adding different instances of a keyed plugin"。
const MENTION_PLUGIN_KEY = new PluginKey('memberMention');
const COMMAND_PLUGIN_KEY = new PluginKey('agentCommand');

function editorDocument(text = '') {
  return {
    type: 'doc',
    content: String(text).split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

// 草稿是"正文 + 收件人"两件事。收件人恒不藏在正文里（那正是这次要治的病），
// 所以它作为独立字段随草稿一起存活，切频道回来芯片还在。
function normalizedDraft(draft) {
  if (draft && typeof draft === 'object') {
    return {
      text: String(draft.text || ''),
      doc: draft.doc?.type === 'doc' ? draft.doc : editorDocument(draft.text),
      recipients: normalizeRecipients(draft.recipients),
    };
  }
  return { text: String(draft || ''), doc: editorDocument(draft), recipients: [] };
}

function editorText(editor) {
  return editor?.getText({ blockSeparator: '\n' }) || '';
}

function mentionCandidates(rows, selfId, selectedIds, query) {
  return rows.filter((row) => (
    row.id !== selfId
    && (row.kind === 'agent' || row.kind === 'human')
    && !selectedIds.includes(row.id)
    && `${row.name || ''} ${row.id}`.toLowerCase().includes(query)
  ));
}

const AGENT_COMMANDS = Object.freeze([
  { command: 'compact', type: TYPES.agentCompact, label: '压缩上下文', description: '保留当前对话，压缩较早的上下文' },
  { command: 'new', type: TYPES.agentNew, label: '新建对话', description: '保留当前 Agent，换成一段全新会话' },
  // 这一条恒不问 agent 声明了什么词——它正是给"agent 不响应了"准备的。停止
  // （agent.interrupt）要那个 agent 自己把它从队列里读出来，卡死的时候恰恰读不到；
  // restart 的收件人是频道的 system actor，恒不经过卡住的那一位。
  { command: 'restart', type: TYPES.member.restart, scope: 'channel', label: '重启 Agent', description: 'Agent 卡住不响应时给它换一届任期，手上的活全部作废；账本与文件不动' },
]);

function commandCandidates(types, query) {
  const supported = new Set(types || []);
  const needle = String(query || '').toLowerCase();
  return AGENT_COMMANDS.filter((row) => (row.scope === 'channel' || supported.has(row.type)) && `${row.command} ${row.label}`.toLowerCase().includes(needle));
}

// 频道面的斜杠命令。收件人恒是本频道的 system actor：成员类的词它自己答，
// 空间类的词它转交 c0 的 registrar。
export function slashCommand(value) {
  const [verb, ...rest] = value.trim().split(/\s+/);
  if (verb === '/compact') {
    if (rest.length) throw new TypeError('用法：/compact');
    return { msgType: TYPES.agentCompact, payload: {}, target: 'agent' };
  }
  if (verb === '/new') {
    if (rest.length) throw new TypeError('用法：/new');
    return { msgType: TYPES.agentNew, payload: {}, target: 'agent' };
  }
  if (verb === '/model') {
    if (rest.length > 2) throw new TypeError('用法：/model [model] [effort]');
    return { msgType: TYPES.agentSelect, payload: { ...(rest[0] ? { model: rest[0] } : {}), ...(rest[1] ? { effort: rest[1] } : {}) }, target: 'agent' };
  }
  // 重启：说的是"对哪个 agent 做"，收件人却是频道的 system actor——目标 agent
  // 此刻可能正卡着，恒不能把这条也交给它。member 由判据链填（与消息发送同源）。
  if (verb === '/restart') {
    if (rest.length) throw new TypeError('用法：/restart（重启当前目标 Agent）');
    return { msgType: TYPES.member.restart, payload: {}, member: 'target' };
  }
  if (verb === '/fork' || verb === '/context' || verb === '/status') {
    if (rest.length) throw new TypeError(`用法：${verb}`);
    return { msgType: verb === '/fork' ? TYPES.agentFork : verb === '/context' ? TYPES.agentContext : TYPES.describe, payload: {}, target: 'agent' };
  }
  if (verb === '/introduce') {
    const declId = rest[0];
    if (!declId || rest.length > 1) throw new TypeError('用法：/introduce <decl_id>');
    return { msgType: TYPES.member.create, payload: { decl_id: declId } };
  }
  if (verb === '/admit') {
    const principal = rest[0];
    if (!principal || rest.length > 1) throw new TypeError('用法：/admit <principal>');
    return { msgType: TYPES.member.admit, payload: { principal } };
  }
  if (verb === '/members') {
    if (rest.length) throw new TypeError('用法：/members');
    return { msgType: TYPES.member.list, payload: {} };
  }
  if (verb === '/channels') {
    if (rest.length > 1) throw new TypeError('用法：/channels [parent_id]');
    return { msgType: TYPES.channel.list, payload: rest[0] ? { parent_id: rest[0] } : {} };
  }
  return null;
}

export const Composer = React.memo(function Composer({ channelId, roster, selfId, attachments = [], pending = [], draft = '', draftRevision = 0, onDraftChange, disabled = false, disabledReason = '当前频道不可写', canEditDraft = !disabled, canDurablyAccept = !disabled, canTransmit = !disabled, onSend, onRetry, onPreviewAttachment, onRemoveAttachment, onClearAttachments, onUploadAttachments, onOpenChannelFiles, agentSelection = null, editMode = null, replyTarget = null, onCancelReply, onReplySent }) {
  const readingIntent = useReadingIntent();
  const composerPresentation = useComposerPresentation();
  const dragDepthRef = useRef(0);
  const initialDraft = useMemo(() => normalizedDraft(draft), [channelId]);
  const composingRef = useRef(false);
  const compositionFrameRef = useRef(0);
  const draftIdleRef = useRef(null);
  const lastDraftFingerprintRef = useRef(JSON.stringify(initialDraft.doc));
  const editorRevisionRef = useRef(Number(draft?.editorRevision || 0));
  const attachmentFingerprintRef = useRef(JSON.stringify(attachments.map((row) => row.resource_id || row.id || row.name)));
  const replyFingerprintRef = useRef(JSON.stringify(replyTarget || null));
  const restoredDraftRevisionRef = useRef(Number(draftRevision || 0));
  const editModeRef = useRef(editMode);
  const replyTargetRef = useRef(replyTarget);
  const attachmentsRef = useRef(attachments);
  const onDraftChangeRef = useRef(onDraftChange);
  const cancelReplyRef = useRef(onCancelReply);
  const mentionContextRef = useRef({ roster: [], selfId: '', selectedIds: [], activeCandidate: 0, editing: false });
  const suggestionSessionRef = useRef(null);
  // 屏幕上有没有一张打开的菜单。回车该给菜单还是该发消息，恒以"人看见了什么"为准：
  // ProseMirror 的 editorProps.handleKeyDown 排在插件之前，所以这一判必须在这里做，
  // 而不是等插件的 onKeyDown（那时回车已经被这里放过去了）。没有候选的 @ 恒不算菜单
  // ——"@2026 的计划" 按回车就该发出去，恒不被一张空菜单吞掉。
  const menuOpenRef = useRef({ mention: false, command: false });
  const commandContextRef = useRef({ types: [], activeCandidate: 0 });
  const commandSessionRef = useRef(null);
  const submitRef = useRef(() => {});
  const committedEventOwnerRef = useRef(null);
  const normalDraftRef = useRef(null);
  // 收件人条上的芯片。它是 @ 这个动词的产物，恒不是正文的函数——正文里的 @ 只是 @。
  const [recipients, setRecipients] = useState(() => initialDraft.recipients);
  const recipientsRef = useRef(initialDraft.recipients);
  // 编辑器配置只建一次（deps 是 channelId），里面的回调恒经 ref 打到本次渲染的闭包。
  const recipientActionsRef = useRef({ add: () => {}, dropLast: () => false });
  // ESC 摘掉的那个 @ 记在这里（记 token 起点）：菜单收起，"@" 留在正文里当字面量，
  // 继续打字恒不再把它重新认成一次 mention。token 结束（空格/删掉）时 onExit 清掉。
  const dismissedMentionRef = useRef(null);
  const [error, setError] = useState('');
  const [sendState, setSendState] = useState('idle');
  // Durable acceptance is the only critical section. Transport progress for a
  // previously accepted row must never keep the next message disabled: users
  // can queue several immutable outbox rows while an earlier receipt/feed is
  // slow. The ref closes the same-tick Enter/click race before React commits.
  const [accepting, setAccepting] = useState(false);
  const acceptingRef = useRef(false);
  // Presentation-only monotonic signal for the exact durable draft version
  // that is about to clear. ConversationSurface uses it to animate the input
  // contraction without coupling draft ownership to viewport geometry.
  const [sendClearRevision, setSendClearRevision] = useState(0);
  const sendClearRevisionRef = useRef(0);
  // 拆发批次的逐条跟踪（协议 §3.2.1）：提交层吞掉入账前错误，Promise 看不到，
  // 只有各条 submission 的状态知道谁被拒——批次里任何一条 rejected 都要带目标名报出。
  const [sentBatch, setSentBatch] = useState([]); // all unsettled [{id, label}]
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [activeCommandCandidate, setActiveCommandCandidate] = useState(0);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachmentQueueRef = useRef(Promise.resolve());
  const attachmentJobsRef = useRef(0);
  const [fileDragActive, setFileDragActive] = useState(false);
  // 正文归 ProseMirror DOM 所有，不在 React 中维护第二份 text 镜像。
  // 外壳只关心空/非空边界和当前光标处是否正在输入 @ 查询。
  const [hasText, setHasText] = useState(Boolean(initialDraft.text.trim()));
  const [query, setQuery] = useState(null);
  const [commandQuery, setCommandQuery] = useState(null);
  const hasTextRef = useRef(Boolean(initialDraft.text.trim()));
  const queryRef = useRef(null);

  function updateHasText(next) {
    if (hasTextRef.current === next) return;
    hasTextRef.current = next;
    setHasText(next);
  }

  function updateQuery(next) {
    if (queryRef.current === next) return;
    queryRef.current = next;
    setQuery(next);
  }

  function cancelDraftIdle() {
    const pendingIdle = draftIdleRef.current;
    if (!pendingIdle) return;
    if (pendingIdle.kind === 'idle') globalThis.cancelIdleCallback?.(pendingIdle.id);
    else clearTimeout(pendingIdle.id);
    draftIdleRef.current = null;
  }

  function announceDurableClear() {
    const revision = sendClearRevisionRef.current + 1;
    sendClearRevisionRef.current = revision;
    // Synchronous presentation seam: the surface freezes the already-painted
    // input block before ProseMirror removes its content. Composer publishes
    // no geometry and never writes scroll position; the monotonic revision in
    // the following React commit tells the surface when to animate to the new
    // natural height.
    composerPresentation?.prepareSendClear(revision);
    setSendClearRevision(revision);
  }

  function syncEditorSnapshot(current) {
    if (!current || current.isDestroyed) return;
    const value = editorText(current);
    const document = current.getJSON();
    const fingerprint = JSON.stringify(document);
    if (fingerprint === lastDraftFingerprintRef.current) return;
    lastDraftFingerprintRef.current = fingerprint;
    if (!editModeRef.current) onDraftChangeRef.current?.({
      text: value,
      doc: document,
      recipients: recipientsRef.current,
      attachments: attachmentsRef.current,
      replyTarget: replyTargetRef.current,
      editorRevision: editorRevisionRef.current,
    });
    setError('');
    setSendState('idle');
  }

  function syncEditorPresentation(current) {
    if (!current || current.isDestroyed) return;
    const value = editorText(current);
    // 这里只更新发送按钮和 @ 候选所需的轻量状态。getJSON、JSON.stringify、
    // Mention 树扫描和草稿持久化都不属于字符上屏链路。
    updateHasText(Boolean(value.trim()));
    setError('');
    setSendState('idle');
  }

  function persistDraftWhenIdle(current) {
    cancelDraftIdle();
    const persist = () => {
      draftIdleRef.current = null;
      if (!current || current.isDestroyed || composingRef.current || current.view.composing) return;
      syncEditorSnapshot(current);
    };
    if (typeof globalThis.requestIdleCallback === 'function') {
      draftIdleRef.current = {
        kind: 'idle',
        id: globalThis.requestIdleCallback(persist, { timeout: 300 }),
      };
    } else {
      // Safari / jsdom fallback。RAF 后再进入一个 macrotask，确保浏览器有机会
      // 先提交 ProseMirror 的 composition DOM，而不是在同一帧继续做业务同步。
      draftIdleRef.current = { kind: 'timeout', id: setTimeout(persist, 0) };
    }
  }

  function syncAfterComposition(current) {
    cancelAnimationFrame(compositionFrameRef.current);
    const waitForEditor = () => {
      if (!current || current.isDestroyed) return;
      // ProseMirror 自己拥有输入 DOM。compositionend 后先等它拆除临时
      // composition DOM，再空出完整的一帧让浏览器把确认的文字画出来。
      // 草稿 JSON、React 外壳和高度测量只能发生在那次绘制之后，否则会让
      // 中文确认上屏被业务同步阻塞，而英文输入不会经过这条路径。
      if (current.view.composing) {
        compositionFrameRef.current = requestAnimationFrame(waitForEditor);
        return;
      }
      compositionFrameRef.current = requestAnimationFrame(() => {
        compositionFrameRef.current = 0;
        composingRef.current = false;
        syncEditorPresentation(current);
        persistDraftWhenIdle(current);
      });
    };
    compositionFrameRef.current = requestAnimationFrame(waitForEditor);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false,
      }),
      // @ 是一个动词，不是一段文本：它只负责打开选择框。选中之后 "@查询" 从正文里
      // 删掉，人上到收件人条；正文自此恒是纯文本，粘一段带 @ 的东西、写邮箱、写
      // "@codex /compact" 都只是字符，恒不再挡住发送。
      Extension.create({
        name: 'memberMentions',
        addProseMirrorPlugins() {
          return [Suggestion({
            editor: this.editor,
            pluginKey: MENTION_PLUGIN_KEY,
            char: '@',
            items: ({ query: searchQuery }) => {
              const context = mentionContextRef.current;
              return mentionCandidates(context.roster, context.selfId, context.selectedIds, searchQuery.toLowerCase());
            },
            command: ({ editor: current, range, props }) => {
              current.chain().focus().deleteRange(range).run();
              recipientActionsRef.current.add(props);
            },
            render: () => ({
              onStart: (props) => {
                if (dismissedMentionRef.current === props.range.from) return;
                dismissedMentionRef.current = null;
                suggestionSessionRef.current = props;
                updateQuery(props.query.toLowerCase());
                setActiveCandidate(0);
              },
              onUpdate: (props) => {
                if (dismissedMentionRef.current === props.range.from) return;
                suggestionSessionRef.current = props;
                updateQuery(props.query.toLowerCase());
              },
              onExit: () => {
                dismissedMentionRef.current = null;
                suggestionSessionRef.current = null;
                updateQuery(null);
              },
              onKeyDown: ({ event, range }) => {
                const session = suggestionSessionRef.current;
                if (!session) return false;
                // ESC：这一个 @ 我不是在叫人。菜单收起，字面量留在正文里继续打
                // ——邮箱、@ts-ignore、"@ 一下他" 都得能写。
                if (event.key === 'Escape') {
                  event.preventDefault();
                  dismissedMentionRef.current = (range || session.range)?.from ?? null;
                  suggestionSessionRef.current = null;
                  updateQuery(null);
                  return true;
                }
                const context = mentionContextRef.current;
                const rows = mentionCandidates(context.roster, context.selfId, context.selectedIds, session.query.toLowerCase()).slice(0, 8);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (rows.length) {
                    const direction = event.key === 'ArrowDown' ? 1 : -1;
                    setActiveCandidate((current) => (current + direction + rows.length) % rows.length);
                  }
                  return true;
                }
                if (event.key === 'Enter') {
                  const row = rows[context.activeCandidate] || rows[0];
                  if (!row) return false;
                  event.preventDefault();
                  session.command({ id: row.id, label: actorDisplayName(row), kind: row.kind });
                  return true;
                }
                return false;
              },
            }),
          })];
        },
      }),
      Extension.create({
        name: 'agentCommands',
        addProseMirrorPlugins() {
          return [Suggestion({
            editor: this.editor,
            pluginKey: COMMAND_PLUGIN_KEY,
            char: '/',
            startOfLine: true,
            allowSpaces: false,
            items: ({ query: searchQuery }) => commandCandidates(commandContextRef.current.types, searchQuery),
            command: ({ editor: current, range, props }) => {
              current.chain().focus().insertContentAt(range, `/${props.command} `).run();
            },
            render: () => ({
              onStart: (props) => {
                commandSessionRef.current = props;
                setCommandQuery(props.query.toLowerCase());
                setActiveCommandCandidate(0);
              },
              onUpdate: (props) => {
                commandSessionRef.current = props;
                setCommandQuery(props.query.toLowerCase());
              },
              onExit: () => {
                commandSessionRef.current = null;
                setCommandQuery(null);
              },
              onKeyDown: ({ event }) => {
                const session = commandSessionRef.current;
                if (!session) return false;
                const context = commandContextRef.current;
                const rows = commandCandidates(context.types, session.query);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (rows.length) {
                    const direction = event.key === 'ArrowDown' ? 1 : -1;
                    setActiveCommandCandidate((current) => (current + direction + rows.length) % rows.length);
                  }
                  return true;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const row = rows[context.activeCandidate] || rows[0];
                  if (row) session.command(row);
                  return true;
                }
                return false;
              },
            }),
          })];
        },
      }),
      Placeholder.configure({ placeholder: '输入消息；@ 选择成员，/ 使用命令' }),
    ],
    content: initialDraft.doc,
    editable: Boolean(channelId) && canEditDraft,
    immediatelyRender: false,
    // 编辑器 DOM 由 ProseMirror 直接维护；外围 React 只订阅必要的派生状态。
    // 明确关闭逐 transaction 的 React 重绘，避免输入与工作区共享渲染节拍。
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        'aria-label': '消息',
        'aria-multiline': 'true',
        'data-testid': 'composer-input',
        class: 'composer-editor',
        role: 'textbox',
      },
      handleKeyDown: (view, event) => {
        // 光标顶在正文最前面再按退格 = 摘掉最后一枚收件人芯片。收件人不在正文里，
        // 但摘除它的手势恒该在正文里也有一个入口（芯片上的 × 是另一个）。
        if (event.key === 'Backspace' && !event.isComposing) {
          const { empty, from } = view.state.selection;
          if (empty && from <= 1 && recipientActionsRef.current.dropLast()) {
            event.preventDefault();
            return true;
          }
        }
        const menus = menuOpenRef.current;
        if (event.key === 'Escape' && !menus.mention && !menus.command && replyTargetRef.current) {
          event.preventDefault();
          cancelReplyRef.current?.();
          return true;
        }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false;
        // 菜单开着就把回车交还给 Suggestion 插件；否则回车恒是发送。
        if (menus.mention || menus.command) return false;
        event.preventDefault();
        event.stopPropagation();
        submitRef.current();
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      // 输入法合成期间的文字只是临时态。此时同步 React 会重绘候选菜单和
      // Composer 外壳，也可能干扰浏览器维护的 composition DOM。React 的
      // composingRef 要持续到确认文字完成首次绘制，覆盖 ProseMirror 已经提前
      // 清掉 view.composing、但浏览器尚未 paint 的窗口。
      if (composingRef.current || current.view.composing) return;
      editorRevisionRef.current += 1;
      syncEditorPresentation(current);
      persistDraftWhenIdle(current);
    },
  }, [channelId]);
  // 芯片按当前名册重解：名字随成员改名走，这个 id 不在名册里了就标 missing
  // ——恒不静默把一个收件人丢掉再退回默认目标。
  const mentions = useMemo(() => resolveRecipients(recipients, roster), [recipients, roster]);
  // 参数面板目标（判据链 §2.1）：mention 环与 App 共用同一个函数；无 @ 落到 App
  // 算的默认环（筛选 > 手选 > 最近交互 > 唯一 agent）。原则：右下角显示谁，
  // 没 @ 过人时回车就发给谁。
  const fallbackAgent = useMemo(() => roster.find((row) => row.id === agentSelection?.fallbackAgentId && row.kind === 'agent') || null, [agentSelection?.fallbackAgentId, roster]);
  const parameterTarget = useMemo(() => {
    const mentioned = mentionRing(mentions.filter((row) => !row.missing));
    if (mentioned) return mentioned;
    if (fallbackAgent) return { kind: 'single', agent: fallbackAgent };
    const agents = roster.filter((row) => row.kind === 'agent');
    if (agents.length === 1) return { kind: 'single', agent: agents[0] };
    return { kind: 'none' };
  }, [mentions, fallbackAgent, roster]);
  const parameterAgent = parameterTarget.kind === 'single' ? parameterTarget.agent : null;
  const currentReplyRecipient = useMemo(() => replyRecipient(replyTarget, roster), [replyTarget?.senderId, roster]);
  const effectiveParameterAgent = currentReplyRecipient?.kind === 'agent' ? currentReplyRecipient : replyTarget ? null : parameterAgent;
  const effectiveParameterTarget = currentReplyRecipient?.kind === 'agent'
    ? { kind: 'single', agent: currentReplyRecipient }
    : replyTarget ? { kind: 'none' } : parameterTarget;
  useEffect(() => { agentSelection?.onTargetChange?.(effectiveParameterAgent?.id || ''); }, [effectiveParameterAgent?.id, agentSelection?.onTargetChange]);
  // 收件人横幅：参数面板答"给谁调参"，横幅答"回车发给谁"。两个问题在只有一个
  // agent 时同解，在「@ 了三个人」「@ 的全是人类」这些格子上并不同解，所以恒
  // 各算各的，横幅这一边与 submit 同源（composer-target.js）。
  const delivery = useMemo(() => composerDelivery({
    recipients: mentions,
    replyTarget,
    replyRecipient: currentReplyRecipient,
    fallbackAgent,
    fallbackSource: fallbackAgent ? (agentSelection?.fallbackAgentSource || '') : '',
  }), [mentions, replyTarget, currentReplyRecipient, fallbackAgent, agentSelection?.fallbackAgentSource]);
  const deliveryLabel = deliverySourceLabel(delivery.source);
  // 芯片是 @ 亲手放上去的，恒逐个显示（要能逐个摘掉）；派生出来的默认目标只有
  // 一个名字，仍是一枚不可摘的芯片。
  const deliveryText = delivery.kind === 'none' ? '⚠ 无收件人'
    : delivery.kind === 'lost' ? `⚠ @${delivery.lostName} 已不在`
      : `@${actorDisplayName(delivery.rows[0])}${delivery.rows.length > 1 ? ` +${delivery.rows.length - 1}` : ''}`;
  const removableRows = delivery.source === 'mention' ? delivery.rows : [];
  // 名单和理由都住在 title 里：屏幕上恒只有一个名字，要核对的时候鼠标停一下。
  const deliveryTitle = delivery.kind === 'none' ? '还没有收件人：@ 一位成员，或在右下角选择目标 Agent'
    : delivery.kind === 'lost' ? `@${delivery.lostName} 已不在本频道，取消回复后重新选择收件人`
      : [delivery.rows.map((row) => `@${actorDisplayName(row)}`).join('、'), deliveryLabel].filter(Boolean).join(' · ');
  const matchingCandidates = (searchQuery) => mentionCandidates(roster, selfId, mentions.map((row) => row.id), searchQuery || '');
  const candidates = useMemo(() => matchingCandidates(query), [mentions, query, roster, selfId]);
  const commands = useMemo(() => commandCandidates(agentSelection?.supportedTypes, commandQuery), [agentSelection?.supportedTypes, commandQuery]);
  const eventOwnerCandidate = {
    ownerKey: `${String(channelId || '')}\u0000${String(selfId || '')}`,
    editMode,
    replyTarget,
    attachments,
    onDraftChange,
    onCancelReply,
    mentionContext: { roster, selfId, selectedIds: mentions.map((row) => row.id), activeCandidate, editing: Boolean(editMode) },
    menuOpen: { mention: query != null && candidates.length > 0, command: commandQuery != null && commands.length > 0 },
    commandContext: { types: agentSelection?.supportedTypes || [], activeCandidate: activeCommandCandidate },
    submit,
    recipientActions: {
      add: (row) => commitRecipients(addRecipient(recipientsRef.current, row)),
      dropLast: () => {
        const rows = recipientsRef.current;
        if (!rows.length) return false;
        return commitRecipients(rows.slice(0, -1));
      },
    },
  };
  useLayoutEffect(() => {
    const committed = eventOwnerCandidate;
    committedEventOwnerRef.current = committed;
    editModeRef.current = committed.editMode;
    replyTargetRef.current = committed.replyTarget;
    attachmentsRef.current = committed.attachments;
    onDraftChangeRef.current = committed.onDraftChange;
    cancelReplyRef.current = committed.onCancelReply;
    mentionContextRef.current = committed.mentionContext;
    menuOpenRef.current = committed.menuOpen;
    commandContextRef.current = committed.commandContext;
    recipientActionsRef.current = committed.recipientActions;
    submitRef.current = committed.submit;
    return () => {
      if (committedEventOwnerRef.current !== committed) return;
      committedEventOwnerRef.current = null;
      editModeRef.current = null;
      replyTargetRef.current = null;
      attachmentsRef.current = [];
      onDraftChangeRef.current = null;
      cancelReplyRef.current = null;
      mentionContextRef.current = { roster: [], selfId: '', selectedIds: [], activeCandidate: 0, editing: false };
      menuOpenRef.current = { mention: false, command: false };
      commandContextRef.current = { types: [], activeCandidate: 0 };
      recipientActionsRef.current = { add: () => {}, dropLast: () => false };
      submitRef.current = () => {};
    };
  });
  const sentRows = sentBatch;
  const trackedSubmissions = sentRows
    .map((row) => pending.find((item) => item.messageId === row.id))
    .filter(Boolean);
  const uncertainSubmission = trackedSubmissions.find((item) => item.state === 'uncertain') || null;

  useEffect(() => { setActiveCandidate(0); }, [query]);
  useEffect(() => { setActiveCommandCandidate(0); }, [commandQuery]);
  useEffect(() => {
    if (!replyTarget || editMode || !editor) return;
    setError('');
    requestAnimationFrame(() => editor.commands.focus('end'));
  }, [replyTarget?.sourceId, editMode, editor]);

  const editTargetId = editMode?.session?.targetId || '';
  const editBusy = Boolean(editMode && editMode.session?.phase !== 'editing');

  useEffect(() => {
    if (!editor) return;
    if (editTargetId) {
      if (!normalDraftRef.current) normalDraftRef.current = { doc: editor.getJSON(), text: editorText(editor), recipients: recipientsRef.current };
      const next = editorDocument(editMode.session.text);
      lastDraftFingerprintRef.current = JSON.stringify(next);
      editor.commands.setContent(next, { emitUpdate: false });
      updateHasText(Boolean(editMode.session.text.trim()));
      updateQuery(null);
      recipientsRef.current = [];
      setRecipients([]);
      setError('');
      setSendState(editMode.session.phase === 'editing' ? 'idle' : 'sending');
      return;
    }
    if (normalDraftRef.current) {
      const saved = normalDraftRef.current;
      normalDraftRef.current = null;
      lastDraftFingerprintRef.current = JSON.stringify(saved.doc);
      editor.commands.setContent(saved.doc, { emitUpdate: false });
      updateHasText(Boolean(saved.text.trim()));
      updateQuery(null);
      recipientsRef.current = saved.recipients;
      setRecipients(saved.recipients);
      setError('');
      setSendState('idle');
      // The cancel button is removed with editMode. Return focus to the
      // restored normal draft instead of leaving it on document.body.
      requestAnimationFrame(() => {
        if (!editor.isDestroyed && !editModeRef.current) editor.commands.focus('end');
      });
    }
  }, [editor, editTargetId]);

  useEffect(() => {
    if (!editMode) return;
    setSendState(editMode.session.phase === 'editing' ? 'idle' : 'sending');
  }, [editMode?.session?.phase]);

  useEffect(() => {
    if (!editor || !editTargetId || editBusy) return undefined;
    // The edit text is installed while the remote hold is still pending and
    // the editor is intentionally non-editable. Focus only after that same
    // edit session becomes writable; keying by target prevents a late focus
    // from an obsolete lease from landing in a replacement/channel session.
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed
        && editModeRef.current?.session?.targetId === editTargetId
        && editModeRef.current?.session?.phase === 'editing') {
        editor.commands.focus('end');
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [editBusy, editTargetId, editor]);

  useEffect(() => {
    cancelAnimationFrame(compositionFrameRef.current);
    cancelDraftIdle();
    compositionFrameRef.current = 0;
    lastDraftFingerprintRef.current = JSON.stringify(initialDraft.doc);
    recipientsRef.current = initialDraft.recipients;
    setRecipients(initialDraft.recipients);
    updateHasText(Boolean(initialDraft.text.trim()));
    dismissedMentionRef.current = null;
    suggestionSessionRef.current = null;
    updateQuery(null);
    setError('');
    setSendState('idle');
    acceptingRef.current = false;
    setAccepting(false);
    setSentBatch([]);
    editorRevisionRef.current = Number(draft?.editorRevision || 0);
  }, [channelId]);

  useEffect(() => {
    const revision = Number(draftRevision || 0);
    if (!editor || revision <= restoredDraftRevisionRef.current) return;
    restoredDraftRevisionRef.current = revision;
    // IndexedDB restoration is allowed to fill a pristine editor only. It can
    // never replace text the user entered while restoration was in flight.
    if (editorRevisionRef.current !== 0 || editorText(editor).trim() || recipientsRef.current.length) return;
    const restored = normalizedDraft(draft);
    if (!restored.text && !restored.recipients.length) return;
    editorRevisionRef.current = Number(draft?.editorRevision || 0);
    lastDraftFingerprintRef.current = JSON.stringify(restored.doc);
    editor.commands.setContent(restored.doc, { emitUpdate: false });
    recipientsRef.current = restored.recipients;
    setRecipients(restored.recipients);
    updateHasText(Boolean(restored.text.trim()));
  }, [draft, draftRevision, editor]);

  useEffect(() => {
    const fingerprint = JSON.stringify(attachments.map((row) => row.resource_id || row.id || row.name));
    if (fingerprint === attachmentFingerprintRef.current) return;
    attachmentFingerprintRef.current = fingerprint;
    const durableFingerprint = JSON.stringify((draft?.attachments || [])
      .map((row) => row.resource_id || row.id || row.name));
    // Upload completion publishes only after the same attachment set has been
    // merged into the durable draft. That committed projection must not turn
    // around and create a redundant second draft writer.
    if (fingerprint === durableFingerprint) return;
    editorRevisionRef.current += 1;
    if (!editModeRef.current && editor && !editor.isDestroyed) onDraftChangeRef.current?.({
      text: editorText(editor),
      doc: editor.getJSON(),
      recipients: recipientsRef.current,
      attachments,
      replyTarget: replyTargetRef.current,
      editorRevision: editorRevisionRef.current,
    });
  }, [attachments, draft?.attachments]);

  useEffect(() => {
    const fingerprint = JSON.stringify(replyTarget || null);
    if (fingerprint === replyFingerprintRef.current) return;
    replyFingerprintRef.current = fingerprint;
    editorRevisionRef.current += 1;
    if (!editModeRef.current && editor && !editor.isDestroyed) onDraftChangeRef.current?.({
      text: editorText(editor),
      doc: editor.getJSON(),
      recipients: recipientsRef.current,
      attachments: attachmentsRef.current,
      replyTarget,
      editorRevision: editorRevisionRef.current,
    });
  }, [editor, replyTarget]);

  useEffect(() => () => {
    cancelAnimationFrame(compositionFrameRef.current);
    cancelDraftIdle();
  }, []);

  useEffect(() => {
    if (!editor) return;
    const editable = Boolean(channelId)
      && canEditDraft
      && (!editMode || (!editBusy && canTransmit));
    // Editor availability is presentation state, not an editor transaction.
    // Emitting an update here would advance editorRevision and make the exact
    // accepted snapshot look like a newer user draft; it would also clear a
    // just-published acceptance error via onUpdate.
    editor.setEditable(editable, false);
    editor.view.dom.setAttribute('aria-disabled', String(!editable));
  }, [canEditDraft, canTransmit, channelId, editor, editMode, editBusy]);

  useEffect(() => {
    if (!sentRows.length) return undefined;
    const tracked = sentRows.map((row) => ({ ...row, submission: pending.find((item) => item.messageId === row.id) }));
    const rejected = tracked.filter((row) => row.submission?.state === 'rejected');
    if (rejected.length) {
      setSendState('error');
      setError(`发送失败：${rejected.map((row) => `${row.label ? `@${row.label} ` : ''}${row.submission.error?.detail || row.submission.error?.message || '被拒绝'}`).join('；')}`);
      return undefined;
    }
    const inFlight = tracked.filter((row) => row.submission);
    if (inFlight.length) {
      if (inFlight.some((row) => row.submission.state === 'queued')) setSendState('queued');
      else if (inFlight.some((row) => row.submission.state === 'uncertain')) setSendState('uncertain');
      else if (inFlight.some((row) => row.submission.state === 'delayed')) setSendState('delayed');
      else setSendState(inFlight.some((row) => row.submission.state === 'transmitting') ? 'transmitting' : 'accepted');
      return undefined;
    }
    // Once every tracked outbox row has disappeared, the ledger has confirmed
    // the submission. This is true even when reconciliation beats the missing
    // receipt: keeping the local `sending` flag in that race permanently
    // disables the composer after the message and its reply are already shown.
    setSendState('landed');
    const timer = setTimeout(() => { setSendState('idle'); setSentBatch([]); }, 2_500);
    return () => clearTimeout(timer);
  }, [pending, sentBatch]);

  // 收件人的唯一写入口。芯片变了就立刻落草稿——它和正文一样是草稿的一部分，
  // 切走再回来恒还在。
  function commitRecipients(next) {
    if (next === recipientsRef.current) return false;
    recipientsRef.current = next;
    editorRevisionRef.current += 1;
    setRecipients(next);
    setError('');
    if (!editModeRef.current && editor && !editor.isDestroyed) {
      onDraftChangeRef.current?.({
        text: editorText(editor),
        doc: editor.getJSON(),
        recipients: next,
        attachments: attachmentsRef.current,
        replyTarget: replyTargetRef.current,
        editorRevision: editorRevisionRef.current,
      });
    }
    return true;
  }

  function pick(row) {
    suggestionSessionRef.current?.command({ id: row.id, label: actorDisplayName(row), kind: row.kind });
  }

  function dropRecipient(id) {
    commitRecipients(removeRecipient(recipientsRef.current, id));
    editor?.commands.focus();
  }

  async function submit() {
    // 提交读取编辑器真相，而不是可能刻意晚一帧同步的 React 草稿快照。
    // 这样中文刚确认就按 Enter，也不会丢掉最后一个字。
    const value = editorText(editor).trim();
    if (editMode) {
      if (!value || !channelId || !canTransmit || editBusy || acceptingRef.current) return;
      acceptingRef.current = true;
      setAccepting(true);
      setError('');
      setSendState('sending');
      try {
        await editMode.onSave(value);
      } catch (failure) {
        setError(failure.message || String(failure));
        setSendState('error');
      } finally {
        acceptingRef.current = false;
        setAccepting(false);
      }
      return;
    }
    if ((!value && !attachments.length)
      || !channelId
      || !canDurablyAccept
      || attachmentBusy
      || acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    setError('');
    setSendState('sending');
    // Send-start is the sole producer of a bottom intent and runs before the
    // first await. Durable acceptance may only correlate stable ids with this
    // frozen token; receipt/feed/retry paths cannot mint another intent.
    const readingIntentToken = readingIntent?.composerSendStarted?.(channelId) || null;
    diagnostic('debug', 'submission.composer_send_started', {
      channelId,
      activationID: readingIntentToken?.activationID || '',
      inputEpoch: readingIntentToken?.inputEpoch,
      intentRevision: readingIntentToken?.intentRevision,
    });
    // The current editor version is about to be consumed atomically with the
    // outbox rows. A queued idle write for that same version must not run
    // afterwards and resurrect the just-sent text as a draft.
    cancelDraftIdle();
    let durableMessageIDs = [];

    try {
      const acceptedEditorRevision = editorRevisionRef.current;
      const draftSnapshot = {
        text: value,
        doc: editor?.getJSON() || editorDocument(value),
        recipients: recipientsRef.current,
        attachments,
        replyTarget,
        editorRevision: acceptedEditorRevision,
      };
      const persistedDraft = await onDraftChange?.(draftSnapshot);
      const acceptedDraftRevision = Number(persistedDraft?.revision ?? draftRevision);
      const slash = slashCommand(value);
      if (slash) {
        if (replyTarget) throw new TypeError('回复模式下不能使用斜杠命令，请先取消回复');
        if (attachments.length) throw new TypeError('斜杠命令不能携带附件，请先移除附件');
        let recipient;
        if (slash.target === 'agent') {
          // 与消息发送同一判据（§2.2）：@ 唯一 agent 优先，否则参数面板目标。
          recipient = parameterAgent;
          if (!recipient) throw new TypeError('请 @ 一个 Agent，或在右下角选择目标 Agent');
        } else recipient = resolveManagementActors(roster).system;
        let payload = slash.payload;
        if (slash.member) {
          const member = parameterAgent;
          if (!member) throw new TypeError('请 @ 一个 Agent，或在右下角选择目标 Agent');
          payload = { ...payload, member: member.id };
        }
        const messageId = await onSend({
          channelId,
          text: value,
          msgType: slash.msgType,
          audience: [recipient.id],
          targetLabel: recipient.name || recipient.id,
          payload,
          draftRevision: acceptedDraftRevision,
          editorRevision: acceptedEditorRevision,
        });
        if (!messageId) throw new Error('发送队列未返回消息编号');
        durableMessageIDs = [messageId];
        if (messageId) {
          const readingAccepted = readingIntent?.composerAccepted?.(channelId, [messageId], readingIntentToken) === true;
          diagnostic('debug', 'submission.composer_durable_accepted', {
            channelId,
            messageIds: [messageId],
            readingAccepted,
          });
        }
        if (messageId) {
          setSentBatch((current) => current.some((row) => row.id === messageId)
            ? current
            : [...current, { id: messageId, label: recipient.name || recipient.id }]);
        }
        if (editorRevisionRef.current === acceptedEditorRevision) {
          announceDurableClear();
          editor?.commands.clearContent(true);
          recipientsRef.current = [];
          setRecipients([]);
        }
        setSendState('accepted');
        return;
      }

      // 正文恒不再被搜身：@ 在正文里就只是一个字符。收件人只有两个来源——
      // 收件人条上的芯片，或者判据链算出来的默认目标。
      const missing = mentions.filter((row) => row.missing);
      if (missing.length) throw new TypeError(`${missing.map((row) => `@${row.label}`).join('、')} 已不在本频道，请从收件人条上摘掉`);
      let targets;
      if (replyTarget) {
        const recipient = replyRecipient(replyTarget, roster);
        if (!recipient) throw new TypeError(`@${replyTarget.senderName} 已不在当前频道，请取消回复后重新选择收件人`);
        const conflicts = mentions.filter((row) => row.id !== recipient.id);
        if (conflicts.length) throw new TypeError(`回复只能发送给 @${actorDisplayName(recipient)}；请移除 ${conflicts.map((row) => `@${actorDisplayName(row)}`).join('、')} 或取消回复`);
        targets = [recipient];
      } else {
        targets = mentions.length ? mentions : [];
        if (!targets.length) {
          if (parameterAgent) targets = [parameterAgent];
          else throw new TypeError('请 @ 一个成员，或在右下角选择目标 Agent');
        }
      }
      const recipients = targets;
      const invalid = recipients.find((row) => !['agent', 'human'].includes(row.kind));
      if (invalid) throw new TypeError(`@${actorDisplayName(invalid)} 不能作为消息收件人`);
      // request 帧恒单收件人（协议 §3）：多 @ 拆成 N 条独立消息逐条发，各按收件人
      // 的 kind 定词。部分失败恒不回滚——已发出的收回不来，失败的逐条报出可重发。
      // agent.ask 的 text 是必填且不能为空白，所以纯附件消息也要带上一句正文。
      const body = value || `发送 ${attachments.length} 个附件`;
      const ids = await onSend({
        channelId,
        batch: recipients.map((row) => ({
          channelId,
          text: body,
          msgType: row.kind === 'human' ? TYPES.humanMessage : TYPES.agentAsk,
          audience: [row.id],
          targetLabel: actorDisplayName(row),
          payload: attachments.length ? { text: body, attachments } : undefined,
          ...(replyTarget?.sourceId ? { parentId: replyTarget.sourceId } : {}),
        })),
        draftRevision: acceptedDraftRevision,
        editorRevision: acceptedEditorRevision,
      });
      const sent = (ids || []).map((id, index) => ({ id, label: actorDisplayName(recipients[index]) }));
      if (!sent.length) throw new Error('发送队列未返回消息编号');
      durableMessageIDs = sent.map((item) => item.id);
      // `onSend` resolves only after the durable Outbox has accepted and
      // published these stable ids. This is the one user-authored send seam:
      // receipts, retries, feed echo, task controls and slash commands cannot
      // recreate the intent later. Native input or activation replacement
      // invalidates it in ReadingSession before any delayed list signal writes.
      if (sent.length) {
        const messageIds = sent.map((item) => item.id);
        const readingAccepted = readingIntent?.composerAccepted?.(
          channelId,
          messageIds,
          readingIntentToken,
        ) === true;
        diagnostic('debug', 'submission.composer_durable_accepted', {
          channelId,
          messageIds,
          readingAccepted,
        });
      }
      setSentBatch((current) => {
        const known = new Set(current.map((row) => row.id));
        return [...current, ...sent.filter((row) => !known.has(row.id))];
      });
      // Clear only the exact editor version accepted by the outbox. Text typed
      // while IndexedDB was committing belongs to the next message.
      if (editorRevisionRef.current === acceptedEditorRevision) {
        announceDurableClear();
        editor?.commands.clearContent(true);
        recipientsRef.current = [];
        setRecipients([]);
        onClearAttachments?.();
        if (replyTarget && sent.length) onReplySent?.();
      }
      setSendState('accepted');
    } catch (failure) {
      if (!durableMessageIDs.length && readingIntentToken) {
        const readingRejected = readingIntent?.composerRejected?.(channelId, readingIntentToken) === true;
        diagnostic('debug', 'submission.composer_durable_rejected', {
          channelId,
          readingRejected,
        });
      }
      setError(failure.message || String(failure));
      setSendState('error');
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  }

  async function uploadFiles(files) {
    if (!files.length || !onUploadAttachments) return;
    attachmentJobsRef.current += 1;
    setAttachmentBusy(true);
    setError('');
    const job = attachmentQueueRef.current
      .catch(() => {})
      .then(() => onUploadAttachments(files));
    attachmentQueueRef.current = job;
    try {
      await job;
    } catch (failure) {
      setError(failure.message || String(failure));
    } finally {
      attachmentJobsRef.current = Math.max(0, attachmentJobsRef.current - 1);
      if (attachmentJobsRef.current === 0) setAttachmentBusy(false);
    }
  }

  async function chooseLocalFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    await uploadFiles(files);
  }

  function containsFiles(transfer) {
    return [...(transfer?.types || [])].includes('Files');
  }

  function onDragEnter(event) {
    if (!canTransmit || !onUploadAttachments || !containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setFileDragActive(true);
  }

  function onDragOver(event) {
    if (!canTransmit || !onUploadAttachments || !containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event) {
    if (!fileDragActive) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setFileDragActive(false);
  }

  async function onDrop(event) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setFileDragActive(false);
    if (!canTransmit || !onUploadAttachments) return;
    await uploadFiles([...(event.dataTransfer.files || [])]);
  }

  async function onPaste(event) {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length || !canTransmit || !onUploadAttachments) return;
    // 只有剪贴板确实带文件时才接管；普通文字和 Markdown 仍由 Tiptap 处理。
    event.preventDefault();
    await uploadFiles(files);
  }

  return (
    <section className={`composer-wrap${editMode ? ' is-editing-message' : ''}`} data-send-clear-revision={sendClearRevision}>
      <div
        className={`composer-surface${fileDragActive ? ' is-file-dragging' : ''}${editMode ? ' is-editing-message' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 收件人。它恒不占一行——占一行就是在输入框上面再堆一条横幅，等候区被顶得
            更高，而它要说的只有一个名字。所以它是**贴在输入框上沿的一层**：绝对定位、
            bottom:100%、零布局高度，像钉在框边上的一个小标签。
            在框外指的是这个：渲染在框的上沿之外，而不是挤进框里占掉编辑区。

            拖拽不受影响——.composer-surface 那组 drag 处理器用的是深度计数，
            进出子节点恒是成对的。

            它曾是框内左上角一排红色 @ 芯片，只在 @ 了人的时候才出现——于是"没 @ 时
            发给谁"在屏幕上没有答案，而那恰好是最容易发错的一格。红色也是错的：
            这不是错误也不是危险，是一句陈述。唯一该刺眼的是"没有收件人"。
            判据来源与多收件人名单挂在 title 上，想知道时鼠标停一下。 */}
        {!editMode && <div className={`composer-target is-${delivery.kind}${!canEditDraft ? ' is-muted' : ''}`} role="status" aria-label="收件人" title={deliveryTitle}>
          {removableRows.length
            ? removableRows.map((row) => (
              <span key={row.id} className={`composer-target-pill is-picked${row.missing ? ' is-lost' : ''}`}>
                {`@${actorDisplayName(row)}`}
                <button type="button" className="composer-target-remove" aria-label={`移除收件人 @${actorDisplayName(row)}`} title="移除收件人" disabled={!canEditDraft} onMouseDown={(event) => event.preventDefault()} onClick={() => dropRecipient(row.id)}><X size={11} strokeWidth={2.4} aria-hidden="true" /></button>
              </span>
            ))
            : <span className="composer-target-pill">{deliveryText}</span>}
        </div>}
        {fileDragActive && <div className="composer-drop-hint" role="status"><Upload size={18} strokeWidth={1.8} aria-hidden="true" /><strong>松开以上传到当前频道</strong></div>}
        {!editMode && replyTarget && <div className="composer-reply" role="status">
          <span aria-hidden="true">↩</span>
          <div><strong>回复 @{replyTarget.senderName}</strong><small>{replyTarget.excerpt}</small></div>
          <button type="button" aria-label="取消回复" title="取消回复" onClick={onCancelReply}>×</button>
        </div>}
        {!editMode && attachments.length > 0 && <div className="attachment-drafts" aria-label="待发送附件">{attachments.map((row) => <article key={row.resource_id}><button type="button" className="attachment-draft-preview" aria-label={`预览文件 ${row.name}`} onClick={() => onPreviewAttachment?.(row)}><span aria-hidden="true">◇</span><span><strong>{row.name}</strong><small>{formatArtifactSize(Number(row.size || 0))} · 点击预览</small></span></button><button type="button" className="attachment-draft-remove" aria-label={`移除附件 ${row.name}`} onClick={() => onRemoveAttachment?.(row.resource_id)}>×</button></article>)}</div>}
        <div className="composer-input-area">
          <div className="composer-box">
            <EditorContent
              editor={editor}
              className="composer-richtext"
              onPasteCapture={onPaste}
              onCompositionStart={() => {
                composingRef.current = true;
                cancelAnimationFrame(compositionFrameRef.current);
                cancelDraftIdle();
              }}
              onCompositionEnd={() => syncAfterComposition(editor)}
            />
          </div>
          {query != null && candidates.length > 0 && (
            <div className="mention-menu" role="listbox">
              {candidates.slice(0, 8).map((row, index) => (
                <button type="button" role="option" aria-selected={index === activeCandidate} key={row.id} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(row)}>
                  <span className={`actor-icon kind-${row.kind}`}>{row.kind.slice(0, 1).toUpperCase()}</span>
                  <strong title={row.id}>{actorDisplayName(row)}</strong><small>{row.kind} · {row.decl_id || row.id}</small>
                </button>
              ))}
            </div>
          )}
          {commandQuery != null && commands.length > 0 && (
            <div className="command-menu" role="listbox" aria-label="Agent 命令">
              {commands.map((row, index) => (
                <button type="button" role="option" aria-selected={index === activeCommandCandidate} key={row.command} onMouseDown={(event) => event.preventDefault()} onClick={() => commandSessionRef.current?.command(row)}>
                  <span className="command-menu-name">/{row.command}</span>
                  <span><strong>{row.label}</strong><small>{row.description}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="composer-toolbar">
          <div className="composer-tools" aria-label="附件操作">
            <span className={`composer-file-control${!canTransmit || attachmentBusy || !onUploadAttachments ? ' is-disabled' : ''}`} title={canTransmit ? '上传本机文件到频道' : '连接可用后才能上传本机文件'}>
              <input
                type="file"
                multiple
                aria-label={attachmentBusy ? '正在上传本机文件' : '上传本机文件到频道'}
                disabled={!canTransmit || attachmentBusy || !onUploadAttachments}
                onChange={chooseLocalFiles}
              />
              {attachmentBusy ? <span className="attachment-tool-busy" aria-hidden="true" /> : <Upload size={17} strokeWidth={1.8} aria-hidden="true" />}
            </span>
            <button type="button" aria-label="从频道文件选择" title="从频道文件选择" disabled={!canTransmit || attachmentBusy || !onOpenChannelFiles} onClick={onOpenChannelFiles}><FolderOpen size={17} strokeWidth={1.8} aria-hidden="true" /></button>
          </div>
          <div className="composer-submit-actions">
            {replyTarget?.senderKind === 'human'
              ? <span className="composer-reply-route">@{replyTarget.senderName}</span>
              : <ModelSelector
                target={effectiveParameterTarget}
                actorName={effectiveParameterAgent ? actorDisplayName(effectiveParameterAgent) : ''}
                view={agentSelection?.view && effectiveParameterAgent && agentSelection.view.actorId === effectiveParameterAgent.id ? agentSelection.view : null}
                pending={agentSelection?.pending && effectiveParameterAgent && agentSelection.pending.actorId === effectiveParameterAgent.id ? agentSelection.pending : null}
                candidates={roster.filter((row) => row.kind === 'agent')}
                disabled={!canTransmit || accepting || Boolean(replyTarget)}
                onChange={agentSelection?.onChange}
                onPickAgent={agentSelection?.onPickAgent}
                onOpen={agentSelection?.onOpen}
              />}
            {editMode && <button type="button" className="composer-cancel-edit" aria-label="取消编辑" title="取消编辑" disabled={editBusy} onClick={editMode.onAbandon}><X size={14} strokeWidth={2} aria-hidden="true" /></button>}
            {/* composer 的这个按钮恒只有一个含义：发送。
                它曾经在"框是空的 + 有任务在跑"时变成停止（■），而"框是不是空的"读的是
                hasText —— 一面故意晚一拍的镜子（onUpdate 在输入法合成期间直接返回）。
                手机键盘几乎所有输入都走合成，于是从落第一个字到抬手点按钮的整段时间里
                镜子恒是空，按钮恒是 ■：打完字一点，打断的是上一条还在跑的任务。
                PC 上按回车恒不经过按钮，所以只在手机上出现。
                改判据（比如"聚焦时就是发送"）救不了它：点按钮的顺序是
                mousedown → 编辑器 blur → click，焦点在 click 之前就已经被按钮抢走，
                是同一场赛跑换个变量。而停止本来就不缺入口——turn 卡片的「任务控制」
                里一直有停止和编辑。所以这里恒不再承担第二个含义。 */}
            <button type="button" className="send-button" onClick={submit} disabled={(editMode ? !hasText : (!hasText && !attachments.length)) || !channelId || (editMode ? !canTransmit : !canDurablyAccept) || (editMode && editBusy) || accepting || attachmentBusy} aria-label={accepting ? '发送中' : '发送'}>{accepting ? '…' : '↑'}</button>
          </div>
        </div>
      </div>
      <div className="composer-state-rail">
        {(error || editMode?.session?.error)
          ? <p className="composer-error" role="alert">{error || editMode.session.error}</p>
          : !canEditDraft || !canDurablyAccept
            ? <p className="composer-disabled-reason">{disabledReason}；草稿仍保留在当前设备。</p>
            : ['queued', 'delayed', 'uncertain'].includes(sendState)
              ? <p className={`composer-status state-${sendState}`} role="status">{{ queued: '已保存到本机，连接可用后自动发送', delayed: '已受理，入账时间较长', uncertain: '发送结果待确认，正在通过账本核对' }[sendState]}{sendState === 'uncertain' && uncertainSubmission && onRetry && <button type="button" className="composer-retry" onClick={() => onRetry(uncertainSubmission)}>使用原编号重试</button>}</p>
              : !canTransmit
                ? <p className="composer-status state-offline" role="status">离线编辑；发送会先保存到本机，连接可用后自动发送。</p>
                : null}
      </div>
    </section>
  );
});
