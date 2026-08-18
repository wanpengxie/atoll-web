import React, { useLayoutEffect, useRef } from 'react';
import { PanelTabs } from './PanelTabs.jsx';

export function SidePanel({ ariaLabel, eyebrow, title, closeLabel = `关闭${title}`, tabs = [], activeTab, onTabChange, onClose, className = '', children }) {
  const scrollRef = useRef(null);
  const classes = ['side-panel', tabs.length && 'side-panel-with-tabs', className].filter(Boolean).join(' ');
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeTab]);
  return <aside className={classes} aria-label={ariaLabel}>
    <header className="side-panel-header">
      <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}>×</button>
    </header>
    {tabs.length > 0 && <PanelTabs label={`${title}区域`} tabs={tabs} activeTab={activeTab} onChange={onTabChange} />}
    <div className="side-panel-scroll" ref={scrollRef}>{children}</div>
  </aside>;
}
