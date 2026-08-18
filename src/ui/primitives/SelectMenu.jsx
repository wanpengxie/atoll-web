import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

function firstEnabled(items) {
  return items.findIndex((item) => !item.disabled);
}

function nextEnabled(items, start, direction) {
  if (!items.length) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (start + direction * offset + items.length) % items.length;
    if (!items[index].disabled) return index;
  }
  return start;
}

export function SelectMenu({ id, ariaLabel, value = '', placeholder = '请选择', options = [], onChange, disabled = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState('bottom');
  const [availableHeight, setAvailableHeight] = useState(180);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const generatedId = useId();
  const listId = `${generatedId}-listbox`;
  const items = useMemo(() => [{ value: '', label: placeholder, disabled: false }, ...options], [options, placeholder]);
  const selectedIndex = items.findIndex((item) => item.value === value);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  useEffect(() => {
    if (!open) return undefined;
    setActiveIndex(selectedIndex >= 0 && !items[selectedIndex].disabled ? selectedIndex : firstEnabled(items));
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [items, open, selectedIndex]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !listRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const scrollBoundary = rootRef.current.closest('.side-panel-scroll');
    const boundaryRect = scrollBoundary?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight };
    const below = Math.max(0, boundaryRect.bottom - triggerRect.bottom - 6);
    const above = Math.max(0, triggerRect.top - boundaryRect.top - 6);
    const wanted = Math.min(180, listRef.current.scrollHeight);
    const nextPlacement = below < wanted && above > below ? 'top' : 'bottom';
    setPlacement(nextPlacement);
    setAvailableHeight(Math.max(48, Math.floor(nextPlacement === 'top' ? above : below)));
  }, [items.length, open]);

  function choose(index) {
    const item = items[index];
    if (!item || item.disabled) return;
    onChange(item.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      if (open) event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled(items));
      } else {
        setActiveIndex((current) => nextEnabled(items, current, event.key === 'ArrowDown' ? 1 : -1));
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === 'Home' ? firstEnabled(items) : items.findLastIndex((item) => !item.disabled));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else setOpen(true);
    }
  }

  return <div className={`select-menu ${className}`.trim()} ref={rootRef} data-open={open || undefined} data-invalid-value={Boolean(value && !selected) || undefined}>
    <button
      type="button"
      id={id}
      className="select-menu-trigger"
      role="combobox"
      aria-label={ariaLabel}
      aria-controls={open ? listId : undefined}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
      disabled={disabled}
      ref={triggerRef}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={handleKeyDown}
    >
      <span>{selected?.label || value || placeholder}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className={`select-menu-list placement-${placement}`} style={{ '--select-menu-available-height': `${availableHeight}px` }} ref={listRef} id={listId} role="listbox" aria-label={`${ariaLabel}选项`}>
      {items.map((item, index) => <button
        type="button"
        role="option"
        id={`${listId}-option-${index}`}
        aria-selected={item.value === value}
        className={`${item.value === value ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`.trim()}
        disabled={item.disabled}
        key={`${item.value}:${index}`}
        onMouseEnter={() => { if (!item.disabled) setActiveIndex(index); }}
        onClick={() => choose(index)}
      >{item.label}</button>)}
    </div>}
  </div>;
}
