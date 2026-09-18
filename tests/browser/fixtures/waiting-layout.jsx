import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ConversationSurface } from '../../../src/ui/conversation/ConversationSurface.jsx';
import '../../../src/styles/tokens.css';
import '../../../src/styles/base.css';
import '../../../src/styles/app-shell.css';
import '../../../src/styles/timeline.css';
import '../../../src/styles/composer.css';

document.documentElement.style.cssText = '--workspace:#f7f2e8;--raised:#fff;--input:#fff;--timeline-track:760px;';
document.body.style.cssText = 'margin:0;font:14px/1.5 sans-serif';
document.getElementById('root').style.cssText = 'width:900px;height:640px;max-width:100vw';

let setFixture;

function Waiting({ fact, rosterRevision, editing }) {
  if (!['queued', 'partial', 'roster'].includes(fact)) return null;
  return <div className="agent-wait-dock">
    <section className={`agent-wait-layer${editing ? ' is-editing' : ''}`} aria-label="等待区">
      <header className="agent-wait-header"><div><button type="button">收起</button></div></header>
      {fact === 'partial' && <p className="agent-wait-partial" role="status">等待证据尚未完整；当前只读。</p>}
      <section className="agent-wait-group">
        {fact === 'roster' && <header><strong>{`成员版本 ${rosterRevision}`}</strong></header>}
        <ol>
          <li className={`agent-wait-item${editing ? ' is-editing' : ''}`}>
            <div className="agent-wait-summary"><span className="agent-wait-position">↳</span><strong>{editing ? '正在编辑的等待消息' : '等待消息'}</strong></div>
            <div className="agent-wait-actions"><button type="button">编辑</button></div>
          </li>
        </ol>
      </section>
    </section>
  </div>;
}

function Input({ lines, network, editing }) {
  return <section className={`composer-wrap${editing ? ' is-editing-message' : ''}`}>
    <div className={`composer-surface${editing ? ' is-editing-message' : ''}`}>
      <div className="composer-input-area"><div className="composer-box">
        <div className="composer-editor" aria-label="消息" tabIndex={0}>{Array.from({ length: lines }, (_, index) => <p key={index}>{`输入行 ${index + 1}`}</p>)}</div>
      </div></div>
      <div className="composer-toolbar"><span>附件</span><button type="button">↑</button></div>
    </div>
    <div className="composer-state-rail">{network !== 'open' && <p className={`composer-status state-${network}`} role="status">{network}</p>}</div>
  </section>;
}

function App() {
  const [state, update] = useState({ fact: 'terminal', rosterRevision: 1, lines: 1, network: 'open', editing: false });
  setFixture = (patch) => update((current) => ({ ...current, ...patch }));
  return <ConversationSurface
    input={<Input lines={state.lines} network={state.network} editing={state.editing} />}
    floating={<Waiting fact={state.fact} rosterRevision={state.rosterRevision} editing={state.editing} />}
  >
    <section className="timeline" aria-label="reading viewport"><div className="timeline-inner">
      <span>reading viewport</span>
      <button type="button" className="fixture-last-row" style={{ marginTop: 'auto' }}>last visible row</button>
    </div></section>
  </ConversationSurface>;
}

flushSync(() => createRoot(document.getElementById('root')).render(<App />));

function rect(selector) {
  const node = document.querySelector(selector);
  if (!node) return null;
  const bounds = node.getBoundingClientRect();
  return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height };
}

window.waitingLayout = {
  geometry() {
    const surface = document.querySelector('.conversation-surface');
    return {
      surface: rect('.conversation-surface'),
      reading: rect('.conversation-reading-slot'),
      stack: rect('.conversation-bottom-stack'),
      input: rect('.conversation-input-slot'),
      composer: rect('.composer-surface'),
      floating: rect('.conversation-floating-slot'),
      waiting: rect('.agent-wait-layer'),
      lastRow: rect('.fixture-last-row'),
      lastRowOwnsHit: (() => {
        const node = document.querySelector('.fixture-last-row');
        const bounds = node?.getBoundingClientRect();
        if (!node || !bounds) return false;
        const target = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return target === node || node.contains(target);
      })(),
      floatingObstruction: Number.parseFloat(getComputedStyle(surface)
        .getPropertyValue('--conversation-floating-obstruction')) || 0,
      readingGap: Number.parseFloat(getComputedStyle(surface)
        .getPropertyValue('--conversation-reading-gap')) || 0,
    };
  },
  async transition(patch, frameCount = 4) {
    flushSync(() => setFixture(patch));
    const frames = [];
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise(requestAnimationFrame);
      frames.push(this.geometry());
    }
    return frames;
  },
};
