import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { selectedOption } from '../model/agent-selection.js';

const SECTION_LABEL = { model: '模型', effort: '推理强度' };

export function ModelSelector({ value, actorId = '', actorName = '', disabled = false, busy = false, onLoad, onChange }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('');
  const [resolved, setResolved] = useState(value);
  const [loading, setLoading] = useState(false);
  const targetActorId = actorId || value?.actorId || '';
  const model = selectedOption(resolved?.models, resolved?.current?.model);
  const effort = selectedOption(resolved?.efforts, resolved?.current?.effort);
  const available = Boolean(resolved?.actorId === targetActorId && model && effort && resolved.models?.length && resolved.efforts?.length);
  const displayActor = actorName || resolved?.actorId || targetActorId;

  useEffect(() => {
    let alive = true;
    if (!targetActorId) {
      setResolved(null);
      return undefined;
    }
    if (value?.actorId === targetActorId) {
      setResolved(value);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    Promise.resolve(onLoad?.(targetActorId)).then((next) => {
      if (alive) setResolved(next?.actorId === targetActorId ? next : null);
    }).catch(() => {
      if (alive) setResolved(null);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [targetActorId, value, onLoad]);

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

  if (!available) return null;

  const choose = async (kind, id) => {
    if (busy || loading || id === resolved.current[kind]) return;
    const previous = resolved;
    const next = { ...resolved, current: { ...resolved.current, [kind]: id } };
    setResolved(next);
    try {
      await onChange?.({ ...next.current, actorId: resolved.actorId });
      setOpen(false);
      setSection('');
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch {
      setResolved(previous);
      // 全局错误条由提交层负责；菜单保持打开，允许用户重试或换一个选项。
    }
  };
  const rows = section === 'model' ? resolved.models : resolved.efforts;

  return <div className="model-selector" ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className="model-selector-trigger"
      disabled={disabled || busy || loading}
      aria-label={`${displayActor}，模型 ${model.label}，推理强度 ${effort.label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen((current) => !current); setSection(''); }}
    >
      <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
      <strong className="model-selector-actor">{displayActor}</strong>
      <span className="model-selector-divider" aria-hidden="true" />
      <span className="model-selector-current"><strong>{model.label}</strong><span>{effort.label}</span></span>
      <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
    {open && <div className={`model-selector-popover${section ? ' has-section' : ''}`}>
      <div className="model-selector-menu" role="menu" aria-label="模型设置">
        <div className="model-selector-agent-context"><span>当前 Agent</span><strong>{displayActor}</strong></div>
        {(['model', 'effort']).map((kind) => {
          const selected = kind === 'model' ? model : effort;
          return <button type="button" role="menuitem" key={kind} className={section === kind ? 'active' : ''} onClick={() => setSection(kind)}>
            <span>{SECTION_LABEL[kind]}</span><span className="model-selector-menu-value">{selected.label}</span><ChevronRight size={16} aria-hidden="true" />
          </button>;
        })}
      </div>
      {section && <div className="model-selector-options" role="menu" aria-label={SECTION_LABEL[section]}>
        <div className="model-selector-options-title"><button type="button" onClick={() => setSection('')} aria-label="返回模型设置"><ArrowLeft size={16} aria-hidden="true" /></button><span>{SECTION_LABEL[section]}</span></div>
        {rows.map((row) => <button
          type="button"
          role="menuitemradio"
          aria-checked={resolved.current[section] === row.id}
          key={row.id}
          onClick={() => choose(section, row.id)}
        >
          <span><strong>{row.label}</strong>{row.description && <small>{row.description}</small>}</span>
          {resolved.current[section] === row.id && <Check size={17} strokeWidth={2} aria-hidden="true" />}
        </button>)}
      </div>}
    </div>}
  </div>;
}
