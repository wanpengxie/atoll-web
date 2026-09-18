import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { apply, createChannelState } from '../../../src/model/fold.js';
import { Timeline } from '../../../src/ui/Timeline.jsx';
import '../../../src/styles.css';

document.body.style.cssText = 'margin:0;font:14px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'width:900px;height:640px;max-width:100vw';

const root = createRoot(document.getElementById('root'));
let current = { fact: 'terminal', rosterRevision: 1, lines: 1, network: 'open' };

function envelope(id, kind, payload, parentId = '') {
  return {
    id,
    ...(parentId ? { parent_id: parentId } : {}),
    kind,
    type: 'agent.ask',
    ts: Date.now(),
    sender: kind === 'request' ? { kind: 'human', id: 'me' } : { kind: 'agent', id: 'agent' },
    audience: kind === 'request' ? ['agent'] : ['me'],
    visibility: 'public',
    payload,
  };
}

function model() {
  const state = createChannelState('fixture');
  apply(state, { channel_id: 'fixture', seq: 1, envelope: envelope('request', 'request', { text: '真实 WaitingLayer 消息' }) });
  const status = current.fact === 'queued' || current.fact === 'partial' || current.fact === 'roster'
    ? 'queued'
    : current.fact === 'running'
      ? 'processing'
      : 'completed';
  const controls = status === 'queued'
    ? [{ word: 'agent.replace' }, { word: 'agent.steer' }]
    : status === 'processing'
      ? [{ word: 'agent.interrupt' }, { word: 'agent.replace' }]
      : undefined;
  apply(state, {
    channel_id: 'fixture',
    seq: 2,
    envelope: envelope('response', 'response', {
      status,
      ...(controls ? { controls } : {}),
      ...(status === 'completed' ? { text: 'terminal answer' } : {}),
    }, 'request'),
  });
  const history = {
    status: { attached: true, controlCurrent: true, generation: 1, headSeq: 2 },
    request: async () => ({ kind: 'exhausted' }),
    markRead() {},
  };
  return { state, history };
}

function Input() {
  return <section className="composer-wrap">
    <div className="composer-surface">
      <div className="composer-input-area"><div className="composer-box">
        <div className="composer-editor" aria-label="消息">{Array.from({ length: current.lines }, (_, index) => <p key={index}>{`输入行 ${index + 1}`}</p>)}</div>
      </div></div>
      <div className="composer-toolbar"><span>附件</span><button type="button">↑</button></div>
    </div>
    <div className="composer-state-rail">{current.network !== 'open' && <p className={`composer-status state-${current.network}`} role="status">{current.network}</p>}</div>
  </section>;
}

function paint() {
  const { state, history } = model();
  const roster = [
    { id: 'me', kind: 'human', name: '我' },
    { id: 'agent', kind: 'agent', name: `Agent ${current.rosterRevision}` },
  ];
  flushSync(() => root.render(<Timeline
    state={state}
    history={history}
    composer={<Input />}
    roster={roster}
    selfId="me"
    pending={[]}
    approvalStates={{}}
    access="member_active"
    surfaceVisible
  />));
}

function rect(selector) {
  const node = document.querySelector(selector);
  if (!node) return null;
  const bounds = node.getBoundingClientRect();
  return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height };
}

paint();
window.waitingTimeline = {
  geometry() {
    return {
      surface: rect('.conversation-surface'),
      reading: rect('.conversation-reading-slot'),
      stack: rect('.conversation-bottom-stack'),
      input: rect('.conversation-input-slot'),
      composer: rect('.composer-surface'),
      waiting: rect('.agent-wait-layer'),
    };
  },
  async transition(patch, frameCount = 4) {
    current = { ...current, ...patch };
    paint();
    const frames = [];
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise(requestAnimationFrame);
      frames.push(this.geometry());
    }
    return frames;
  },
};
