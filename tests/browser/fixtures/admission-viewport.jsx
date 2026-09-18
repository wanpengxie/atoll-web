import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MessageList } from '../../../src/ui/timeline/LegendMessageList.jsx';
import { FoldableBody } from '../../../src/ui/timeline/FoldableBody.jsx';
import { useReadingSession } from '../../../src/ui/timeline/useReadingSession.js';
import { createViewSessionStore } from '../../../src/model/view-session.js';
import '../../../src/styles/tokens.css';
import '../../../src/styles/timeline.css';

document.documentElement.style.cssText = '--workspace:white; --timeline-track:760px; --message-fold-lines:14;';
document.body.style.cssText = 'margin:0; font:16px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'display:flex; width:100%; height:600px; min-height:0';

const paragraph = (id, index) => `${id} 原正文段落 ${index} ${('异构长文本 Natural wrapped message content. ').repeat(1 + index % 8)}`;
const makeRow = (id, seq, lines, { expanded = false, mediaHeight = 0 } = {}) => Object.freeze({
  id,
  seqLow: seq,
  seqHigh: seq,
  contentRevision: `1:${seq}:${lines}:${Number(expanded)}:${mediaHeight}`,
  layoutClass: lines > 8 || mediaHeight > 0 ? 'rich' : 'normal',
  settled: true,
  lines,
  expanded,
  mediaHeight,
  text: Array.from({ length: lines }, (_, index) => paragraph(id, index)).join('\n'),
});

const originalRows = () => Array.from({ length: 400 }, (_, index) => makeRow(`row-${index}`, index + 1, 1 + index % 17));
const olderSpec = (index) => ({ id: `old-1-${index}`, seq: -30 + index, lines: 1 + index % 23 });
let rows = originalRows();
let revision = 1;
let firstItemIndex = 1_000_000;
let changes = { kind: 'rebase', prefixCount: 0, inserted: [], updated: [], removed: [] };
let reading;
const store = createViewSessionStore({ storage: null });
const history = {
  status: { hasOlder: false, attached: true, generation: 1, messageCurrent: true, headSeq: 400, presentationRevision: 1 },
  request: async () => ({ kind: 'exhausted' }),
};
const root = createRoot(document.getElementById('root'));

const snapshot = () => ({
  viewID: 'admission-fixture',
  revision,
  sourceRevision: revision,
  firstItemIndex,
  orderedIDs: rows.map((row) => row.id),
  rows,
  entities: new Map(rows.map((row) => [row.id, row])),
  changes,
});

function Fixture() {
  const current = snapshot();
  history.status.headSeq = current.rows.at(-1)?.seqHigh || 0;
  history.status.presentationRevision = current.sourceRevision;
  const owner = useReadingSession({
    channelID: 'admission-fixture', viewKey: 'admission-fixture', snapshot: current, history, viewSessions: store,
  });
  useLayoutEffect(() => { reading = owner; });
  return <MessageList
    snapshot={current}
    reading={owner}
    renderRow={(row) => <div className="timeline-virtual-item">
      <strong>{row.id}</strong>
      <FoldableBody id={`${row.id}:body`} text={row.text} expanded={row.expanded}>
        {Array.from({ length: row.lines }, (_, index) => (
          <p key={index} data-reading-block-id={`${row.id}:p:${index}`} style={{ margin: '3px 0' }}>{paragraph(row.id, index)}</p>
        ))}
        {row.mediaHeight > 0 && <div data-late-media style={{ height: `${row.mediaHeight}px`, background: '#ddd' }}>late media {row.id}</div>}
      </FoldableBody>
    </div>}
  />;
}

const paint = () => flushSync(() => root.render(<Fixture />));
const scroller = () => document.querySelector('.timeline-message-list');
const anchor = () => {
  const node = scroller();
  const top = node.getBoundingClientRect().top;
  const row = [...node.querySelectorAll('[data-presentation-row-id]')]
    .find((candidate) => candidate.getBoundingClientRect().bottom > top + 0.5);
  return { id: row?.dataset.presentationRowId || '', offset: (row?.getBoundingClientRect().top || 0) - top };
};

function commitPrepend(nextRows) {
  rows = [...nextRows, ...rows];
  firstItemIndex -= nextRows.length;
  revision += 1;
  changes = { kind: 'prepend', prefixCount: nextRows.length, inserted: nextRows.map((row) => row.id), updated: [], removed: [] };
  paint();
  return { revision, firstItemIndex, anchor: anchor() };
}

paint();

window.admissionFixture = {
  state: () => reading?.session,
  anchor,
  geometry() {
    const node = scroller();
    const bounds = node.getBoundingClientRect();
    const visible = [...node.querySelectorAll('[data-presentation-row-id]')].flatMap((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > bounds.top + 0.5 && rect.top < bounds.bottom - 0.5
        ? [{ id: row.dataset.presentationRowId || '', top: rect.top - bounds.top, bottom: rect.bottom - bounds.top }]
        : [];
    });
    return {
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      rowCount: rows.length,
      visible,
    };
  },
  scroll(delta) {
    const node = scroller();
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true }));
    node.scrollTop += delta;
    node.dispatchEvent(new Event('scroll'));
  },
  atomicPrepend() {
    return commitPrepend(Array.from({ length: 30 }, (_, index) => {
      const spec = olderSpec(index);
      return makeRow(spec.id, spec.seq, spec.lines);
    }));
  },
  prependOne(index, options = {}) {
    const spec = olderSpec(index);
    return commitPrepend([makeRow(spec.id, spec.seq, options.lines ?? spec.lines, options)]);
  },
  prependExtreme(options = {}) {
    return commitPrepend([makeRow('old-extreme', -1, 180, options)]);
  },
  grow(id, { lines, expanded, mediaHeight } = {}) {
    rows = rows.map((row) => row.id === id ? makeRow(row.id, row.seqLow, lines ?? row.lines, {
      expanded: expanded ?? row.expanded,
      mediaHeight: mediaHeight ?? row.mediaHeight,
    }) : row);
    revision += 1;
    changes = { kind: 'revise', prefixCount: 0, inserted: [], updated: [id], removed: [] };
    paint();
    return { revision, anchor: anchor() };
  },
};
