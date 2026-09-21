import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useTimelineRowRenderer } from '../../../src/ui/timeline/TimelineRowRenderer.jsx';

const requestID = 'request-1';
const firstStageID = 'stage-text-1';
const secondStageID = 'stage-text-2';
const terminalID = 'terminal-1';
const firstStageText = 'sealed answer target\n\n```mermaid\ngraph LR\n  A --> B\n```';
const secondStageText = 'second sealed answer target';

function stageObservation(id, text, seq) {
  const envelope = {
    id,
    kind: 'response',
    parent_id: requestID,
    sender: { id: 'agent-1', kind: 'agent' },
    ts: seq,
    payload: { body: { status: 'processing', process: { kind: 'stage', stage: 'text', text } } },
  };
  return { seq, envelope, process: envelope.payload.body.process };
}

function rowFor({ secondStage = false, terminalText = null, revision = 1 } = {}) {
  const request = {
    id: requestID,
    kind: 'request',
    type: 'agent.ask',
    ts: 1,
    sender: { id: 'human-1', kind: 'human' },
    audience: ['agent-1'],
    payload: { body: { text: 'write the answer' } },
  };
  const provisional = [stageObservation(firstStageID, firstStageText, 2)];
  if (secondStage) provisional.push(stageObservation(secondStageID, secondStageText, 3));
  const terminal = terminalText == null ? null : {
    id: terminalID,
    kind: 'response',
    type: 'agent.ask',
    parent_id: requestID,
    sender: { id: 'agent-1', kind: 'agent' },
    audience: ['human-1'],
    ts: 4,
    payload: { body: { status: 'completed', text: terminalText } },
  };
  const turn = {
    requestId: requestID,
    request,
    requestSeq: 1,
    lastSeq: terminal ? 4 : secondStage ? 3 : 2,
    provisional,
    terminal,
    terminalSeq: terminal ? 4 : 0,
    status: terminal ? 'completed' : 'pending',
    thread: [],
  };
  return {
    id: requestID,
    seqLow: 1,
    seqHigh: terminal ? 4 : secondStage ? 3 : 2,
    contentRevision: revision,
    visualSlotID: requestID,
    body: { kind: 'turn', turn, thread: [] },
  };
}

function AnswerSlotHarness({ model }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'tc0137', narration: [] },
    names: new Map([
      ['human-1', { name: 'Me' }],
      ['agent-1', { name: 'Writer' }],
    ]),
    selfId: 'human-1',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow(rowFor(model));
}

let setModel;
function App() {
  const [model, update] = useState({ secondStage: false, terminalText: null, revision: 1 });
  setModel = update;
  return <main><AnswerSlotHarness model={model} /></main>;
}

flushSync(() => createRoot(document.getElementById('root')).render(<App />));

let selected = null;
const contentNodes = () => [...document.querySelectorAll('.agent-turn-bubble .markdown-content')];
const targetContent = (marker = 'sealed answer target') => contentNodes().find((node) => node.textContent.includes(marker));
const targetBlock = (marker = 'sealed answer target') => {
  const content = targetContent(marker);
  return [...(content?.querySelectorAll('[data-reading-block-id]') || [])]
    .find((block) => block.textContent.includes(marker));
};

window.answerSlot = {
  ready: () => Boolean(targetBlock() && document.querySelector('.mermaid-block')),
  select(marker = 'sealed answer target') {
    const block = targetBlock(marker);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.textContent.includes(marker)) text = walker.nextNode();
    const start = text.textContent.indexOf('answer');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 'answer'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const content = block.closest('.markdown-content');
    selected = {
      row: content.closest('[data-message-id]'),
      card: content.closest('.agent-conversation-turn'),
      bubble: content.closest('.agent-turn-bubble'),
      wrapper: content.closest('.agent-progress-text, .agent-final-text'),
      content,
      block,
      text,
      mermaid: content.querySelector('.mermaid-block'),
      marker,
      contentKey: content.dataset.readingContentKey,
    };
    return getSelection().toString();
  },
  addSecondStage() {
    flushSync(() => setModel({ secondStage: true, terminalText: null, revision: 2 }));
  },
  finish() {
    flushSync(() => setModel({ secondStage: true, terminalText: secondStageText, revision: 3 }));
  },
  identity() {
    const content = contentNodes().find((node) => node.dataset.readingContentKey === selected.contentKey);
    const block = [...(content?.querySelectorAll('[data-reading-block-id]') || [])]
      .find((candidate) => candidate.textContent.includes(selected.marker));
    const walker = block ? document.createTreeWalker(block, NodeFilter.SHOW_TEXT) : null;
    let text = walker?.nextNode() || null;
    while (text && !text.textContent.includes(selected.marker)) text = walker.nextNode();
    return {
      selection: getSelection().toString(),
      anchorConnected: getSelection().anchorNode?.isConnected === true,
      rowSame: content?.closest('[data-message-id]') === selected.row,
      cardSame: content?.closest('.agent-conversation-turn') === selected.card,
      bubbleSame: content?.closest('.agent-turn-bubble') === selected.bubble,
      wrapperSame: content?.closest('.agent-progress-text, .agent-final-text') === selected.wrapper,
      contentSame: content === selected.content,
      blockSame: block === selected.block,
      textSame: text === selected.text,
      mermaidSame: content?.querySelector('.mermaid-block') === selected.mermaid,
    };
  },
  slotState() {
    return [...document.querySelectorAll('.agent-progress-text, .agent-final-text')].map((slot) => ({
      kind: slot.classList.contains('agent-final-text') ? 'final' : 'progress',
      text: slot.textContent,
      contentKey: slot.querySelector('.markdown-content')?.dataset.readingContentKey || '',
    }));
  },
};
