import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, RefreshCw, Users, Zap } from 'lucide-react';
import { actorDisplayName } from '../model/actor-display.js';
import { contextUsageView, selectionFor } from '../model/agent-selection.js';

const SECTION_LABEL = { model: '模型', effort: '推理强度' };

function viewportFrame() {
  const viewport = globalThis.visualViewport;
  const left = Number(viewport?.offsetLeft || 0);
  const top = Number(viewport?.offsetTop || 0);
  const width = Number(viewport?.width || globalThis.innerWidth || document.documentElement.clientWidth || 0);
  const height = Number(viewport?.height || globalThis.innerHeight || document.documentElement.clientHeight || 0);
  return { left, top, right: left + width, bottom: top + height };
}

function placePopover(node, trigger) {
  if (!node || !trigger?.isConnected) return;
  const frame = viewportFrame();
  const margin = 8;
  const gap = 9;
  const availableWidth = Math.max(120, frame.right - frame.left - margin * 2);
  const availableHeight = Math.max(44, frame.bottom - frame.top - margin * 2);
  node.style.setProperty('--model-selector-popover-max-height', `${availableHeight}px`);
  node.style.maxWidth = `${availableWidth}px`;
  node.style.visibility = 'hidden';
  node.style.left = '0px';
  node.style.top = '0px';

  const anchor = trigger.getBoundingClientRect();
  const size = node.getBoundingClientRect();
  const left = Math.min(
    Math.max(frame.left + margin, anchor.right - size.width),
    Math.max(frame.left + margin, frame.right - margin - size.width),
  );
  const above = anchor.top - gap - size.height;
  const below = anchor.bottom + gap;
  const top = above >= frame.top + margin
    ? above
    : below + size.height <= frame.bottom - margin
      ? below
      : Math.min(
        Math.max(frame.top + margin, above),
        Math.max(frame.top + margin, frame.bottom - margin - size.height),
      );
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.visibility = 'visible';
}

function ModelSelectorPopover({ triggerRef, popoverRef, className = '', children }) {
  useLayoutEffect(() => {
    const node = popoverRef.current;
    const trigger = triggerRef.current;
    if (!node || !trigger) return undefined;
    const place = () => placePopover(node, trigger);
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(node);
    observer?.observe(trigger);
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
  return createPortal(
    <div
      ref={popoverRef}
      className={`model-selector-popover${className ? ` ${className}` : ''}`}
      data-model-selector-portal="true"
      style={{ visibility: 'hidden' }}
    >{children}</div>,
    document.body,
  );
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 100_000 ? 0 : 1))}K`;
  return String(value);
}

function ContextUsage({ usage, compact = false }) {
  const context = contextUsageView(usage);
  if (!context) return null;
  const value = context.percent == null ? formatTokens(context.tokens ?? context.window) : `${context.percent}%`;
  if (compact) return <span className="model-selector-context-compact" title={`上下文 ${context.tokens == null ? '—' : formatTokens(context.tokens)} / ${context.window == null ? '—' : formatTokens(context.window)}`}><span aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, context.percent || 0))}%` }} /></span><strong>{value}</strong></span>;
  return <div className="model-selector-context-usage" aria-label={`上下文用量${context.percent == null ? '' : ` ${context.percent}%`}`}>
    <div><span>上下文</span><strong>{context.tokens == null ? '—' : formatTokens(context.tokens)}{context.window == null ? '' : ` / ${formatTokens(context.window)}`}</strong></div>
    {context.percent != null && <><div className="model-selector-context-track" role="progressbar" aria-label="上下文已使用" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, Math.max(0, context.percent))}><span style={{ width: `${Math.min(100, Math.max(0, context.percent))}%` }} /></div><small>已使用 {context.percent}%</small></>}
  </div>;
}

function ClientStatus({ client }) {
  if (!client || (!client.current && !client.latest && !client.update_status)) return null;
  const status = client.update_status === 'available'
    ? `可升级${client.latest ? `至 ${client.latest}` : ''}`
    : client.update_status === 'current' ? '已是最新' : '升级状态未知';
  return <div className="model-selector-readonly"><span>{client.name || '客户端'}</span><strong>{[client.current, status].filter(Boolean).join(' · ')}</strong></div>;
}

