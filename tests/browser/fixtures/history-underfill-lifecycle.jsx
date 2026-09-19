import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { apply, createChannelState } from '../../../src/model/fold.js';
import { Timeline } from '../../../src/ui/Timeline.jsx';
import '../../../src/styles.css';

document.body.style.cssText = 'margin:0;font:14px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'width:900px;height:640px;max-width:100vw';

const channelID = 'history-underfill-lifecycle';
const state = createChannelState(channelID);
apply(state, {
  channel_id: channelID,
  seq: 9,
  envelope: {
    id: 'hidden-session-tail',
    channel_id: channelID,
    kind: 'event',
    type: 'terminal.session',
    visibility: 'public',
    sender: { id: 'system:channel:1', kind: 'system' },
    audience: [],
    payload: { body: { event: 'closed' } },
  },
}, '');

const requests = [];
let retryPublished = false;
const history = {
  status: {},
  request(options) {
    requests.push({
      reason: options.reason,
      intent: options.intent,
      urgency: options.urgency,
      scope: options.viewSpec?.scope || '',
      selfId: options.viewSpec?.selfId || '',
    });
    if (requests.length === 1) return Promise.resolve({ kind: 'failed', error: new Error('temporary') });
    return new Promise(() => {});
  },
  markRead() {},
};
const root = createRoot(document.getElementById('root'));

function paint() {
  history.status = {
    attached: true,
    generation: 7,
    messageCurrent: true,
    headSeq: 90,
    localReplicaReady: true,
    loading: retryPublished,
    hasOlder: true,
    completedPages: 1,
    error: retryPublished ? 'temporary' : '',
    retryAt: retryPublished ? Date.now() : 0,
    presentationRevision: state._timelineRevision,
  };
  flushSync(() => root.render(<Timeline
    state={state}
    history={history}
    roster={[]}
    selfId=""
    pending={[]}
    approvalStates={{}}
    access="member_active"
    surfaceVisible
  />));
}

paint();
window.historyUnderfillLifecycle = {
  publishSchedulerRetry() {
    retryPublished = true;
    paint();
  },
  snapshot() {
    return {
      requests: [...requests],
      foreground: Boolean(document.querySelector('.timeline-history-demand')),
      partial: Boolean(document.querySelector('.empty-ledger[data-scope-state="partial"]')),
      confirming: [...document.querySelectorAll('.timeline-history-status')]
        .some((node) => node.textContent?.includes('确认频道内容')),
    };
  },
};
