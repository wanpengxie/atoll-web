import React from 'react';

export function PanelCard({ as = 'section', title, titleMeta, action, variant = '', className = '', children, ...props }) {
  const Component = as;
  const classes = ['panel-card', variant && `panel-card-${variant}`, className].filter(Boolean).join(' ');
  return <Component className={classes} {...props}>
    {(title || action) && <header className="panel-card-header">
      {title && <h3>{title}{titleMeta && <small>{titleMeta}</small>}</h3>}
      {action}
    </header>}
    {children}
  </Component>;
}
