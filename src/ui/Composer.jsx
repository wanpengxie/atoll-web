import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FolderOpen, Upload } from 'lucide-react';
import { actorDisplayName } from '../model/actor-display.js';
import { formatArtifactSize } from '../model/artifacts.js';
import { resolveManagementActors } from '../model/management-actors.js';
import { TYPES } from '../protocol/vocab.js';

function mentionQuery(text) {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1].toLowerCase() : null;
}

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

// 频道面的斜杠命令。收件人恒是本频道的 system actor：成员类的词它自己答，
// 空间类的词它转交 c0 的 registrar。
export function slashCommand(value) {
  const [verb, ...rest] = value.trim().split(/\s+/);
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

export function Composer({ channelId, roster, selfId, attachments = [], pending = [], draft = '', onDraftChange, disabled, disabledReason = '等待连接…', onSend, onPreviewAttachment, onRemoveAttachment, onClearAttachments, onUploadAttachments, onOpenChannelFiles }) {
  const wrapRef = useRef(null);
  const localFileRef = useRef(null);
  const dragDepthRef = useRef(0);
  const initialDraft = useMemo(() => normalizedDraft(draft), [channelId]);
  const [mentionIds, setMentionIds] = useState(() => mentionIdsOf(initialDraft.doc));
  const [error, setError] = useState('');
  const [sendState, setSendState] = useState('idle');
  const [sentMessageId, setSentMessageId] = useState('');
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  // 编辑内容归 Composer 自己所有。App 只接收一份无渲染副作用的草稿快照，
  // 所以每次按键不会重新渲染 Timeline、详情区或整个工作区。
  const [text, setText] = useState(initialDraft.text);

  function syncEditorSnapshot(current) {
    if (!current || current.isDestroyed) return;
    const value = editorText(current);
    const document = current.getJSON();
    const nextMentionIds = mentionIdsOf(document);
    setText(value);
    setMentionIds((existing) => (
      existing.length === nextMentionIds.length && existing.every((id, index) => id === nextMentionIds[index])
        ? existing
        : nextMentionIds
    ));
    onDraftChange?.({ text: value, doc: document });
    setError('');
    setSendState('idle');
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
        suggestion: { items: () => [] },
      }),
      Placeholder.configure({ placeholder: '输入消息，使用 @ 选择频道成员' }),
    ],
    content: initialDraft.doc,
    editable: Boolean(channelId) && !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': '消息',
        'aria-multiline': 'true',
        'data-testid': 'composer-input',
        class: 'composer-editor',
        role: 'textbox',
      },
    },
    onUpdate: ({ editor: current }) => {
      // 输入法合成期间的文字只是临时态。此时同步 React 会重绘候选菜单和
      // Composer 外壳，也可能干扰浏览器维护的 composition DOM。
      if (current.view.composing) return;
      syncEditorSnapshot(current);
    },
  }, [channelId]);
  const mentions = useMemo(() => mentionIds.map((id) => roster.find((row) => row.id === id)).filter(Boolean), [mentionIds, roster]);
  const query = mentionQuery(text);
  const candidates = useMemo(() => roster.filter((row) => (
    row.id !== selfId
    && (row.kind === 'agent' || row.kind === 'human')
    && !mentions.some((item) => item.id === row.id)
    && (query == null || `${row.name} ${row.id}`.toLowerCase().includes(query))
  )), [mentions, query, roster, selfId]);

  useEffect(() => { setActiveCandidate(0); }, [query]);

  useEffect(() => {
    setMentionIds(mentionIdsOf(initialDraft.doc));
    setError('');
    setSendState('idle');
    setSentMessageId('');
  }, [channelId]);

  useEffect(() => {
    if (!editor) return;
    const editable = Boolean(channelId) && !disabled;
    editor.setEditable(editable);
    editor.view.dom.setAttribute('aria-disabled', String(!editable));
  }, [channelId, disabled, editor]);

  // Composer 浮在时间线上方，自身增高不能改变时间线 viewport。高度只用于给
  // 账本末尾留出安全空间；用户本来就在底部时，再把滚动位置贴回最新消息。
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const workspace = wrap?.closest('.workspace');
    if (!wrap || !workspace || typeof ResizeObserver === 'undefined') return undefined;
    let previousHeight = 0;
    const observer = new ResizeObserver(([entry]) => {
      const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize || wrap.getBoundingClientRect().height);
      if (!height || height === previousHeight) return;
      const timeline = workspace.querySelector('.timeline');
      const wasAtBottom = timeline
        ? timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= Math.max(48, previousHeight + 12)
        : false;
      previousHeight = height;
      workspace.style.setProperty('--composer-overlay-height', `${height}px`);
      if (timeline && wasAtBottom) requestAnimationFrame(() => { timeline.scrollTop = timeline.scrollHeight; });
    });
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      workspace.style.removeProperty('--composer-overlay-height');
    };
  }, [channelId]);

  useEffect(() => {
    if (!sentMessageId) return undefined;
    const submission = pending.find((item) => item.messageId === sentMessageId);
    if (submission) {
      if (submission.state === 'rejected') {
        setSendState('error');
        setError(submission.error?.detail || submission.error?.message || '发送被拒绝');
      } else if (submission.state === 'uncertain') setSendState('uncertain');
      else if (submission.state === 'delayed') setSendState('delayed');
      else setSendState(submission.state === 'transmitting' ? 'sending' : 'accepted');
      return undefined;
    }
    if (sendState !== 'sending') {
      setSendState('landed');
      const timer = setTimeout(() => { setSendState('idle'); setSentMessageId(''); }, 2_500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pending, sendState, sentMessageId]);

  function pick(row) {
    if (!editor) return;
    const { from } = editor.state.selection;
    const before = editor.state.doc.textBetween(Math.max(0, from - 120), from, '\n', '\0');
    const match = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return;
    const start = from - match[1].length - 1;
    editor.chain().focus().deleteRange({ from: start, to: from }).insertContent([
      { type: 'mention', attrs: { id: row.id, label: actorDisplayName(row) } },
      { type: 'text', text: ' ' },
    ]).run();
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

  async function submit() {
    const value = text.trim();
    if ((!value && !attachments.length) || !channelId || disabled || sendState === 'sending') return;
    setError('');
    setSendState('sending');

    try {
      const slash = slashCommand(value);
      if (slash) {
        const sysactor = resolveManagementActors(roster).system;
        const messageId = await onSend({ text: value, msgType: slash.msgType, audience: [sysactor.id], targetLabel: sysactor.name || sysactor.id, payload: slash.payload });
        setSentMessageId(messageId || '');
        editor?.commands.clearContent(true);
        setSendState('accepted');
        return;
      }

      const unresolved = unresolvedMentions(editor);
      if (unresolved.length) throw new TypeError(`请从候选列表选择成员：${unresolved.map((name) => `@${name}`).join('、')}`);
      let recipients = mentions;
      if (!recipients.length) {
        const agents = roster.filter((row) => row.kind === 'agent');
        if (agents.length === 1) recipients = agents;
        else throw new TypeError('请 @ 一个成员');
      }
      const kinds = new Set(recipients.map((row) => row.kind));
      if (kinds.size !== 1 || !['agent', 'human'].includes([...kinds][0])) throw new TypeError('暂不支持混合收件人广播');
      const msgType = kinds.has('human') ? TYPES.humanMessage : TYPES.agentAsk;
      // agent.ask 的 text 是必填且不能为空白，所以纯附件消息也要带上一句正文。
      const body = value || `发送 ${attachments.length} 个附件`;
      const messageId = await onSend({
        text: body,
        msgType,
        audience: recipients.map((row) => row.id),
        targetLabel: recipients.map((row) => actorDisplayName(row)).join('、'),
        payload: attachments.length ? { text: body, attachments } : undefined,
      });
      setSentMessageId(messageId || '');
      editor?.commands.clearContent(true);
      onClearAttachments?.();
      setSendState('accepted');
    } catch (failure) {
      setError(failure.message || String(failure));
      setSendState('error');
    }
  }

  function onKeyDown(event) {
    if (query != null && candidates.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setActiveCandidate((current) => (current + direction + Math.min(candidates.length, 8)) % Math.min(candidates.length, 8));
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        pick(candidates[activeCandidate] || candidates[0]);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

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
    <section className="composer-wrap" ref={wrapRef}>
      <div
        className={`composer-surface${fileDragActive ? ' is-file-dragging' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input ref={localFileRef} className="visually-hidden" type="file" multiple aria-label="选择要上传到当前频道的本机文件" onChange={chooseLocalFiles} />
        {fileDragActive && <div className="composer-drop-hint" role="status"><Upload size={18} strokeWidth={1.8} aria-hidden="true" /><strong>松开以上传到当前频道</strong></div>}
        {attachments.length > 0 && <div className="attachment-drafts" aria-label="待发送附件">{attachments.map((row) => <article key={row.resource_id}><button type="button" className="attachment-draft-preview" aria-label={`预览文件 ${row.name}`} onClick={() => onPreviewAttachment?.(row)}><span aria-hidden="true">◇</span><span><strong>{row.name}</strong><small>{formatArtifactSize(Number(row.size || 0))} · 点击预览</small></span></button><button type="button" className="attachment-draft-remove" aria-label={`移除附件 ${row.name}`} onClick={() => onRemoveAttachment?.(row.resource_id)}>×</button></article>)}</div>}
        {mentions.length > 0 && (
          <div className="mention-chips">{mentions.map((row) => (
            <button type="button" key={row.id} onClick={() => removeMention(row.id)}>@{actorDisplayName(row)} ×</button>
          ))}</div>
        )}
        <div className="composer-input-area">
          <div className="composer-box">
            <EditorContent editor={editor} className="composer-richtext" onKeyDown={onKeyDown} onPasteCapture={onPaste} onCompositionEnd={() => queueMicrotask(() => syncEditorSnapshot(editor))} />
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
            <button type="button" aria-label={attachmentBusy ? '正在上传本机文件' : '上传本机文件到频道'} title="上传本机文件到频道" disabled={disabled || attachmentBusy || !onUploadAttachments} onClick={() => localFileRef.current?.click()}>{attachmentBusy ? <span className="attachment-tool-busy" aria-hidden="true" /> : <Upload size={17} strokeWidth={1.8} aria-hidden="true" />}</button>
            <button type="button" aria-label="从频道文件选择" title="从频道文件选择" disabled={disabled || attachmentBusy || !onOpenChannelFiles} onClick={onOpenChannelFiles}><FolderOpen size={17} strokeWidth={1.8} aria-hidden="true" /></button>
            {mentions.length > 0 && <div className="composer-target"><strong>{mentions.map((row) => `@${actorDisplayName(row)}`).join('、')}</strong></div>}
          </div>
          <button type="button" className="send-button" onClick={submit} disabled={(!text.trim() && !attachments.length) || !channelId || disabled || sendState === 'sending'} aria-label={sendState === 'sending' ? '发送中' : '发送'}>{sendState === 'sending' ? '…' : '↑'}</button>
        </div>
      </div>
      {['accepted', 'delayed', 'uncertain', 'landed'].includes(sendState) && <p className={`composer-status state-${sendState}`} role="status">{{ accepted: '已提交，等待频道入账', delayed: '已受理，入账时间较长', uncertain: '发送结果待确认，正在通过账本核对', landed: '已写入频道账本' }[sendState]}</p>}
      {disabled && <p className="composer-disabled-reason">{disabledReason}；草稿仍保留在当前设备。</p>}
      {error && <p className="composer-error" role="alert">{error}</p>}
    </section>
  );
}
