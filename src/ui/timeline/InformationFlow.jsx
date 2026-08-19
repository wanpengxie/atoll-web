import React from 'react';

export function MessageFrame({ className = '', actions = null, identity = null, contentClassName = '', children }) {
  return <article className={`message-row ${className}`.trim()} tabIndex="0">
    {actions}
    <div className="information-flow-avatar-slot">{identity}</div>
    <div className={`message-body information-flow-content ${contentClassName}`.trim()}>{children}</div>
  </article>;
}

export function ContentFrame({ children, contained = false }) {
  return <div className={`information-flow-row ${contained ? 'contained' : ''}`.trim()}>
    <div className="information-flow-avatar-slot" aria-hidden="true" />
    <div className="information-flow-content">{children}</div>
  </div>;
}
