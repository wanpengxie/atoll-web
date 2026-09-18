import React from 'react';

export function HistoryStartBoundary({ boundary }) {
  return <div className="timeline-history-boundary-slot" aria-hidden={boundary?.label ? undefined : 'true'}>
    {boundary?.label && <div
      className="timeline-history-boundary"
      data-phase="exhausted"
      data-generation={boundary.generation}
      role="status"
    >{boundary.label}</div>}
  </div>;
}
