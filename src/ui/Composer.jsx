import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FolderOpen, Upload, X } from 'lucide-react';
import { actorDisplayName } from '../model/actor-display.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { resolveManagementActors } from '../model/management-actors.js';
import { TYPES } from '../protocol/vocab.js';
import { ModelSelector } from './ModelSelector.jsx';

function editorDocument(text = '') {
  return {
    type: 'doc',
    content: String(text).split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

function normalizedDraft(draft) {
  if (draft && typeof draft === 'object') {
    return {
      text: String(draft.text || ''),
      doc: draft.doc?.type === 'doc' ? draft.doc : editorDocument(draft.text),
    };
  }
  return { text: String(draft || ''), doc: editorDocument(draft) };
}

function mentionIdsOf(document) {
  const ids = [];
  function visit(node) {
    if (node?.type === 'mention' && node.attrs?.id && !ids.includes(node.attrs.id)) ids.push(node.attrs.id);
    node?.content?.forEach(visit);
  }
  visit(document);
  return ids;
}

function unresolvedMentions(editor) {
  const tokens = [];
  editor?.state.doc.descendants((node) => {
    if (!node.isText) return;
    for (const match of node.text.matchAll(/(?:^|\s)@([^\s@]+)/g)) tokens.push(match[1]);
  });
  return tokens;
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

// 频道面的斜杠命令。收件人恒是本频道的 system actor：成员类的词它自己答，
// 空间类的词它转交 c0 的 registrar。
export function slashCommand(value) {
  const [verb, ...rest] = value.trim().split(/\s+/);
  if (verb === '/compact') {
    if (rest.length) throw new TypeError('用法：/compact');
    return { msgType: TYPES.agentCompact, payload: {}, target: 'agent' };
  }
  if (verb === '/model') {
    if (rest.length > 2) throw new TypeError('用法：/model [model] [effort]');
    return { msgType: TYPES.agentSelect, payload: { ...(rest[0] ? { model: rest[0] } : {}), ...(rest[1] ? { effort: rest[1] } : {}) }, target: 'agent' };
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

export function Composer({ channelId, roster, selfId, attachments = [], pending = [], draft = '', onDraftChange, disabled, disabledReason = '等待连接…', onSend, onRetry, activeAgentTurn = null, onTaskControl, onPreviewAttachment, onRemoveAttachment, onClearAttachments, onUploadAttachments, onOpenChannelFiles, agentSelection = null, editMode = null }) {
  const wrapRef = useRef(null);
  const dragDepthRef = useRef(0);
  const initialDraft = useMemo(() => normalizedDraft(draft), [channelId]);
  const composingRef = useRef(false);
  const compositionFrameRef = useRef(0);
  const draftIdleRef = useRef(null);
  const commitComposerHeightRef = useRef(() => {});
  const editTransitionStartRectRef = useRef(null);
  const lastEditActiveRef = useRef(null);
  const layoutAnimationRef = useRef(null);
  const layoutTransitionTimerRef = useRef(0);
  const lastDraftFingerprintRef = useRef(JSON.stringify(initialDraft.doc));
  const editModeRef = useRef(editMode);
  const mentionContextRef = useRef({ roster: [], selfId: '', selectedIds: [], activeCandidate: 0, editing: false });
  const suggestionSessionRef = useRef(null);
  const submitRef = useRef(() => {});
  const normalDraftRef = useRef(null);
  const [mentionIds, setMentionIds] = useState(() => mentionIdsOf(initialDraft.doc));
  const [error, setError] = useState('');
  const [sendState, setSendState] = useState('idle');
  const [sentMessageId, setSentMessageId] = useState('');
  // 拆发批次的逐条跟踪（协议 §3.2.1）：提交层吞掉入账前错误，Promise 看不到，
  // 只有各条 submission 的状态知道谁被拒——批次里任何一条 rejected 都要带目标名报出。
  const [sentBatch, setSentBatch] = useState([]); // [{id, label}]
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  // 正文归 ProseMirror DOM 所有，不在 React 中维护第二份 text 镜像。
  // 外壳只关心空/非空边界和当前光标处是否正在输入 @ 查询。
  const [hasText, setHasText] = useState(Boolean(initialDraft.text.trim()));
  const [query, setQuery] = useState(null);
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

  function syncEditorSnapshot(current) {
    if (!current || current.isDestroyed) return;
    const value = editorText(current);
    const document = current.getJSON();
    const fingerprint = JSON.stringify(document);
    if (fingerprint === lastDraftFingerprintRef.current) return;
    lastDraftFingerprintRef.current = fingerprint;
    const nextMentionIds = mentionIdsOf(document);
    setMentionIds((existing) => (
      existing.length === nextMentionIds.length && existing.every((id, index) => id === nextMentionIds[index])
        ? existing
        : nextMentionIds
    ));
    if (!editModeRef.current) onDraftChange?.({ text: value, doc: document });
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

  function persistDraftWhenIdle(current, { measure = false } = {}) {
    cancelDraftIdle();
    const persist = () => {
      draftIdleRef.current = null;
      if (!current || current.isDestroyed || composingRef.current || current.view.composing) return;
      syncEditorSnapshot(current);
      if (measure) commitComposerHeightRef.current();
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
        persistDraftWhenIdle(current, { measure: true });
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
      Mention.configure({
        HTMLAttributes: { class: 'composer-mention' },
        renderText: ({ node }) => `@${node.attrs.label || node.attrs.id}`,
        suggestion: {
          char: '@',
          items: ({ query: searchQuery }) => {
            const context = mentionContextRef.current;
            return mentionCandidates(context.roster, context.selfId, context.selectedIds, searchQuery.toLowerCase());
          },
          render: () => ({
            onStart: (props) => {
              suggestionSessionRef.current = props;
              updateQuery(props.query.toLowerCase());
              setActiveCandidate(0);
            },
            onUpdate: (props) => {
              suggestionSessionRef.current = props;
              updateQuery(props.query.toLowerCase());
            },
            onExit: () => {
              suggestionSessionRef.current = null;
              updateQuery(null);
            },
            onKeyDown: ({ event }) => {
              const session = suggestionSessionRef.current;
              if (!session) return false;
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
                event.preventDefault();
                const row = rows[context.activeCandidate] || rows[0];
                if (row) session.command({ id: row.id, label: actorDisplayName(row) });
                return true;
              }
              return false;
            },
          }),
        },
      }),
      Placeholder.configure({ placeholder: '输入消息，使用 @ 选择频道成员' }),
    ],
    content: initialDraft.doc,
    editable: Boolean(channelId) && !disabled,
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
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return false;
        // @ 激活后交还给 Suggestion 插件；普通 Enter 才进入发送动作。
        if (suggestionSessionRef.current) return false;
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
      syncEditorPresentation(current);
      persistDraftWhenIdle(current);
    },
  }, [channelId]);
  editModeRef.current = editMode;
  const mentions = useMemo(() => mentionIds.map((id) => roster.find((row) => row.id === id)).filter(Boolean), [mentionIds, roster]);
  const mentionedAgents = useMemo(() => mentions.filter((row) => row.kind === 'agent'), [mentions]);
  // 参数面板目标（判据链 §2.1）：mention 环在此判（唯一 agent → 它；多 agent →
  // 多目标态；只 @ 人类 → 收起）；无 mention 落到 App 算的默认环（手选 > 最近交互 >
  // 唯一 agent）。原则：右下角显示谁，无 @ 回车就发给谁。
  const fallbackAgent = useMemo(() => roster.find((row) => row.id === agentSelection?.fallbackAgentId && row.kind === 'agent') || null, [agentSelection?.fallbackAgentId, roster]);
  const parameterTarget = useMemo(() => {
    if (mentionedAgents.length === 1) return { kind: 'single', agent: mentionedAgents[0] };
    if (mentionedAgents.length > 1) return { kind: 'multi', count: mentionedAgents.length };
    if (mentions.length > 0) return { kind: 'none' };
    if (fallbackAgent) return { kind: 'single', agent: fallbackAgent };
    const agents = roster.filter((row) => row.kind === 'agent');
    if (agents.length === 1) return { kind: 'single', agent: agents[0] };
    return { kind: 'none' };
  }, [mentionedAgents, mentions, fallbackAgent, roster]);
  const parameterAgent = parameterTarget.kind === 'single' ? parameterTarget.agent : null;
  useEffect(() => { agentSelection?.onTargetChange?.(parameterAgent?.id || ''); }, [parameterAgent?.id, agentSelection?.onTargetChange]);
  const matchingCandidates = (searchQuery) => mentionCandidates(roster, selfId, mentions.map((row) => row.id), searchQuery || '');
  const candidates = useMemo(() => matchingCandidates(query), [mentions, query, roster, selfId]);
  mentionContextRef.current = { roster, selfId, selectedIds: mentions.map((row) => row.id), activeCandidate, editing: Boolean(editMode) };
  const sentRows = sentBatch.length ? sentBatch : (sentMessageId ? [{ id: sentMessageId, label: '' }] : []);
  const activeSubmission = sentRows.map((row) => pending.find((item) => item.messageId === row.id)).find(Boolean) || null;

  useEffect(() => { setActiveCandidate(0); }, [query]);

  const editTargetId = editMode?.session?.targetId || '';
  const editBusy = Boolean(editMode && editMode.session?.phase !== 'editing');

  useEffect(() => {
    if (!editor) return;
    if (editTargetId) {
      if (!normalDraftRef.current) normalDraftRef.current = { doc: editor.getJSON(), text: editorText(editor), mentionIds: mentionIdsOf(editor.getJSON()) };
      const next = editorDocument(editMode.session.text);
      lastDraftFingerprintRef.current = JSON.stringify(next);
      editor.commands.setContent(next, { emitUpdate: false });
      updateHasText(Boolean(editMode.session.text.trim()));
      updateQuery(null);
      setMentionIds([]);
      setError('');
      setSendState(editMode.session.phase === 'editing' ? 'idle' : 'sending');
      requestAnimationFrame(() => editor.commands.focus('end'));
      return;
    }
    if (normalDraftRef.current) {
      const saved = normalDraftRef.current;
      normalDraftRef.current = null;
      lastDraftFingerprintRef.current = JSON.stringify(saved.doc);
      editor.commands.setContent(saved.doc, { emitUpdate: false });
      updateHasText(Boolean(saved.text.trim()));
      updateQuery(null);
      setMentionIds(saved.mentionIds);
      setError('');
      setSendState('idle');
    }
  }, [editor, editTargetId]);

  useEffect(() => {
    if (!editMode) return;
    setSendState(editMode.session.phase === 'editing' ? 'idle' : 'sending');
  }, [editMode?.session?.phase]);

  useEffect(() => {
    cancelAnimationFrame(compositionFrameRef.current);
    cancelDraftIdle();
    compositionFrameRef.current = 0;
    lastDraftFingerprintRef.current = JSON.stringify(initialDraft.doc);
    setMentionIds(mentionIdsOf(initialDraft.doc));
    updateHasText(Boolean(initialDraft.text.trim()));
    suggestionSessionRef.current = null;
    updateQuery(null);
    setError('');
    setSendState('idle');
    setSentMessageId('');
  }, [channelId]);

  useEffect(() => () => {
    cancelAnimationFrame(compositionFrameRef.current);
    cancelDraftIdle();
    clearTimeout(layoutTransitionTimerRef.current);
    layoutAnimationRef.current?.cancel?.();
  }, []);

  useEffect(() => {
    if (!editor) return;
    const editable = Boolean(channelId) && !disabled && (!editMode || !editBusy);
    editor.setEditable(editable);
    editor.view.dom.setAttribute('aria-disabled', String(!editable));
  }, [channelId, disabled, editor, editMode, editBusy]);

  // Composer 浮在时间线上方，自身增高不能改变时间线 viewport。高度只用于给
  // 账本末尾留出安全空间；用户本来就在底部时，再把滚动位置贴回最新消息。
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const workspace = wrap?.closest('.workspace');
    if (!wrap || !workspace || typeof ResizeObserver === 'undefined') return undefined;
    let committedHeight = 0;
    const commitHeight = () => {
      const rect = wrap.getBoundingClientRect();
      const height = Math.ceil(rect.height);
      if (!height || height === committedHeight) return;
      // 中文输入法确认时，字体 fallback/composition DOM 可能短暂产生 1–2px 的
      // 高度波动。这不是一次真实换行，不能据此重排 Timeline。
      if (committedHeight && Math.abs(height - committedHeight) < 8) return;
      committedHeight = height;
      workspace.style.setProperty('--composer-overlay-height', `${height}px`);
    };
    commitComposerHeightRef.current = commitHeight;
    const observer = new ResizeObserver(() => {
      if (!composingRef.current) commitHeight();
    });
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      commitComposerHeightRef.current = () => {};
      workspace.style.removeProperty('--composer-overlay-height');
    };
  }, [channelId]);

  // 编辑提交后，普通 Composer 的工具栏会重新出现，容器高度随之改变。只在
  // 编辑态边界做一次 FLIP，让 Composer、等待区和时间线共同移动；输入和输入法
  // 引起的日常高度变化不进入这条动画路径。
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const workspace = wrap?.closest('.workspace');
    if (!wrap || !workspace) return;
    const editActive = Boolean(editMode);
    const previousActive = lastEditActiveRef.current;
    const previousRect = editTransitionStartRectRef.current;
    const nextRect = wrap.getBoundingClientRect();
    lastEditActiveRef.current = editActive;
    if (previousActive == null || previousActive === editActive || !previousRect) return;
    editTransitionStartRectRef.current = null;
    const deltaY = previousRect.top - nextRect.top;
    if (Math.abs(deltaY) < 1 || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    clearTimeout(layoutTransitionTimerRef.current);
    layoutAnimationRef.current?.cancel?.();
    workspace.classList.add('is-composer-layout-transitioning');
    if (typeof wrap.animate === 'function') {
      layoutAnimationRef.current = wrap.animate(
        [{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }],
        { duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      );
    }
    layoutTransitionTimerRef.current = setTimeout(() => {
      workspace.classList.remove('is-composer-layout-transitioning');
      layoutAnimationRef.current = null;
    }, 210);
  }, [Boolean(editMode)]);

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
      if (inFlight.some((row) => row.submission.state === 'uncertain')) setSendState('uncertain');
      else if (inFlight.some((row) => row.submission.state === 'delayed')) setSendState('delayed');
      else setSendState(inFlight.some((row) => row.submission.state === 'transmitting') ? 'sending' : 'accepted');
      return undefined;
    }
    if (sendState !== 'sending') {
      setSendState('landed');
      const timer = setTimeout(() => { setSendState('idle'); setSentMessageId(''); setSentBatch([]); }, 2_500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pending, sendState, sentMessageId, sentBatch]);

  function pick(row) {
    suggestionSessionRef.current?.command({ id: row.id, label: actorDisplayName(row) });
  }

  function removeMention(id) {
    if (!editor) return;
    editor.commands.command(({ tr, state, dispatch }) => {
      const ranges = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'mention' && node.attrs.id === id) ranges.push({ from: pos, to: pos + node.nodeSize });
      });
      ranges.reverse().forEach((range) => tr.delete(range.from, range.to));
      dispatch?.(tr);
      return true;
    });
    editor.commands.focus();
  }

  function beginEditLayoutTransition() {
    const wrap = wrapRef.current;
    const workspace = wrap?.closest('.workspace');
    if (!wrap || !workspace) return null;
    editTransitionStartRectRef.current = wrap.getBoundingClientRect();
    clearTimeout(layoutTransitionTimerRef.current);
    workspace.classList.add('is-composer-layout-transitioning');
    // 协议失败或后端长时间没有退出编辑态时，安全移除临时动效状态。
    layoutTransitionTimerRef.current = setTimeout(() => workspace.classList.remove('is-composer-layout-transitioning'), 1200);
    return workspace;
  }

  async function submit() {
    // 提交读取编辑器真相，而不是可能刻意晚一帧同步的 React 草稿快照。
    // 这样中文刚确认就按 Enter，也不会丢掉最后一个字。
    const value = editorText(editor).trim();
    if (editMode) {
      if (!value || !channelId || disabled || editBusy || sendState === 'sending') return;
      const workspace = beginEditLayoutTransition();
      setError('');
      setSendState('sending');
      try {
        await editMode.onSave(value);
      } catch (failure) {
        workspace?.classList.remove('is-composer-layout-transitioning');
        editTransitionStartRectRef.current = null;
        setError(failure.message || String(failure));
        setSendState('error');
      }
      return;
    }
    if ((!value && !attachments.length) || !channelId || disabled || sendState === 'sending') return;
    setError('');
    setSendState('sending');
    setSentBatch([]);

    try {
      const slash = slashCommand(value);
      if (slash) {
        let recipient;
        if (slash.target === 'agent') {
          // 与消息发送同一判据（§2.2）：@ 唯一 agent 优先，否则参数面板目标。
          recipient = parameterAgent;
          if (!recipient) throw new TypeError('请 @ 一个 Agent，或在右下角选择目标 Agent');
        } else recipient = resolveManagementActors(roster).system;
        const messageId = await onSend({ text: value, msgType: slash.msgType, audience: [recipient.id], targetLabel: recipient.name || recipient.id, payload: slash.payload });
        setSentMessageId(messageId || '');
        editor?.commands.clearContent(true);
        setSendState('accepted');
        return;
      }

      const unresolved = unresolvedMentions(editor);
      if (unresolved.length) throw new TypeError(`请从候选列表选择成员：${unresolved.map((name) => `@${name}`).join('、')}`);
      const liveMentionIds = mentionIdsOf(editor.getJSON());
      let recipients = liveMentionIds.map((id) => roster.find((row) => row.id === id)).filter(Boolean);
      if (!recipients.length) {
        if (parameterAgent) recipients = [parameterAgent];
        else throw new TypeError('请 @ 一个成员，或在右下角选择目标 Agent');
      }
      const invalid = recipients.find((row) => !['agent', 'human'].includes(row.kind));
      if (invalid) throw new TypeError(`@${actorDisplayName(invalid)} 不能作为消息收件人`);
      // request 帧恒单收件人（协议 §3）：多 @ 拆成 N 条独立消息逐条发，各按收件人
      // 的 kind 定词。部分失败恒不回滚——已发出的收回不来，失败的逐条报出可重发。
      // agent.ask 的 text 是必填且不能为空白，所以纯附件消息也要带上一句正文。
      const body = value || `发送 ${attachments.length} 个附件`;
      const failures = [];
      const sent = [];
      for (const row of recipients) {
        try {
          const id = await onSend({
            text: body,
            msgType: row.kind === 'human' ? TYPES.humanMessage : TYPES.agentAsk,
            audience: [row.id],
            targetLabel: actorDisplayName(row),
            payload: attachments.length ? { text: body, attachments } : undefined,
          });
          if (id) sent.push({ id, label: actorDisplayName(row) });
        } catch (failure) {
          failures.push(`@${actorDisplayName(row)}：${failure.message || failure}`);
        }
      }
      if (failures.length === recipients.length) throw new TypeError(`发送失败 ${failures.join('；')}`);
      setSentMessageId(sent.at(-1)?.id || '');
      setSentBatch(sent);
      editor?.commands.clearContent(true);
      onClearAttachments?.();
      if (failures.length) {
        setError(`部分发送失败（其余已送出）：${failures.join('；')}`);
        setSendState('error');
      } else {
        setSendState('accepted');
      }
    } catch (failure) {
      setError(failure.message || String(failure));
      setSendState('error');
    }
  }

  async function interrupt() {
    if (!activeAgentTurn || disabled || sendState === 'sending') return;
    setError('');
    setSendState('sending');
    try {
      const actorId = activeAgentTurn.request?.audience?.[0] || '';
      const messageId = await onTaskControl?.({ channelId, turn: activeAgentTurn, actorId, type: TYPES.agentInterrupt, payload: {} });
      setSentMessageId(messageId || '');
      setSendState('accepted');
    } catch (failure) {
      setError(failure.message || String(failure));
      setSendState('error');
    }
  }

  submitRef.current = submit;

  async function uploadFiles(files) {
    if (!files.length || !onUploadAttachments) return;
    setAttachmentBusy(true);
    setError('');
    try {
      await onUploadAttachments(files);
    } catch (failure) {
      setError(failure.message || String(failure));
    } finally {
      setAttachmentBusy(false);
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
    if (disabled || attachmentBusy || !onUploadAttachments || !containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setFileDragActive(true);
  }

  function onDragOver(event) {
    if (disabled || attachmentBusy || !onUploadAttachments || !containsFiles(event.dataTransfer)) return;
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
    if (disabled || attachmentBusy || !onUploadAttachments) return;
    await uploadFiles([...(event.dataTransfer.files || [])]);
  }

  async function onPaste(event) {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length || disabled || attachmentBusy || !onUploadAttachments) return;
    // 只有剪贴板确实带文件时才接管；普通文字和 Markdown 仍由 Tiptap 处理。
    event.preventDefault();
    await uploadFiles(files);
  }

  return (
    <section className={`composer-wrap${editMode ? ' is-editing-message' : ''}`} ref={wrapRef}>
      <div
        className={`composer-surface${fileDragActive ? ' is-file-dragging' : ''}${editMode ? ' is-editing-message' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {fileDragActive && <div className="composer-drop-hint" role="status"><Upload size={18} strokeWidth={1.8} aria-hidden="true" /><strong>松开以上传到当前频道</strong></div>}
        {!editMode && attachments.length > 0 && <div className="attachment-drafts" aria-label="待发送附件">{attachments.map((row) => <article key={row.resource_id}><button type="button" className="attachment-draft-preview" aria-label={`预览文件 ${row.name}`} onClick={() => onPreviewAttachment?.(row)}><span aria-hidden="true">◇</span><span><strong>{row.name}</strong><small>{formatArtifactSize(Number(row.size || 0))} · 点击预览</small></span></button><button type="button" className="attachment-draft-remove" aria-label={`移除附件 ${row.name}`} onClick={() => onRemoveAttachment?.(row.resource_id)}>×</button></article>)}</div>}
        {!editMode && mentions.length > 0 && (
          <div className="mention-chips">{mentions.map((row) => (
            <button type="button" key={row.id} onClick={() => removeMention(row.id)}>@{actorDisplayName(row)} ×</button>
          ))}</div>
        )}
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
        </div>
        <div className="composer-toolbar">
          <div className="composer-tools" aria-label="附件操作">
            <span className={`composer-file-control${disabled || attachmentBusy || !onUploadAttachments ? ' is-disabled' : ''}`} title="上传本机文件到频道">
              <input
                type="file"
                multiple
                aria-label={attachmentBusy ? '正在上传本机文件' : '上传本机文件到频道'}
                disabled={disabled || attachmentBusy || !onUploadAttachments}
                onChange={chooseLocalFiles}
              />
              {attachmentBusy ? <span className="attachment-tool-busy" aria-hidden="true" /> : <Upload size={17} strokeWidth={1.8} aria-hidden="true" />}
            </span>
            <button type="button" aria-label="从频道文件选择" title="从频道文件选择" disabled={disabled || attachmentBusy || !onOpenChannelFiles} onClick={onOpenChannelFiles}><FolderOpen size={17} strokeWidth={1.8} aria-hidden="true" /></button>
          </div>
          <div className="composer-submit-actions">
            <ModelSelector
              target={parameterTarget}
              actorName={parameterAgent ? actorDisplayName(parameterAgent) : ''}
              view={agentSelection?.view && parameterAgent && agentSelection.view.actorId === parameterAgent.id ? agentSelection.view : null}
              pending={agentSelection?.pending && parameterAgent && agentSelection.pending.actorId === parameterAgent.id ? agentSelection.pending : null}
              candidates={roster.filter((row) => row.kind === 'agent')}
              disabled={disabled || sendState === 'sending'}
              onChange={agentSelection?.onChange}
              onPickAgent={agentSelection?.onPickAgent}
              onOpen={agentSelection?.onOpen}
            />
            {editMode && <button type="button" className="composer-cancel-edit" aria-label="取消编辑" title="取消编辑" disabled={editBusy} onClick={() => { beginEditLayoutTransition(); editMode.onAbandon(); }}><X size={14} strokeWidth={2} aria-hidden="true" /></button>}
            {editMode
              ? <button type="button" className="send-button" onClick={submit} disabled={!hasText || !channelId || disabled || editBusy || sendState === 'sending'} aria-label={sendState === 'sending' ? '发送中' : '发送'}>{sendState === 'sending' ? '…' : '↑'}</button>
              : (hasText || attachments.length || !activeAgentTurn)
              ? <button type="button" className="send-button" onClick={submit} disabled={(!hasText && !attachments.length) || !channelId || disabled || sendState === 'sending'} aria-label={sendState === 'sending' ? '发送中' : '发送'}>{sendState === 'sending' ? '…' : '↑'}</button>
              : <button type="button" className="send-button interrupt" onClick={interrupt} disabled={!channelId || disabled || sendState === 'sending'} aria-label={sendState === 'sending' ? '停止中' : '停止'}>{sendState === 'sending' ? '…' : '■'}</button>}
          </div>
        </div>
      </div>
      {['delayed', 'uncertain'].includes(sendState) && <p className={`composer-status state-${sendState}`} role="status">{{ delayed: '已受理，入账时间较长', uncertain: '发送结果待确认，正在通过账本核对' }[sendState]}{sendState === 'uncertain' && activeSubmission && onRetry && <button type="button" className="composer-retry" onClick={() => onRetry(activeSubmission)}>使用原编号重试</button>}</p>}
      {disabled && <p className="composer-disabled-reason">{disabledReason}；草稿仍保留在当前设备。</p>}
      {(error || editMode?.session?.error) && <p className="composer-error" role="alert">{error || editMode.session.error}</p>}
    </section>
  );
}
