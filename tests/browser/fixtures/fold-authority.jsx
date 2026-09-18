import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { apply, createChannelState } from '../../../src/model/fold.js';
import { createViewSessionStore } from '../../../src/model/view-session.js';
import { Timeline } from '../../../src/ui/Timeline.jsx';
import '../../../src/styles.css';

document.body.style.cssText = 'margin:0;font:14px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'width:900px;height:640px;max-width:100vw';

const self = 'human:root:1';
const agentA = 'agent:a:1';
const agentB = 'agent:b:1';
const roster = [
  { id: self, kind: 'human', name: '我', principal: 'root' },
  { id: agentA, kind: 'agent', name: 'Agent A' },
  { id: agentB, kind: 'agent', name: 'Agent B' },
];
const longText = (marker) => [marker, ...Array.from({ length: 38 }, (_, index) => `${marker} 第 ${index + 1} 行`)].join('\n');
const root = createRoot(document.getElementById('root'));

let channelID = 'fold-authority-batches';
let state = createChannelState(channelID);
let viewSessions = createViewSessionStore({ storage: null, principalID: 'fold-authority' });
const history = {
  status: {
    attached: true,
    generation: 1,
    messageCurrent: true,
    localReplicaReady: true,
    headSeq: 100,
    presentationRevision: 0,
    coverage: [],
    sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 100 },
  },
  request: async () => ({ kind: 'exhausted' }),
  markRead() {},
};

function appendTurn(requestID, requestSeq, responseSeq, agentID, marker) {
  apply(state, { channel_id: channelID, seq: requestSeq, envelope: {
    id: requestID, kind: 'request', type: 'agent.ask', ts: requestSeq,
    sender: { id: self, kind: 'human' }, audience: [agentID], visibility: 'public',
    payload: { text: `${marker} question` },
  } });
  apply(state, { channel_id: channelID, seq: responseSeq, envelope: {
    id: `${requestID}-done`, parent_id: requestID, kind: 'response', type: 'agent.ask', ts: responseSeq,
    sender: { id: agentID, kind: 'agent' }, audience: [self], visibility: 'public',
    payload: { status: 'completed', text: longText(marker) },
  } });
}

function paint() {
  history.status.presentationRevision = Number(state._timelineRevision || state.lastSeq || 0);
  flushSync(() => root.render(<Timeline
    key={channelID}
    state={state}
    history={history}
    viewSessions={viewSessions}
    roster={roster}
    selfId={self}
    pending={[]}
    approvalStates={{}}
    access="member_active"
    surfaceVisible
  />));
}

function snapshot() {
  const scroller = document.querySelector('.timeline-message-list');
  return [...document.querySelectorAll('[data-presentation-row-id]')].map((row) => ({
    id: row.dataset.presentationRowId,
    text: row.textContent,
    expanded: [...row.querySelectorAll('.message-fold-toggle')].map((button) => button.getAttribute('aria-expanded')),
    folded: row.querySelectorAll('.message-fold.is-folded').length,
    scrollTop: Number(scroller?.scrollTop || 0),
    scrollHeight: Number(scroller?.scrollHeight || 0),
    clientHeight: Number(scroller?.clientHeight || 0),
  }));
}

appendTurn('mid-1', 40, 41, agentA, 'BATCH-ONE');
history.status.coverage = [{ lowSeq: 40, highSeq: 41 }];
paint();

window.foldAuthority = {
  snapshot,
  batch2() {
    appendTurn('mid-2', 59, 60, agentA, 'BATCH-TWO');
    history.status.coverage = [{ lowSeq: 40, highSeq: 60 }];
    paint();
  },
  authoritativeTail() {
    appendTurn('tail', 99, 100, agentA, 'AUTHORITATIVE-TAIL');
    history.status.coverage = [{ lowSeq: 40, highSeq: 100 }];
    paint();
  },
  prepend() {
    appendTurn('older', 20, 21, agentA, 'PREPENDED-OLDER');
    history.status.coverage = [{ lowSeq: 20, highSeq: 100 }];
    paint();
  },
  filteredGap() {
    channelID = 'fold-authority-filtered';
    state = createChannelState(channelID);
    viewSessions = createViewSessionStore({ storage: null, principalID: 'fold-authority-filtered' });
    viewSessions.writeConversation(channelID, { scope: 'mine', actorFilter: [agentA] });
    appendTurn('older-match', 20, 21, agentA, 'OLDER-MATCH');
    appendTurn('latest-match', 40, 41, agentA, 'LATEST-DEEP-MATCH');
    appendTurn('physical-tail', 99, 100, agentB, 'OTHER-PHYSICAL-TAIL');
    history.status.generation = 2;
    history.status.coverage = [{ lowSeq: 20, highSeq: 41 }, { lowSeq: 99, highSeq: 100 }];
    paint();
  },
  filteredSettled() {
    history.status.coverage = [{ lowSeq: 20, highSeq: 100 }];
    paint();
  },
  cacheFirst() {
    channelID = `fold-authority-cache-${history.status.generation + 1}`;
    state = createChannelState(channelID);
    viewSessions = createViewSessionStore({ storage: null, principalID: channelID });
    appendTurn('cache-tail', 99, 100, agentA, 'CACHE-FIRST-LATEST');
    history.status.generation += 1;
    history.status.coverage = [{ lowSeq: 99, highSeq: 99 }];
    paint();
  },
  authorizeCache({ wheel = false } = {}) {
    history.status.coverage = [{ lowSeq: 99, highSeq: 100 }];
    paint();
    if (wheel) document.querySelector('.timeline-message-list')?.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -120,
    }));
  },
};
