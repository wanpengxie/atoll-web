import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { apply, createChannelState } from '../../../src/model/fold.js';
import { createViewSessionStore } from '../../../src/model/view-session.js';
import { Timeline } from '../../../src/ui/Timeline.jsx';

const channelID = 'answer-slot';
const self = 'human:root:1';
const agent = 'agent:writer:1';
const requestID = 'request-1';
const stageText = 'sealed answer target\n\n```mermaid\ngraph LR\n  A --> B\n```';
const secondStageText = 'second sealed answer target';
const state = createChannelState(channelID);
const viewSessions = createViewSessionStore({ storage: null, principalID: 'answer-slot' });
const root = createRoot(document.getElementById('root'));
const history = {
  status: {
    attached: true,
    generation: 1,
    messageCurrent: true,
    localReplicaReady: true,
    headSeq: 3,
    presentationRevision: 0,
    coverage: [{ lowSeq: 1, highSeq: 3 }],
    sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 3 },
  },
  request: async () => ({ kind: 'exhausted' }),
  markRead() {},
};

apply(state, { channel_id: channelID, seq: 1, envelope: {
  id: requestID,
  kind: 'request',
  type: 'agent.ask',
  ts: 1,
  sender: { id: self, kind: 'human' },
  audience: [agent],
  visibility: 'public',
  payload: { body: { text: 'write the answer' } },
} });
apply(state, { channel_id: channelID, seq: 2, envelope: {
  id: 'stage-text-1',
  parent_id: requestID,
  kind: 'response',
  type: 'agent.ask',
  ts: 2,
  sender: { id: agent, kind: 'agent' },
  audience: [self],
  visibility: 'public',
  payload: { body: { status: 'processing', process: { kind: 'stage', stage: 'text', text: stageText } } },
} });

function paint() {
  history.status.presentationRevision = Number(state._timelineRevision || state.lastSeq || 0);
  flushSync(() => root.render(<Timeline
    state={state}
    history={history}
    viewSessions={viewSessions}
    roster={[
      { id: self, kind: 'human', name: 'Me' },
      { id: agent, kind: 'agent', name: 'Writer' },
    ]}
    selfId={self}
    pending={[]}
    approvalStates={{}}
    access="member_active"
    surfaceVisible
  />));
}

let selected = null;
function currentContent(marker = '') {
  const contents = [...document.querySelectorAll('.agent-turn-bubble .markdown-content')];
  return marker ? contents.find((node) => node.textContent.includes(marker)) : contents[0];
}

paint();

window.answerSlot = {
  ready: () => Boolean(currentContent()?.querySelector('[data-reading-block-id]')),
  select(marker = 'sealed answer target') {
    const content = currentContent(marker);
    const block = [...content.querySelectorAll('[data-reading-block-id]')]
      .find((candidate) => candidate.textContent.includes(marker));
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.textContent.includes(marker)) text = walker.nextNode();
    const start = text.textContent.indexOf('answer');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 'answer'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    selected = {
      row: content.closest('[data-presentation-row-id]'),
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
    apply(state, { channel_id: channelID, seq: 3, envelope: {
      id: 'stage-text-2',
      parent_id: requestID,
      kind: 'response',
      type: 'agent.ask',
      ts: 3,
      sender: { id: agent, kind: 'agent' },
      audience: [self],
      visibility: 'public',
      payload: { body: { status: 'processing', process: { kind: 'stage', stage: 'text', text: secondStageText } } },
    } });
    paint();
  },
  finish(mode = 'same') {
    const text = mode === 'continued'
      ? `${stageText}\n\ncontinued after terminal`
      : mode === 'second-same' ? secondStageText
      : mode === 'rewritten' ? 'a genuinely rewritten terminal answer' : stageText;
    const seq = Number(state.lastSeq || 0) + 1;
    apply(state, { channel_id: channelID, seq, envelope: {
      id: 'terminal-1',
      parent_id: requestID,
      kind: 'response',
      type: 'agent.ask',
      ts: seq,
      sender: { id: agent, kind: 'agent' },
      audience: [self],
      visibility: 'public',
      payload: { body: { status: 'completed', text } },
    } });
    paint();
  },
  identity() {
    const content = [...document.querySelectorAll('.agent-turn-bubble .markdown-content')]
      .find((node) => node.dataset.readingContentKey === selected.contentKey);
    const block = [...content?.querySelectorAll('[data-reading-block-id]') || []]
      .find((candidate) => candidate.textContent.includes(selected.marker));
    const walker = block ? document.createTreeWalker(block, NodeFilter.SHOW_TEXT) : null;
    let text = walker?.nextNode() || null;
    while (text && !text.textContent.includes(selected.marker)) text = walker.nextNode();
    return {
      selection: getSelection().toString(),
      anchorConnected: getSelection().anchorNode?.isConnected === true,
      rowSame: content?.closest('[data-presentation-row-id]') === selected.row,
      cardSame: content?.closest('.agent-conversation-turn') === selected.card,
      bubbleSame: content?.closest('.agent-turn-bubble') === selected.bubble,
      wrapperSame: content?.closest('.agent-progress-text, .agent-final-text') === selected.wrapper,
      contentSame: content === selected.content,
      blockSame: block === selected.block,
      textSame: text === selected.text,
      mermaidSame: content?.querySelector('.mermaid-block') === selected.mermaid,
    };
  },
  rewriteState() {
    const terminal = document.querySelector('.agent-final-text .markdown-content');
    return {
      progressSlots: document.querySelectorAll('.agent-progress-text').length,
      finalSlots: document.querySelectorAll('.agent-final-text').length,
      terminalText: terminal?.textContent || '',
      terminalContentSameSelected: terminal === selected.content,
      contentKeys: [...document.querySelectorAll('.agent-progress-text .markdown-content, .agent-final-text .markdown-content')]
        .map((node) => node.dataset.readingContentKey),
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
