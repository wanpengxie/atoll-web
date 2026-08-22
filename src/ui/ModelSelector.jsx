import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { selectedOption } from '../model/agent-selection.js';

const SECTION_LABEL = { model: '模型', effort: '推理强度' };

export function ModelSelector({ value, disabled = false, busy = false, onChange }) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('');
  const model = selectedOption(value?.models, value?.current?.model);
  const effort = selectedOption(value?.efforts, value?.current?.effort);
  const available = Boolean(value?.actorId && model && effort && value.models?.length && value.efforts?.length);

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
    if (busy || id === value.current[kind]) return;
    try {
      await onChange?.({ ...value.current, [kind]: id, actorId: value.actorId });
      setOpen(false);
      setSection('');
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch {
      // 全局错误条由提交层负责；菜单保持打开，允许用户重试或换一个选项。
    }
  };
  const rows = section === 'model' ? value.models : value.efforts;

  return <div className="model-selector" ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className="model-selector-trigger"
      disabled={disabled || busy}
      aria-label={`模型 ${model.label}，推理强度 ${effort.label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen((current) => !current); setSection(''); }}
    >
      <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
      <span className="model-selector-current"><strong>{model.label}</strong><span>{effort.label}</span></span>
      <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
    {open && <div className={`model-selector-popover${section ? ' has-section' : ''}`}>
      <div className="model-selector-menu" role="menu" aria-label="模型设置">
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
          aria-checked={value.current[section] === row.id}
          key={row.id}
          onClick={() => choose(section, row.id)}
        >
          <span><strong>{row.label}</strong>{row.description && <small>{row.description}</small>}</span>
          {value.current[section] === row.id && <Check size={17} strokeWidth={2} aria-hidden="true" />}
        </button>)}
      </div>}
    </div>}
  </div>;
}
