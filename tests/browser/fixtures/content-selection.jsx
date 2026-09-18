import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  MarkdownContent,
  describeContentTextPoint,
  resolveContentTextPoint,
} from '../../../src/ui/MarkdownContent.jsx';

const initial = 'first sealed target\n\nsecond sealed\n\nactive';
let setSource;
let setVisible;
let selectedBlock;
let selectedText;
let point;

function App() {
  const [source, update] = useState(initial);
  const [visible, show] = useState(true);
  setSource = update;
  setVisible = show;
  return visible ? <MarkdownContent contentKey="browser:content-selection" text={source} /> : null;
}

flushSync(() => createRoot(document.getElementById('root')).render(<App />));

const blocks = () => [...document.querySelectorAll('[data-reading-block-id]')];
window.contentSelectionFixture = {
  ready: () => blocks().length === 3,
  select() {
    selectedBlock = blocks()[0];
    selectedText = selectedBlock.querySelector('p').firstChild;
    const range = document.createRange();
    range.setStart(selectedText, 6);
    range.setEnd(selectedText, 12);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return getSelection().toString();
  },
  appendTail() {
    flushSync(() => setSource(`${initial} continues`));
  },
  prependBlock() {
    flushSync(() => setSource(`new prefix\n\n${initial} continues`));
  },
  selectionState() {
    const current = blocks().find((block) => block.textContent === 'first sealed target');
    return {
      selection: getSelection().toString(),
      blockSame: current === selectedBlock,
      textSame: current?.querySelector('p').firstChild === selectedText,
      anchorSame: getSelection().anchorNode === selectedText,
      anchorConnected: getSelection().anchorNode?.isConnected === true,
    };
  },
  capturePoint() {
    const block = blocks().find((candidate) => candidate.textContent === 'first sealed target');
    point = describeContentTextPoint(block, block.textContent.indexOf('target'));
    return point;
  },
  editPointBlock() {
    flushSync(() => setSource('new first sealed target\n\nsecond sealed\n\nactive'));
  },
  leave() {
    flushSync(() => setVisible(false));
  },
  return() {
    flushSync(() => setVisible(true));
  },
  reflowWidth() {
    document.getElementById('root').style.width = '120px';
    return document.getElementById('root').getBoundingClientRect().width;
  },
  resolvedPoint() {
    const resolved = resolveContentTextPoint(document.getElementById('root'), point);
    return resolved ? {
      blockText: resolved.block.textContent,
      textOffset: resolved.textOffset,
      suffix: resolved.node.textContent.slice(resolved.offset),
      blockMatch: resolved.blockMatch,
      textMatch: resolved.textMatch,
    } : null;
  },
};
