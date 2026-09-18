import React, { cloneElement, isValidElement } from 'react';

// Scoped adapter for semantic/presentation unit tests. It deliberately does
// not emulate reading position, paging, measurement, or Virtuoso lifecycle;
// those contracts keep the production MessageList in model and Chromium
// tests. Render the complete supplied snapshot: silently slicing changes the
// semantic row set and can make a fold/default assertion pass on the wrong
// presentation.
export function PresentationMessageList({ snapshot, renderRow }) {
  const rows = snapshot.rows;
  return <div className="timeline-message-list" role="region" aria-label="频道动态">
    {rows.map((row) => {
      const content = renderRow(row);
      const rendered = isValidElement(content)
        ? cloneElement(content, {
          className: [content.props.className, 'presentation-row', `presentation-row-${row.layoutClass}`]
            .filter(Boolean).join(' '),
          'data-content-revision': row.contentRevision,
        })
        : content;
      return <div key={row.id} data-presentation-row-id={row.id} className="presentation-row-shell">{rendered}</div>;
    })}
  </div>;
}
