import { commandRowsFor, mentionRowsFor } from './composer-model.js';
import { createSuggestionExtension } from './composer-suggestions.js';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { ArrowLeft, Check, ChevronDown, ChevronRight, FolderOpen, RefreshCw, Upload, Users, X, Zap } from 'lucide-react';
import { useReadingIntent } from '../conversation/ReadingIntentContext.jsx';

const actorName = (actor) => actor?.name || actor?.label || actor?.id || '未知成员';
const textFromDocument = (doc) => (doc
  ? doc.textBetween(0, doc.content.size, '\n', '\n')
  : '') || '';
const MENTION_MODE = 'composerMentionSuggestion';
const COMMAND_MODE = 'composerCommandSuggestion';
const editorText = (editor) => (editor && !editor.isDestroyed ? textFromDocument(editor.state.doc) : '') || '';
const editorDocument = (text = '') => ({
  type: 'doc',
  content: String(text).split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })),
});

function formatSize(value) {
  if (!Number.isFinite(value) || value <= 0) return '已附加';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function viewportFrame() {
  const viewport = globalThis.visualViewport;
  const left = Number(viewport?.offsetLeft || 0);
  const top = Number(viewport?.offsetTop || 0);
  const width = Number(viewport?.width || globalThis.innerWidth || document.documentElement.clientWidth || 0);
  const height = Number(viewport?.height || globalThis.innerHeight || document.documentElement.clientHeight || 0);
  return { left, top, right: left + width, bottom: top + height };
}

function placePopover(node, trigger, matchWidth) {
  if (!node || !trigger?.isConnected) return;
  const frame = viewportFrame();
  const margin = 8;
  const gap = 7;
  const anchor = trigger.getBoundingClientRect();
  node.style.setProperty('--model-selector-popover-max-height', `${Math.max(44, frame.bottom - frame.top - margin * 2)}px`);
  node.style.maxWidth = `${Math.max(120, frame.right - frame.left - margin * 2)}px`;
  if (matchWidth) node.style.width = `${Math.min(anchor.width, frame.right - frame.left - margin * 2)}px`;
  node.style.visibility = 'hidden';
  node.style.left = '0px';
  node.style.top = '0px';
  const size = node.getBoundingClientRect();
  const left = Math.min(Math.max(frame.left + margin, matchWidth ? anchor.left : anchor.right - size.width), Math.max(frame.left + margin, frame.right - margin - size.width));
  const above = anchor.top - gap - size.height;
  const below = anchor.bottom + gap;
  const top = above >= frame.top + margin ? above : below + size.height <= frame.bottom - margin ? below : Math.max(frame.top + margin, frame.bottom - margin - size.height);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.visibility = 'visible';
}

function placeTarget(node, anchor) {
  if (!node || !anchor?.isConnected) return;
  const frame = viewportFrame();
  const anchorRect = anchor.getBoundingClientRect();
  const width = Math.max(0, Math.min(anchorRect.width - 24, frame.right - frame.left - 24));
  node.style.visibility = 'hidden';
  node.style.left = `${Math.max(frame.left + 12, Math.min(anchorRect.left + 12, frame.right - frame.left - width - 12))}px`;
  node.style.top = '0px';
  node.style.width = `${width}px`;
  const height = node.getBoundingClientRect().height;
  node.style.top = `${Math.max(frame.top + 8, anchorRect.top - 7 - height)}px`;
  node.style.visibility = 'visible';
}

function FloatingPortal({ anchorRef, className, matchWidth = false, children }) {
  const popoverRef = useRef(null);
  useLayoutEffect(() => {
    const node = popoverRef.current;
    const anchor = anchorRef.current;
    if (!node || !anchor) return undefined;
    const place = () => placePopover(node, anchor, matchWidth);
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(node);
    observer?.observe(anchor);
    globalThis.addEventListener?.('resize', place);
    globalThis.visualViewport?.addEventListener?.('resize', place);
    globalThis.visualViewport?.addEventListener?.('scroll', place);
    document.addEventListener('scroll', place, true);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener?.('resize', place);
      globalThis.visualViewport?.removeEventListener?.('resize', place);
      globalThis.visualViewport?.removeEventListener?.('scroll', place);
      document.removeEventListener('scroll', place, true);
    };
  });
  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={popoverRef} className={className} style={{ visibility: 'hidden' }}>{children}</div>, document.body);
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 100_000 ? 0 : 1))}K`;
  return String(value);
}

function ContextUsage({ usage, compact = false }) {
  if (!usage) return null;
  const tokens = Number.isFinite(Number(usage.contextTokens)) ? Number(usage.contextTokens) : null;
  const windowSize = Number.isFinite(Number(usage.contextWindow)) ? Number(usage.contextWindow) : null;
  const percent = tokens != null && windowSize > 0 ? Math.round((tokens / windowSize) * 100) : null;
  if (compact) return <span className="model-selector-context-compact" title={`上下文 ${formatTokens(tokens)} / ${formatTokens(windowSize)}`}><span aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, percent || 0))}%` }} /></span><strong>{percent == null ? formatTokens(tokens ?? windowSize) : `${percent}%`}</strong></span>;
  return <div className="model-selector-context-usage" aria-label={`上下文用量${percent == null ? '' : ` ${percent}%`}`}><div><span>上下文</span><strong>{formatTokens(tokens)}{windowSize == null ? '' : ` / ${formatTokens(windowSize)}`}</strong></div>{percent != null && <><div className="model-selector-context-track" role="progressbar" aria-label="上下文已使用" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, Math.max(0, percent))}><span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div><small>已使用 {percent}%</small></>}</div>;
}