// 参数面板（协议 §4.3/§4.4）。三种目标态：single（显示该 agent 参数，可切换）、
// multi（多 @：只报数，收起设置入口——select 是逐 agent 的设置）、none（多 agent
// 无判据：手选入口）。当前值恒来自账本（view.current）；pending 期间显示目标值 +
// "切换中"，busy 持续到账本终态（App 观察后清 pending）。
export function ModelSelector({ target = { kind: 'none' }, actorName = '', view = null, pending = null, candidates = [], disabled = false, onChange, onPickAgent, onOpen }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('');
  // 值域未就绪时用户点过一次 = 他要的是「打开面板」，不是「帮我取一次数」。
  // 手动挡下取数必须由这一下点击发起，所以面板只能等数据到了再开——
  // 这个标记就是把那个意图记到数据回来为止，恒不让用户点第二次。
  const awaitingViewRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) {
        setOpen(false);
        setSection('');
      }
    };
    const keyboard = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (section) setSection('');
      else {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open, section]);

  // 只有"真的换了目标"才收起面板。值域暂时缺席（view 变 null）不是换目标：
  // 手动刷新的那一瞬、旧证据被新证据替换的那一帧，都会让 view 短暂为空；
  // 若把它当成换目标，面板会在用户眼前刚开就关（2026-09-18 实测症状）。
  const lastTargetRef = useRef('');
  useEffect(() => {
    const actorId = view?.actorId || '';
    // 等的那份值域到了就直接展开，把用户那一下点击补完。
    if (awaitingViewRef.current && view) {
      awaitingViewRef.current = false;
      lastTargetRef.current = `${target.kind}:${actorId}`;
      setSection('');
      setOpen(true);
      return;
    }
    if (!actorId) return;
    const key = `${target.kind}:${actorId}`;
    if (key === lastTargetRef.current) return;
    lastTargetRef.current = key;
    setSection('');
    setOpen(false);
  }, [target.kind, view?.actorId]);

  if (target.kind === 'multi') {
    return <div className="model-selector">
      <div className="model-selector-trigger is-static" aria-label={`${target.count} 个目标`}>
        <Users size={14} strokeWidth={2.2} aria-hidden="true" />
        <strong className="model-selector-actor">{target.count} 个目标</strong>
      </div>
    </div>;
  }

  if (target.kind === 'none') {
    if (candidates.length < 2) return null;
    return <div className="model-selector" ref={rootRef}>
      <button ref={triggerRef} type="button" className="model-selector-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Users size={14} strokeWidth={2.2} aria-hidden="true" />
        <strong className="model-selector-actor">选择 Agent</strong>
        <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && <ModelSelectorPopover triggerRef={triggerRef} popoverRef={popoverRef}>
        <div className="model-selector-menu" role="menu" aria-label="选择目标 Agent">
          <div className="model-selector-agent-context"><span>本频道有多个 Agent</span></div>
          {candidates.map((row) => <button type="button" role="menuitem" key={row.id} onClick={() => { setOpen(false); onPickAgent?.(row.id); }}>
            <span>{actorDisplayName(row)}</span><ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div>
      </ModelSelectorPopover>}
    </div>;
  }

  // 展开/收起恒在事件处理器里算，onOpen 恒不放进 setOpen 的 updater。
  // updater 是在**渲染阶段**跑的：把 onOpen 放进去，它里面的 setState 就成了
  // "渲染 ModelSelector 时更新 App"，React 会报 Cannot update a component while
  // rendering a different component，并可能丢掉这次交互——表现就是按钮点不动。
  // 2026-09-18：手动挡把 onOpen 变成必定 setState 的路径后，这个旧反模式立刻暴露。

  // single：值域未就绪或该 agent 无 selections → 显示角色名 + 刷新。
  // 手动挡（owner 2026-09-18）：前端恒不自动探测参数，这里就是**唯一**的取数入口，
  // 所以它必须看得见、可点、说得清自己是干什么的——旧版只画一个角色名，
  // 用户根本不知道点它会加载。
  if (!view) {
    if (!actorName) return null;
    return <div className="model-selector">
      <button
        type="button"
        className="model-selector-trigger is-refresh"
        aria-label={`${actorName}，点击读取可用模型`}
        title="读取可用模型与上下文"
        onClick={() => { awaitingViewRef.current = true; onOpen?.(); }}
      >
        <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
        <strong className="model-selector-actor">{actorName}</strong>
        <RefreshCw size={12} strokeWidth={2.2} aria-hidden="true" className="model-selector-refresh" />
      </button>
    </div>;
  }

  // current 为 null = 账本无真值（§4.1：只显示角色名，恒不冒充默认值）；
  // 此时仍可设置——选 model 落该 model 首组合。
  const displayed = pending ? pending.value : view.current;
  const busy = Boolean(pending);
  const labelOf = (kind, id) => {
    const row = view.selections.find((item) => (kind === 'model' ? item.model === id : item.model === displayed?.model && item.effort === id));
    return kind === 'model' ? (row?.modelLabel || id) : (row?.effortLabel || id);
  };
  const modelLabel = displayed ? labelOf('model', displayed.model) : '';
  const effortLabel = displayed ? labelOf('effort', displayed.effort) : '';

  // 当前配置存在但 describe 没给 selections：这是只读状态，不是“配置未知”。
  // 仍显示 actor + model/effort，但绝不伪造可操作菜单。
  if (view.configurable === false) {
    return <div className="model-selector" ref={rootRef}>
      <button ref={triggerRef} type="button" className="model-selector-trigger" aria-label={`${actorName}${modelLabel ? `，模型 ${modelLabel}` : ''}${effortLabel ? `，推理强度 ${effortLabel}` : ''}${view.usage?.contextTokens != null ? `，上下文 ${contextUsageView(view.usage)?.percent ?? formatTokens(view.usage.contextTokens)}${contextUsageView(view.usage)?.percent == null ? '' : '%'}` : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { const next = !open; setOpen(next); if (next) onOpen?.(); }}>
        <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
        <strong className="model-selector-actor">{actorName}</strong>
        {modelLabel && <><span className="model-selector-divider" aria-hidden="true" /><span className="model-selector-current"><strong>{modelLabel}</strong>{effortLabel && <span>{effortLabel}</span>}</span></>}
        <ContextUsage usage={view.usage} compact />
        <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && <ModelSelectorPopover triggerRef={triggerRef} popoverRef={popoverRef}><div className="model-selector-menu is-status" role="dialog" aria-label={`${actorName} Agent 状态`}><div className="model-selector-agent-context"><span>当前 Agent</span><strong>{actorName}</strong></div>{modelLabel && <div className="model-selector-readonly"><span>模型</span><strong>{modelLabel}</strong></div>}<ClientStatus client={view.client} /><ContextUsage usage={view.usage} /></div></ModelSelectorPopover>}
    </div>;
  }

  // 两级菜单恒是组合对的投影（§4.4）：强度段 = 当前显示 model 名下的合法 effort。
  const effortRows = displayed ? view.selections.filter((row) => row.model === displayed.model)
    .map((row) => ({ id: row.effort, label: row.effortLabel })) : [];
  const hasEffort = effortRows.some((row) => row.id);
  const rows = section === 'model' ? view.models : effortRows;

  const choose = (kind, id) => {
    if (busy || id === displayed?.[kind]) return;
    // 换 model 时 effort 可能在新 model 名下非法——落到该 model 的合法组合。
    const next = kind === 'model' ? selectionFor(view.selections, id, displayed?.effort || '') : { model: displayed.model, effort: id };
    if (!next) return;
    setOpen(false);
    setSection('');
    Promise.resolve(onChange?.({ actorId: view.actorId, ...next })).catch(() => {});
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return <div className="model-selector" ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className="model-selector-trigger"
      disabled={disabled || busy}
      aria-label={displayed ? `${actorName}，模型 ${modelLabel}${effortLabel ? `，推理强度 ${effortLabel}` : ''}${busy ? '，切换中' : ''}` : `${actorName}，模型未知`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { const next = !open; setOpen(next); setSection(''); if (next) onOpen?.(); }}
    >
      <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
      <strong className="model-selector-actor">{actorName}</strong>
      {displayed && <span className="model-selector-divider" aria-hidden="true" />}
      {displayed && <span className="model-selector-current"><strong>{modelLabel}</strong><span>{effortLabel}</span></span>}
      <ContextUsage usage={view.usage} compact />
      {busy ? <span className="model-selector-pending">切换中</span> : <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />}
    </button>
    {open && <ModelSelectorPopover triggerRef={triggerRef} popoverRef={popoverRef} className={section ? 'has-section' : ''}>
      <div className="model-selector-menu" role="menu" aria-label="模型设置">
        <div className="model-selector-agent-context"><span>当前 Agent</span><strong>{actorName}</strong></div>
        {(['model', ...(hasEffort ? ['effort'] : [])]).map((kind) => <button type="button" role="menuitem" key={kind} className={section === kind ? 'active' : ''} onClick={() => setSection(kind)}>
          <span>{SECTION_LABEL[kind]}</span><span className="model-selector-menu-value">{(kind === 'model' ? modelLabel : effortLabel) || '—'}</span><ChevronRight size={16} aria-hidden="true" />
        </button>)}
        <ClientStatus client={view.client} />
        <ContextUsage usage={view.usage} />
      </div>
      {section && <div className="model-selector-options" role="menu" aria-label={SECTION_LABEL[section]}>
        <div className="model-selector-options-title"><button type="button" onClick={() => setSection('')} aria-label="返回模型设置"><ArrowLeft size={16} aria-hidden="true" /></button><span>{SECTION_LABEL[section]}</span></div>
        {rows.map((row) => <button
          type="button"
          role="menuitemradio"
          aria-checked={displayed?.[section] === row.id}
          key={row.id}
          onClick={() => choose(section, row.id)}
        >
          <span><strong>{row.label}</strong></span>
          {displayed?.[section] === row.id && <Check size={17} strokeWidth={2} aria-hidden="true" />}
        </button>)}
      </div>}
    </ModelSelectorPopover>}
  </div>;
}
