import React, { useRef } from 'react';

function enabledIndex(tabs, start, direction) {
  if (!tabs.length) return -1;
  for (let offset = 1; offset <= tabs.length; offset += 1) {
    const index = (start + direction * offset + tabs.length) % tabs.length;
    if (!tabs[index].disabled) return index;
  }
  return start;
}

export function PanelTabs({ label, tabs, activeTab, onChange, className = '' }) {
  const refs = useRef([]);

  function moveFocus(event, index) {
    let next = index;
    if (event.key === 'ArrowRight') next = enabledIndex(tabs, index, 1);
    else if (event.key === 'ArrowLeft') next = enabledIndex(tabs, index, -1);
    else if (event.key === 'Home') next = tabs.findIndex((tab) => !tab.disabled);
    else if (event.key === 'End') next = tabs.findLastIndex((tab) => !tab.disabled);
    else return;
    event.preventDefault();
    if (next >= 0) {
      onChange(tabs[next].id);
      refs.current[next]?.focus();
    }
  }

  return <nav className={`panel-tabs ${className}`.trim()} aria-label={label} role="tablist">
    {tabs.map((tab, index) => <button
      type="button"
      role="tab"
      aria-selected={activeTab === tab.id}
      tabIndex={activeTab === tab.id ? 0 : -1}
      className={activeTab === tab.id ? 'active' : ''}
      disabled={tab.disabled}
      title={tab.label}
      key={tab.id}
      ref={(node) => { refs.current[index] = node; }}
      onClick={() => onChange(tab.id)}
      onKeyDown={(event) => moveFocus(event, index)}
    >{tab.label}</button>)}
  </nav>;
}