function ClientStatus({ client }) {
  if (!client || (!client.current && !client.latest && !client.update_status)) return null;
  const status = client.update_status === 'available' ? `可升级${client.latest ? `至 ${client.latest}` : ''}` : client.update_status === 'current' ? '已是最新' : '升级状态未知';
  return <div className="model-selector-readonly"><span>{client.name || '客户端'}</span><strong>{[client.current, status].filter(Boolean).join(' · ')}</strong></div>;
}

const SECTION_LABEL = { model: '模型', effort: '推理强度' };

function ModelSelector({ model, commands }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('');
  const awaitingViewRef = useRef(false);
  const deliveryAgents = model.delivery.rows.filter((row) => row.kind === 'agent');
  const target = model.targetAgent ? { kind: 'single', agent: model.targetAgent } : deliveryAgents.length > 1 ? { kind: 'multi', count: deliveryAgents.length } : { kind: 'none' };
  const view = model.parameters;
  const pending = model.parameterPending;

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target) && !event.target?.closest?.('[data-model-selector-portal="true"]')) {
        setOpen(false);
        setSection('');
      }
    };
    const keyboard = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (section) setSection('');
      else { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [open, section]);

  useEffect(() => {
    if (awaitingViewRef.current && view) { awaitingViewRef.current = false; setOpen(true); }
  }, [view]);
  useEffect(() => { setOpen(false); setSection(''); }, [model.targetAgent?.id]);

  if (target.kind === 'multi') return <div className="model-selector"><div className="model-selector-trigger is-static" aria-label={`${target.count} 个目标`}><Users size={14} aria-hidden="true" /><strong className="model-selector-actor">{target.count} 个目标</strong></div></div>;
  if (target.kind === 'none') {
    if (model.agents.length < 2) return null;
    return <div className="model-selector" ref={rootRef}><button ref={triggerRef} type="button" className="model-selector-trigger" disabled={!model.permissions.canEditDraft} aria-haspopup="menu" aria-expanded={open} aria-label="选择 Agent" onClick={() => setOpen((value) => !value)}><Users size={14} aria-hidden="true" /><strong className="model-selector-actor">选择 Agent</strong><ChevronDown size={15} aria-hidden="true" /></button>{open && <FloatingPortal anchorRef={triggerRef} className="model-selector-popover"><div data-model-selector-portal="true" className="model-selector-menu" role="menu" aria-label="选择目标 Agent"><div className="model-selector-agent-context"><span>本频道有多个 Agent</span></div>{model.agents.map((row) => <button type="button" role="menuitem" key={row.id} onClick={() => { setOpen(false); commands.selectAgent(row.id); }}><span>{actorName(row)}</span><ChevronRight size={16} aria-hidden="true" /></button>)}</div></FloatingPortal>}</div>;
  }

  const name = actorName(target.agent);
  if (!view) return <div className="model-selector"><button type="button" className="model-selector-trigger is-refresh" aria-haspopup="dialog" aria-expanded={false} aria-label={`${name}，点击读取可用模型`} title="读取可用模型与上下文" onClick={() => { awaitingViewRef.current = true; commands.openAgentSelector(); }}><Zap size={14} aria-hidden="true" /><strong className="model-selector-actor">{name}</strong><RefreshCw size={12} className="model-selector-refresh" aria-hidden="true" /></button></div>;

  const displayed = pending?.value || view.current;
  const busy = Boolean(pending && pending.state !== 'error');
  const labelOf = (kind, id) => {
    const row = view.selections?.find((item) => kind === 'model' ? item.model === id : item.model === displayed?.model && item.effort === id);
    return kind === 'model' ? (row?.modelLabel || id) : (row?.effortLabel || id);
  };
  const modelLabel = displayed ? labelOf('model', displayed.model) : '';
  const effortLabel = displayed ? labelOf('effort', displayed.effort) : '';
  const effortRows = displayed ? (view.selections || []).filter((row) => row.model === displayed.model).map((row) => ({ id: row.effort, label: row.effortLabel || row.effort })) : [];
  const hasEffort = effortRows.some((row) => row.id);
  const modelRows = view.models?.length ? view.models : [...new Map((view.selections || []).map((row) => [row.model, { id: row.model, label: row.modelLabel || row.model }])).values()];
  const rows = section === 'model' ? modelRows : effortRows;
  const configurable = view.configurable !== false && Boolean(view.selections?.length);
  const describePanel = view.source === 'describe';
  const panelRole = configurable && !describePanel ? 'menu' : 'dialog';
  const panelLabel = panelRole === 'menu' ? '模型设置' : `${name} Agent 状态`;
  const choose = (kind, id) => {
    if (busy) return;
    if (id === displayed?.[kind]) {
      setOpen(false); setSection('');
      requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }
    const next = kind === 'model' ? (view.selections || []).find((row) => row.model === id && row.effort === displayed?.effort) || (view.selections || []).find((row) => row.model === id) : { model: displayed.model, effort: id };
    if (!next) return;
    setOpen(false); setSection('');
    commands.setModelParameters({ actorId: view.actorId, model: next.model, effort: next.effort || '' });
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return <div className="model-selector" ref={rootRef}><button ref={triggerRef} type="button" className="model-selector-trigger" disabled={busy} aria-label={`${name}${modelLabel ? `，模型 ${modelLabel}` : '，模型未知'}${effortLabel ? `，推理强度 ${effortLabel}` : ''}${busy ? '，切换中' : ''}`} aria-haspopup={configurable ? 'menu' : 'dialog'} aria-expanded={open} onClick={() => { const next = !open; setOpen(next); setSection(''); if (next) commands.openAgentSelector(); }}><Zap size={14} aria-hidden="true" /><strong className="model-selector-actor">{name}</strong>{modelLabel && <><span className="model-selector-divider" aria-hidden="true" /><span className="model-selector-current"><strong>{modelLabel}</strong>{effortLabel && <span>{effortLabel}</span>}</span></>}<ContextUsage usage={view.usage} compact />{busy ? <span className="model-selector-pending">切换中</span> : <ChevronDown size={15} aria-hidden="true" />}</button>
    {open && <FloatingPortal anchorRef={triggerRef} className={`model-selector-popover${section ? ' has-section' : ''}`}><div data-model-selector-portal="true" className="model-selector-menu" role={panelRole} aria-label={panelLabel}><div className="model-selector-agent-context"><span>当前 Agent</span><strong>{name}</strong></div>{configurable && ['model', ...(hasEffort ? ['effort'] : [])].map((kind) => <button type="button" role="menuitem" key={kind} className={section === kind ? 'active' : ''} onClick={() => setSection(kind)}><span>{SECTION_LABEL[kind]}</span><span className="model-selector-menu-value">{kind === 'model' ? modelLabel : effortLabel || '—'}</span><ChevronRight size={16} aria-hidden="true" /></button>)}{!configurable && modelLabel && <div className="model-selector-readonly"><span>模型</span><strong>{modelLabel}</strong></div>}<ClientStatus client={view.client} /><ContextUsage usage={view.usage} /></div>{section && <div data-model-selector-portal="true" className="model-selector-options" role="menu" aria-label={SECTION_LABEL[section]}><div className="model-selector-options-title"><button type="button" onClick={() => setSection('')} aria-label="返回模型设置"><ArrowLeft size={16} /></button><span>{SECTION_LABEL[section]}</span></div>{rows.map((row) => <button type="button" role="menuitemradio" aria-checked={displayed?.[section] === row.id} key={row.id} onClick={() => choose(section, row.id)}><span><strong>{row.label}</strong>{row.description && <small>{row.description}</small>}</span>{displayed?.[section] === row.id && <Check size={17} />}</button>)}</div>}</FloatingPortal>}
  </div>;
}

