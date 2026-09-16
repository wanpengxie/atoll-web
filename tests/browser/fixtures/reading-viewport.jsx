import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { VirtualTimelineAdapter } from '../../../src/ui/timeline/VirtualTimelineAdapter.jsx';
import '../../../src/styles/timeline.css';

document.documentElement.style.cssText = '--workspace: white; --timeline-track: 760px;';
document.body.style.cssText = 'margin:0; font: 16px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'display:flex; width:100%; height:600px; min-height:0';
let rows = Array.from({ length: 400 }, (_, index) => ({ id: `row-${index}`, contentRevision: 1, lines: 1 + index % 17 }));
let following = true;
const viewport = {
  adapterRef: { current: null }, isFollowing: () => following,
  handleUserIntent: (intent) => { if (intent === 'browse' || intent === 'older') following = false; },
  handleAnchorObserved() {}, handleAdapterSnapshot() {}, handleAtTopChange() {}, handleAtBottomChange() {}, handleRangeChanged() {},
};
const root = createRoot(document.getElementById('root'));
const paint = () => flushSync(() => root.render(<VirtualTimelineAdapter
  listKey="test" rows={rows} viewport={viewport}
  renderRow={(_index, row) => <div className="timeline-virtual-item">
    <strong>{row.id}</strong>
    {Array.from({ length: row.lines }, (_, i) => <p key={i} style={{ margin: '3px 0' }}>
      {('异构长文本 Natural wrapped message content. ').repeat(1 + i % 8)}
    </p>)}
  </div>}
/>));
function scroller() { return document.querySelector('.timeline-message-list'); }
function anchor() {
  const top = scroller().getBoundingClientRect().top;
  const node = [...scroller().querySelectorAll('[data-presentation-row-id]')].find((row) => row.getBoundingClientRect().bottom > top);
  return { id: node?.dataset.presentationRowId, offset: node?.getBoundingClientRect().top - top };
}
paint();
let generation = 0;
window.readingFixture = {
  anchor,
  scroll(delta) {
    scroller().dispatchEvent(new WheelEvent('wheel', { deltaY: delta }));
    scroller().scrollTop += delta;
    scroller().dispatchEvent(new Event('scroll'));
  },
  prepend() {
    generation++;
    rows = [...Array.from({ length: 30 }, (_, i) => ({ id: `old-${generation}-${i}`, contentRevision: 1, lines: 1 + i % 23 })), ...rows];
    paint();
  },
  append() {
    generation++;
    rows = [...rows, { id: `new-${generation}`, contentRevision: 1, lines: 12 }];
    paint();
  },
  growAbove() {
    const current = anchor();
    const node = scroller().querySelector(`[data-presentation-row-id="${current.id}"]`).previousElementSibling;
    if (!node?.dataset.presentationRowId) throw Error('No materialized predecessor');
    node.style.paddingBottom = '317px';
  },
  focus(id) { following = false; viewport.adapterRef.current.focus({ rowID: id }); },
  cancelNavigation(id) {
    viewport.adapterRef.current.focus({ rowID: id });
    scroller().dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
  },
  follow() { following = true; viewport.adapterRef.current.latest(); },
};
