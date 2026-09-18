import React from 'react';

/**
 * Shell-owned conversation geometry.
 *
 * The reading slot ends at one topology-specific, fixed bottom reserve.
 * Composer and Waiting form an independently painted stack anchored to the
 * surface bottom. Expanded content may cover the reading layer and must use
 * its existing internal overflow; it never resizes reading and never
 * publishes a scrolling request. SurfaceShell separately owns real layout or
 * visual viewport changes such as a mobile keyboard.
 */
export function ConversationSurface({ children, input, floating = null, className = '' }) {
  const surfaceClass = ['conversation-surface', className].filter(Boolean).join(' ');

  return <div className={surfaceClass}>
    <div className="conversation-reading-slot">{children}</div>
    <div className="conversation-bottom-stack">
      <div className="conversation-floating-slot">{floating}</div>
      <div className="conversation-input-slot">{input}</div>
    </div>
  </div>;
}
