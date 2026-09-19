import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { apply, createChannelState } from '../../../src/model/fold.js';
import { createViewSessionStore } from '../../../src/model/view-session.js';
import { Timeline } from '../../../src/ui/Timeline.jsx';
import '../../../src/styles.css';

document.body.style.cssText = 'margin:0;font:14px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'width:900px;height:640px;max-width:100vw';

const channelID = 'opaque-filter-fixture';
const currentSelf = 'human:root:1900000000000';
const historicalSelf = 'human:root:1700000000000';
const claude = 'agent:claude:1800000000000';
const staleClaude = 'agent:claude:old-incarnation';
const state = createChannelState(channelID);

function append(seq, envelope) {
  apply(state, {
    channel_id: channelID,
    seq,
    envelope: {
      ts: seq,
      channel_id: channelID,
      visibility: 'public',
      ...envelope,
    },
  }, historicalSelf);
}

for (let seq = 1; seq <= 48; seq += 1) {
  append(seq, {
    id: `system-${seq}`,
    kind: 'event',
    type: 'system.member.updated',
    visibility: 'system',
    sender: { id: 'system:opaque:1', kind: 'system' },
    audience: [],
    payload: { body: { member: `opaque-${seq}` } },
  });
}
append(49, {
  id: 'ask-claude', kind: 'request', type: 'agent.ask',
  sender: { id: historicalSelf, kind: 'human' }, audience: [claude],
  correlation_id: 'ask-claude', payload: { body: { text: '历史 Claude 问题' } },
});
append(50, {
  id: 'done-claude', kind: 'response', type: 'agent.ask',
  sender: { id: claude, kind: 'agent' }, audience: [historicalSelf],
  parent_id: 'ask-claude', correlation_id: 'ask-claude',
  payload: { body: { status: 'completed', text: '历史 Claude 回答' } },
});

const viewSessions = createViewSessionStore({ principalID: 'member-filter-browser' });
viewSessions.writeConversation(channelID, { scope: 'mine', actorFilter: [staleClaude] });
const history = {
  status: {
    attached: true,
    generation: 3,
    messageCurrent: true,
    headSeq: 50,
    localReplicaReady: true,
    loading: false,
    hasOlder: false,
    presentationRevision: state._timelineRevision,
    sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 50 },
  },
  request: async () => ({ kind: 'exhausted' }),
  markRead() {},
};
const root = createRoot(document.getElementById('root'));
let rosterCurrent = false;

function paint() {
  const roster = [{ id: currentSelf, kind: 'human', name: '我', principal: 'root' }];
  if (rosterCurrent) roster.push({ id: claude, kind: 'agent', name: 'Claude', decl_id: 'claude' });
  flushSync(() => root.render(<Timeline
    state={state}
    history={history}
    viewSessions={viewSessions}
    roster={roster}
    selfId={currentSelf}
    pending={[]}
    approvalStates={{}}
    access="member_active"
    surfaceVisible
  />));
}

paint();
window.memberFilterTimeline = {
  settleRoster() {
    rosterCurrent = true;
    paint();
  },
  snapshot() {
    const scope = document.querySelector('[aria-label="动态范围"]');
    return {
      rowIDs: [...document.querySelectorAll('[data-presentation-row-id]')]
        .map((row) => row.dataset.presentationRowId),
      scopeDirectText: [...(scope?.childNodes || [])]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .filter(Boolean),
      filterLabels: [...document.querySelectorAll('[aria-label="按成员过滤"] button')]
        .map((button) => button.getAttribute('aria-label') || button.textContent.trim()),
      statuses: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent.trim()),
    };
  },
};