const containsFiles = (transfer) => [...(transfer?.types || [])].includes('Files');

export const Composer = memo(function Composer({ model, commands, className = '' }) {
  const readingIntent = useReadingIntent();
  const inputAreaRef = useRef(null);
  const targetRef = useRef(null);
  const editorRef = useRef(null);
  const latestRef = useRef({ model, commands, readingIntent });
  const applyingRef = useRef(false);
  const composingRef = useRef(false);
  const compositionFrameRef = useRef(0);
  const pendingTextRef = useRef(null);
  const dragDepthRef = useRef(0);
  const uploadJobsRef = useRef(0);
  const [interactionError, setInteractionError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  // Unsent text per channel, for as long as this Composer stays mounted.
  // Switching channels restores from here; a reload deliberately does not,
  // because a reload is exactly when we stop knowing whether it still applies.
  const bodiesRef = useRef(new Map());

  const [fileDragActive, setFileDragActive] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [channelFileBusy, setChannelFileBusy] = useState(false);
  // `@` and `/` are input modes owned by ProseMirror. This is the only state
  // typing can reach, and only while such a mode is open; plain characters
  // never enter one, so they schedule no render at all.
  const [openMode, setOpenMode] = useState(null);
  // Esc closes the mode at this trigger position for good. A fact about one
  // position, not a rendered value.
  const dismissedRef = useRef({});
  const suggestionPortRef = useRef(null);
  const editMode = Boolean(model.edit);
  const disabled = !model.permissions.canEditDraft;
  const mentionRows = openMode?.name === MENTION_MODE ? openMode.rows : [];
  const commandOpen = openMode?.name === COMMAND_MODE ? openMode : null;
  const commandRows = commandOpen?.rows || [];
  const activeRows = openMode?.rows || [];

  const invoke = useCallback((operation, ...args) => {
    setInteractionError('');
    try {
      return Promise.resolve(operation?.(...args)).catch((error) => { setInteractionError(error?.detail || error?.message || String(error)); return undefined; });
    } catch (error) {
      setInteractionError(error?.detail || error?.message || String(error));
      return Promise.resolve(undefined);
    }
  }, []);

  const cancelCompositionWork = useCallback(() => {
    if (compositionFrameRef.current) globalThis.cancelAnimationFrame?.(compositionFrameRef.current);
    compositionFrameRef.current = 0;
    composingRef.current = false;
  }, []);

  const syncEditorPresentation = useCallback((current) => {
    if (!current || current !== editorRef.current || current.isDestroyed) return;
    const value = editorText(current);
    pendingTextRef.current = value;
    bodiesRef.current.set(latestRef.current.model.channelId, value);
  }, []);

  const syncAfterComposition = useCallback((current) => {
    if (compositionFrameRef.current) globalThis.cancelAnimationFrame?.(compositionFrameRef.current);
    const waitForEditor = () => {
      if (!current || current !== editorRef.current || current.isDestroyed) return;
      if (current.view.composing) {
        compositionFrameRef.current = globalThis.requestAnimationFrame(waitForEditor);
        return;
      }
      compositionFrameRef.current = globalThis.requestAnimationFrame(() => {
        compositionFrameRef.current = 0;
        composingRef.current = false;
        syncEditorPresentation(current);
      });
    };
    compositionFrameRef.current = globalThis.requestAnimationFrame(waitForEditor);
  }, [syncEditorPresentation]);

  useEffect(() => () => {
    cancelCompositionWork();
  }, [cancelCompositionWork]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ blockquote: false, bulletList: false, codeBlock: false, heading: false, horizontalRule: false, listItem: false, orderedList: false }),
      Placeholder.configure({ placeholder: '输入消息；@ 选择成员，/ 使用命令' }),
      createSuggestionExtension({ name: MENTION_MODE, char: '@', port: suggestionPortRef }),
      createSuggestionExtension({ name: COMMAND_MODE, char: '/', startOfLine: true, port: suggestionPortRef }),
    ],
    content: bodiesRef.current.has(model.channelId)
      ? editorDocument(bodiesRef.current.get(model.channelId))
      : (model.draft.doc?.type === 'doc' ? model.draft.doc : editorDocument(model.draft.text)),
    editable: !disabled,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { 'aria-label': '消息', 'aria-multiline': 'true', 'data-testid': 'composer-input', class: 'composer-editor', role: 'textbox' },
      handleKeyDown: (view, event) => {
        const { model: current, commands: owner, readingIntent: intent, mention, command } = latestRef.current;
        const currentEditor = editorRef.current;
        if (event.isComposing) return false;
        if (event.key === 'Backspace' && view.state.selection.empty && view.state.selection.from <= 1 && current.draft.recipients.length) {
          const last = current.draft.recipients.at(-1);
          event.preventDefault(); invoke(owner.removeMention, typeof last === 'string' ? last : last.id); return true;
        }
        if (event.key === 'Escape') {
          if (mention?.rows?.length || command) {
            return false;
          }
          if (current.draft.replyTarget) { event.preventDefault(); invoke(owner.clearReply); return true; }
        }
        // Stand down only while the open mode actually has something to pick.
        // A trigger with no candidates (a literal address, an unmatched
        // command) must not swallow the send.
        if (latestRef.current.openMode?.rows?.length) return false;
        if (event.key !== 'Enter' || event.shiftKey) return false;
        event.preventDefault(); event.stopPropagation();
        // Enter may arrive before the deferred post-composition callback. Read
        // the live editor snapshot, but cancel that callback synchronously so
        // it cannot write the consumed composition back into the draft after
        // the send has accepted it.
        cancelCompositionWork();
        const text = textFromDocument(view.state.doc);
        const snapshot = {
          ...current.draft,
          text,
          doc: view.state.doc.toJSON(),
          editorRevision: current.draft.editorRevision + 1,
        };
        invoke(current.edit ? owner.edit : owner.send, current.edit ? { newText: text } : { readingIntent: intent, draft: snapshot }).then((result) => {
          if (!result) return;
          applyingRef.current = true; editorRef.current?.commands.clearContent(false); applyingRef.current = false;
          pendingTextRef.current = null;
          bodiesRef.current.delete(current.channelId);
        });
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      if (applyingRef.current || composingRef.current || current.isDestroyed || current.view.composing) return;
      const value = editorText(current);
      pendingTextRef.current = value;
      bodiesRef.current.set(latestRef.current.model.channelId, value);
    },
  }, [model.channelId]);
  editorRef.current = editor;
  latestRef.current = { model, commands, readingIntent, openMode };
  activeIndexRef.current = activeIndex;
  // Everything the plugin needs that changes between renders. The plugin is
  // built once per editor and reads through this, so a mode never depends on
  // the draft and typing never has to keep it in step.
  suggestionPortRef.current = {
    allow: (name, range) => !editMode && dismissedRef.current[name] !== range.from,
    items: (name, query) => (name === MENTION_MODE
      ? mentionRowsFor(query, model.mentionCandidates)
      : commandRowsFor(query, model.controls.commands, model.commandDefinitions).rows),
    open: (name, props) => {
      const view = name === MENTION_MODE
        ? { rows: mentionRowsFor(props.query, model.mentionCandidates), reason: '' }
        : commandRowsFor(props.query, model.controls.commands, model.commandDefinitions);
      setOpenMode((previous) => (previous && previous.name === name && previous.query === props.query
        ? previous
        : { name, query: props.query, command: props.command, ...view }));
    },
    close: (name) => setOpenMode((previous) => (previous?.name === name ? null : previous)),
    // `SuggestionKeyDownProps` carries only { view, event, range } — the rows
    // and the select callback live in the open mode this component already
    // holds, so read them from there.
    keyDown: (name, props) => {
      const { event } = props;
      if (event.key === 'Escape' || event.key === 'Esc') {
        dismissedRef.current[name] = props.range?.from;
        return false;
      }
      if (!openMode || openMode.name !== name) return false;
      const rows = openMode.rows || [];
      if (!rows.length) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((value) => (value + step + rows.length) % rows.length);
        return true;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        openMode.command(rows[activeIndexRef.current % rows.length] || rows[0]);
        return true;
      }
      return false;
    },
    // One transaction over the range the plugin owns. The body is never read
    // back, rewritten, or routed through the draft.
    select: (name, { editor, range, item }) => {
      if (!item) return;
      if (name === MENTION_MODE) {
        // A trigger at the end of the body leaves the space that preceded it
        // dangling; take it with the range so the message reads normally.
        let from = range.from;
        if (range.to >= editor.state.doc.content.size - 1) {
          while (from > 1 && /[ \t]/u.test(editor.state.doc.textBetween(from - 1, from))) from -= 1;
        }
        editor.chain().focus().deleteRange({ from, to: range.to }).run();
        pendingTextRef.current = editorText(editor);
        bodiesRef.current.set(latestRef.current.model.channelId, pendingTextRef.current);
        invoke(latestRef.current.commands.pickMention, item);
        dismissedRef.current = {};
        return;
      }
      editor.chain().focus().insertContentAt(range, `/${item.command} `).run();
      pendingTextRef.current = editorText(editor);
      bodiesRef.current.set(latestRef.current.model.channelId, pendingTextRef.current);
      dismissedRef.current = {};
    },
  };

  const presentationKey = `${model.channelId}\u0000${model.editSession?.targetId || ''}`;
  const compositionOwnerRef = useRef({ editor, presentationKey });
  useLayoutEffect(() => {
    const previous = compositionOwnerRef.current;
    const editorChanged = previous.editor !== editor;
    const ownerChanged = previous.presentationKey !== presentationKey;
    compositionOwnerRef.current = { editor, presentationKey };
    if (editorChanged || ownerChanged) cancelCompositionWork();
  }, [cancelCompositionWork, editor, presentationKey]);

  useEffect(() => {
    // `useEditor` recreates the instance when the channel owner changes, but
    // its passive effect may publish the new instance before EditorContent has
    // attached that instance's view. During the same handoff the previous
    // instance can already be destroyed while it is still the value returned
    // by this render. `isEditorContentInitialized` is set by Tiptap's
    // EditorContent only after the view has been moved into the live DOM;
    // pair it with `isDestroyed` so this owner never reads the proxy view for
    // either stale or not-yet-mounted instances.
    if (!editor || editor.isDestroyed || editor.isEditorContentInitialized !== true) return;
    const view = editor.view;
    const dom = view.dom;
    const editable = Boolean(model.channelId) && model.permissions.canEditDraft && (!editMode || (!model.busy && model.permissions.canTransmit));
    editor.setEditable(editable, false);
    dom.setAttribute('aria-disabled', String(!editable));
    // Keep the native-form disabled contract observable to accessibility and
    // browser automation even though ProseMirror renders a contenteditable.
    dom.disabled = !editable;
  }, [editMode, editor, model.busy, model.channelId, model.permissions.canEditDraft, model.permissions.canTransmit]);

  const lastPresentationKeyRef = useRef(presentationKey);
  useEffect(() => {
    // The editor returned for the previous channel can be synchronously
    // destroyed by useEditor before this passive effect runs. Once destroyed,
    // even state-only helpers such as getText/getJSON are no longer valid.
    if (!editor || editor.isDestroyed) return;
    const ownerChanged = lastPresentationKeyRef.current !== presentationKey;
    if (!ownerChanged) return;
    lastPresentationKeyRef.current = presentationKey;
    const restored = bodiesRef.current.has(model.channelId)
      ? bodiesRef.current.get(model.channelId)
      : model.draft.text;
    if (editorText(editor) === restored) return;
    applyingRef.current = true;
    editor.commands.setContent(editorDocument(restored), { emitUpdate: false });
    applyingRef.current = false;
    pendingTextRef.current = restored;
  }, [editor, model.channelId, model.draft.text, presentationKey]);
  const previousEditTargetRef = useRef('');
  useEffect(() => {
    const targetId = model.editSession?.targetId || '';
    const previousTargetId = previousEditTargetRef.current;
    previousEditTargetRef.current = targetId;
    if (!editor || editor.isDestroyed || targetId === previousTargetId) return undefined;
    // Editing is a Composer-local handoff.  Focus follows the text handoff
    // after the presentation effect has installed the matching document; it
    // does not ask Reading/viewport owners to move or re-anchor anything.
    const frame = requestAnimationFrame(() => {
      const current = latestRef.current.model;
      if (editor.isDestroyed || editor.isEditorContentInitialized !== true
        || (current.editSession?.targetId || '') !== targetId) return;
      editor.commands.focus('end');
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, model.editSession?.targetId]);
  useEffect(() => { setActiveIndex(0); }, [openMode?.name, openMode?.query]);
  useLayoutEffect(() => {
    if (editMode || !targetRef.current || !inputAreaRef.current) return undefined;
    const place = () => placeTarget(targetRef.current, inputAreaRef.current);
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(inputAreaRef.current);
    // `placeTarget` owns the fixed node's width/top. Observing that same node
    // feeds its own style write back into ResizeObserver and can produce a
    // Chromium loop warning. Child mutations are the only target-side size
    // changes we need to re-place (a new/removing chip); viewport/anchor size
    // remains covered by the anchor observer and viewport listeners.
    const targetMutations = typeof MutationObserver === 'function' ? new MutationObserver(place) : null;
    targetMutations?.observe(targetRef.current, { childList: true, subtree: true, characterData: true });
    globalThis.addEventListener?.('resize', place);
    globalThis.visualViewport?.addEventListener?.('resize', place);
    globalThis.visualViewport?.addEventListener?.('scroll', place);
    document.addEventListener('scroll', place, true);
    return () => {
      observer?.disconnect();
      targetMutations?.disconnect();
      globalThis.removeEventListener?.('resize', place);
      globalThis.visualViewport?.removeEventListener?.('resize', place);
      globalThis.visualViewport?.removeEventListener?.('scroll', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [editMode]);
  useEffect(() => {
    if (!model.draft.replyTarget || editMode || !editor) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed && editor.isEditorContentInitialized === true) editor.commands.focus('end');
    });
    return () => cancelAnimationFrame(frame);
  }, [editMode, editor, model.draft.replyTarget?.sourceId]);

  const liveSnapshot = () => {
    const value = editorText(editor);
    return {
      ...model.draft,
      text: value,
      doc: editor?.getJSON() || editorDocument(value),
      editorRevision: model.draft.editorRevision + 1,
    };
  };
  const clearAccepted = (result) => {
    if (!result || !editor || editor.isDestroyed) return;
    applyingRef.current = true; editor.commands.clearContent(false); applyingRef.current = false;
    pendingTextRef.current = null;
    bodiesRef.current.delete(model.channelId);
  };
  const submit = (event) => {
    event?.preventDefault?.();
    cancelCompositionWork();
    const snapshot = liveSnapshot();
    if (!snapshot.text.trim() && !snapshot.attachments.length) return;
    invoke(editMode ? commands.edit : commands.send, editMode ? { newText: snapshot.text } : { readingIntent, draft: snapshot }).then(clearAccepted);
  };
  const chooseRow = (row) => openMode?.command?.(row);
  const uploadFiles = async (files) => {
    if (!files.length || editMode || !model.permissions.canTransmit) return;
    uploadJobsRef.current += 1; setUploadBusy(true);
    try { await invoke(commands.upload, files); } finally { uploadJobsRef.current = Math.max(0, uploadJobsRef.current - 1); if (!uploadJobsRef.current) setUploadBusy(false); }
  };
  const pickChannelFile = () => {
    if (channelFileBusy) return;
    setChannelFileBusy(true);
    void invoke(commands.pickChannelFile, { draft: liveSnapshot() }).finally(() => setChannelFileBusy(false));
  };
  const onDragEnter = (event) => {
    if (editMode || !model.permissions.canTransmit || !containsFiles(event.dataTransfer)) return;
    event.preventDefault(); dragDepthRef.current += 1; setFileDragActive(true);
  };
  const onDragLeave = (event) => {
    if (!fileDragActive) return;
    event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setFileDragActive(false);
  };

  const deliveryText = model.delivery.kind === 'none' ? '⚠ 无收件人' : model.delivery.kind === 'lost' ? `⚠ ${model.delivery.label}` : `@${actorName(model.delivery.rows[0])}${model.delivery.rows.length > 1 ? ` +${model.delivery.rows.length - 1}` : ''}`;
  const removableRows = model.delivery.source === 'mention' ? model.delivery.rows : [];
  const deliveryTitle = model.delivery.kind === 'none'
    ? '还没有收件人：@ 一位成员，或在右下角选择目标 Agent'
    : model.delivery.kind === 'lost'
      ? model.delivery.label
      : [model.delivery.rows.map((row) => `@${actorName(row)}`).join('、'), model.delivery.sourceLabel || model.delivery.label].filter(Boolean).join(' · ');

  return <section className={`composer-wrap${editMode ? ' is-editing-message' : ''}${className ? ` ${className}` : ''}`} data-composer-channel={model.channelId} data-composer-owner="current">
    <form className={`composer-surface${fileDragActive ? ' is-file-dragging' : ''}${editMode ? ' is-editing-message' : ''}`} onSubmit={submit} onDragEnter={onDragEnter} onDragOver={(event) => { if (containsFiles(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDragLeave={onDragLeave} onDrop={(event) => { if (!containsFiles(event.dataTransfer)) return; event.preventDefault(); dragDepthRef.current = 0; setFileDragActive(false); void uploadFiles([...(event.dataTransfer.files || [])]); }}>
      {!editMode && <div ref={targetRef} className={`composer-target is-${model.delivery.kind}${disabled ? ' is-muted' : ''}`} role="status" aria-label="收件人" title={deliveryTitle}>{removableRows.length ? removableRows.map((row) => <span key={row.id} className={`composer-target-pill is-picked${row.missing ? ' is-lost' : ''}`}>@{actorName(row)}<button type="button" className="composer-target-remove" aria-label={`移除收件人 @${actorName(row)}`} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => invoke(commands.removeMention, row.id)}><X size={11} /></button></span>) : <span className="composer-target-pill">{deliveryText}</span>}</div>}
      {fileDragActive && <div className="composer-drop-hint" role="status"><Upload size={18} /><strong>松开以上传到当前频道</strong></div>}
      {!editMode && model.draft.replyTarget && <div className="composer-reply" role="status"><span aria-hidden="true">↩</span><div><strong>回复 @{model.draft.replyTarget.senderName || model.draft.replyTarget.senderId}</strong><small>{model.draft.replyTarget.excerpt || ''}</small></div><button type="button" aria-label="取消回复" onClick={() => invoke(commands.clearReply)}>×</button></div>}
      {!editMode && model.draft.attachments.length > 0 && <div className="attachment-drafts" aria-label="待发送附件">{model.draft.attachments.map((row) => { const id = row.resource_id || row.id; return <article key={id}><button type="button" className="attachment-draft-preview" aria-label={`预览文件 ${row.name || id}`} title="预览已附加文件" onClick={() => invoke(commands.previewAttachment, row)}><span aria-hidden="true">◇</span><span><strong>{row.name || id}</strong><small>{formatSize(Number(row.size || 0))} · 点击预览</small></span></button><button type="button" className="attachment-draft-remove" aria-label={`移除附件 ${row.name || id}`} onClick={() => invoke(commands.removeAttachment, id)}>×</button></article>; })}</div>}
      <div ref={inputAreaRef} className="composer-input-area"><div className="composer-box"><EditorContent editor={editor} className="composer-richtext" onPasteCapture={(event) => { const files = [...(event.clipboardData?.files || [])]; if (files.length && !editMode && model.permissions.canTransmit) { event.preventDefault(); void uploadFiles(files); } }} onCompositionStart={() => { cancelCompositionWork(); composingRef.current = true; }} onCompositionEnd={() => { if (!editor || editor.isDestroyed) return; syncAfterComposition(editor); }} /></div>
        {mentionRows.length > 0 && <FloatingPortal anchorRef={inputAreaRef} matchWidth className="mention-menu composer-menu-portal"><div role="listbox" aria-label="@ 收件人">{mentionRows.map((actor, index) => <button type="button" role="option" aria-selected={index === activeIndex % mentionRows.length} key={actor.id} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseRow(actor)}><span className={`actor-icon kind-${actor.kind}`}>{actor.kind.slice(0, 1).toUpperCase()}</span><strong title={actor.id}>{actorName(actor)}</strong><small>{actor.kind} · {actor.decl_id || actor.id}</small></button>)}</div></FloatingPortal>}
        {commandOpen && <FloatingPortal anchorRef={inputAreaRef} matchWidth className="command-menu composer-menu-portal"><div role="listbox" aria-label="Agent 命令">{commandRows.length ? commandRows.map((row, index) => <button type="button" role="option" aria-selected={index === activeIndex % commandRows.length} key={row.command} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseRow(row)}><span className="command-menu-name">/{row.command}</span><span><strong>{row.label}</strong><small>{row.description}</small></span></button>) : <p className="command-menu-empty" role="status">{commandOpen.reason}</p>}</div></FloatingPortal>}
      </div>
      <div className="composer-toolbar"><div className="composer-tools" aria-label="附件操作"><label className={`composer-file-control${editMode || !model.permissions.canTransmit || uploadBusy ? ' is-disabled' : ''}`} title={editMode ? '完成或取消编辑后才能上传附件' : '上传本机文件到频道'}><input type="file" multiple aria-label={uploadBusy ? '正在上传本机文件' : '上传本机文件到频道'} disabled={editMode || !model.permissions.canTransmit || uploadBusy} onChange={(event) => { const files = [...(event.currentTarget.files || [])]; event.currentTarget.value = ''; void uploadFiles(files); }} />{uploadBusy ? <span className="attachment-tool-busy" /> : <Upload size={17} />}</label><button type="button" aria-label="从频道文件选择" title={editMode ? '完成或取消编辑后才能附加频道文件' : !model.permissions.canTransmit ? (model.permissions.reason || '连接可用后才能附加频道文件') : channelFileBusy ? '正在选择频道文件' : '从频道文件选择'} disabled={editMode || !model.permissions.canTransmit || uploadBusy || channelFileBusy} onClick={pickChannelFile}>{channelFileBusy ? <span className="attachment-tool-busy" aria-hidden="true" /> : <FolderOpen size={17} aria-hidden="true" />}</button></div>
        <div className="composer-submit-actions">{!editMode && model.draft.replyTarget?.senderKind === 'human' ? <span className="composer-reply-route">@{model.draft.replyTarget.senderName}</span> : !editMode && <ModelSelector model={model} commands={commands} />}
          {!editMode && <button type="button" className="composer-steer-button" disabled={!model.controls.steer.enabled || model.busy} title={model.controls.steer.reason || '把文本插入目标 Agent 的当前任务'} onClick={() => { const snapshot = liveSnapshot(); invoke(commands.steer, { text: snapshot.text, draft: snapshot, actorId: model.controls.actorId }).then(clearAccepted); }}>插入</button>}
          {editMode && <button type="button" className="composer-cancel-edit" aria-label="取消编辑" disabled={model.busy} onClick={() => invoke(commands.cancelEdit)}><X size={14} /></button>}
          <button type="submit" className="send-button" disabled={!model.channelId || (editMode ? !model.permissions.canTransmit : !model.permissions.canDurablyAccept) || model.busy || uploadBusy} aria-label={model.busy ? '发送中' : editMode ? '提交编辑' : '发送'}>{model.busy ? '…' : '↑'}</button>
        </div>
      </div>
    </form>
    <div className="composer-state-rail">{interactionError ? <p className="composer-error" role="alert">{interactionError}</p> : model.editSession?.error ? <p className="composer-error" role="alert">{model.editSession.error}</p> : model.delivery.kind === 'lost' ? <p className="composer-error" role="alert">{model.delivery.label}；{model.delivery.source === 'reply' ? '请取消回复后重新选择收件人' : '请移除后重新选择收件人'}。</p> : model.failure ? <p className="composer-error" role="alert">{model.failure.error?.detail || model.failure.error?.message || model.failure.error || '发送失败'}<button type="button" className="composer-retry" onClick={() => invoke(commands.retry, model.failure)}>使用原编号重试</button></p> : disabled || !model.permissions.canDurablyAccept ? <p className="composer-disabled-reason">{model.permissions.reason}；草稿仍保留在当前设备。</p> : !model.permissions.canTransmit ? <p className="composer-status state-offline" role="status">离线编辑；发送会先保存到本机，连接可用后自动发送。</p> : null}</div>
  </section>;
});
