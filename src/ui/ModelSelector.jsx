import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Users, Zap } from 'lucide-react';
import { actorDisplayName } from '../model/actor-display.js';
import { contextUsageView, selectionFor } from '../model/agent-selection.js';

const SECTION_LABEL = { model: '模型', effort: '推理强度' };

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

// 参数面板（协议 §4.3/§4.4）。三种目标态：single（显示该 agent 参数，可切换）、
// multi（多 @：只报数，收起设置入口——select 是逐 agent 的设置）、none（多 agent
// 无判据：手选入口）。当前值恒来自账本（view.current）；pending 期间显示目标值 +
// "切换中"，busy 持续到账本终态（App 观察后清 pending）。
export function ModelSelector({ target = { kind: 'none' }, actorName = '', view = null, pending = null, candidates = [], disabled = false, onChange, onPickAgent, onOpen }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
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

  useEffect(() => { setOpen(false); setSection(''); }, [target.kind, view?.actorId]);

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
      {open && <div className="model-selector-popover">
        <div className="model-selector-menu" role="menu" aria-label="选择目标 Agent">
          <div className="model-selector-agent-context"><span>本频道有多个 Agent</span></div>
          {candidates.map((row) => <button type="button" role="menuitem" key={row.id} onClick={() => { setOpen(false); onPickAgent?.(row.id); }}>
            <span>{actorDisplayName(row)}</span><ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </div>
      </div>}
    </div>;
  }

  // single：值域未就绪（describe 在途 / 探测失败）或该 agent 无 selections →
  // 只显示角色名；点击走 onOpen（失败探测的显式重试通道）。
  if (!view) {
    if (!actorName) return null;
    return <div className="model-selector">
      <button type="button" className="model-selector-trigger is-static" aria-label={actorName} onClick={() => onOpen?.()}>
        <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
        <strong className="model-selector-actor">{actorName}</strong>
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
      <button ref={triggerRef} type="button" className="model-selector-trigger" aria-label={`${actorName}${modelLabel ? `，模型 ${modelLabel}` : ''}${effortLabel ? `，推理强度 ${effortLabel}` : ''}${view.usage?.contextTokens != null ? `，上下文 ${contextUsageView(view.usage)?.percent ?? formatTokens(view.usage.contextTokens)}${contextUsageView(view.usage)?.percent == null ? '' : '%'}` : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => { if (!current) onOpen?.(); return !current; })}>
        <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
        <strong className="model-selector-actor">{actorName}</strong>
        {modelLabel && <><span className="model-selector-divider" aria-hidden="true" /><span className="model-selector-current"><strong>{modelLabel}</strong>{effortLabel && <span>{effortLabel}</span>}</span></>}
        <ContextUsage usage={view.usage} compact />
        <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && <div className="model-selector-popover"><div className="model-selector-menu is-status" role="dialog" aria-label={`${actorName} Agent 状态`}><div className="model-selector-agent-context"><span>当前 Agent</span><strong>{actorName}</strong></div>{modelLabel && <div className="model-selector-readonly"><span>模型</span><strong>{modelLabel}</strong></div>}<ContextUsage usage={view.usage} /></div></div>}
    </div>;
  }

  // 两级菜单恒是组合对的投影（§4.4）：强度段 = 当前显示 model 名下的合法 effort。
  const effortRows = displayed ? view.selections.filter((row) => row.model === displayed.model)
    .map((row) => ({ id: row.effort, label: row.effortLabel })) : [];
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
      aria-label={displayed ? `${actorName}，模型 ${modelLabel}，推理强度 ${effortLabel}${busy ? '，切换中' : ''}` : `${actorName}，模型未知`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen((current) => { if (!current) onOpen?.(); return !current; }); setSection(''); }}
    >
      <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
      <strong className="model-selector-actor">{actorName}</strong>
      {displayed && <span className="model-selector-divider" aria-hidden="true" />}
      {displayed && <span className="model-selector-current"><strong>{modelLabel}</strong><span>{effortLabel}</span></span>}
      <ContextUsage usage={view.usage} compact />
      {busy ? <span className="model-selector-pending">切换中</span> : <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />}
    </button>
    {open && <div className={`model-selector-popover${section ? ' has-section' : ''}`}>
      <div className="model-selector-menu" role="menu" aria-label="模型设置">
        <div className="model-selector-agent-context"><span>当前 Agent</span><strong>{actorName}</strong></div>
        {(['model', 'effort']).map((kind) => <button type="button" role="menuitem" key={kind} className={section === kind ? 'active' : ''} onClick={() => setSection(kind)}>
          <span>{SECTION_LABEL[kind]}</span><span className="model-selector-menu-value">{(kind === 'model' ? modelLabel : effortLabel) || '—'}</span><ChevronRight size={16} aria-hidden="true" />
        </button>)}
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
    </div>}
  </div>;
}
