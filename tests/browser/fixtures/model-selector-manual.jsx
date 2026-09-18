// 手动挡下模型选择器的真实浏览器夹具（2026-09-18）。
//
// 它复现用户实际遇到的那条路：值域未就绪 → 点一下 → 取数在途 → 数据到达。
// jsdom 测不出真实点击是否被 React 吞掉（渲染期 setState 就会吞），所以这一条
// 必须在真浏览器里按下去看面板到底开不开。
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { agentSelectionView } from '../../../src/model/agent-selection.js';
import { ModelSelector } from '../../../src/ui/ModelSelector.jsx';
import '../../../src/styles.css';

document.body.style.cssText = 'margin:0;padding:40px;font:14px/1.5 sans-serif';

const DESCRIBE = {
  words: {
    'agent.select': {
      input_schema: {
        type: 'object',
        properties: { model: { type: 'string' }, effort: { type: 'string' } },
        oneOf: [
          { required: ['model', 'effort'], properties: { model: { const: 'opus', title: 'Opus' }, effort: { const: 'high', title: '高' } } },
          { required: ['model', 'effort'], properties: { model: { const: 'opus', title: 'Opus' }, effort: { const: 'low', title: '低' } } },
          { required: ['model', 'effort'], properties: { model: { const: 'sonnet', title: 'Sonnet' }, effort: { const: 'medium', title: '中' } } },
        ],
      },
    },
  },
};

function Harness() {
  const [view, setView] = useState(null);
  const [probes, setProbes] = useState(0);

  // onOpen = 手动挡的取数。真实应用里它发 actor.describe / agent.options，
  // 这里用一个 80ms 的延迟代表那一个来回。
  //
  // ?blank=1 时复现 2026-09-18 的回归：刷新那一瞬旧证据被清空（view→null），
  // 80ms 后同一个 actor 的新值域回来。面板不许因此关掉。
  const blankOnRefresh = new URLSearchParams(window.location.search).get('blank') === '1';
  const onOpen = useCallback(() => {
    setProbes((n) => n + 1);
    if (blankOnRefresh) setView(null);
    setTimeout(() => {
      setView(agentSelectionView({ actorId: 'claude', describe: DESCRIBE, usage: null }));
    }, 80);
  }, [blankOnRefresh]);

  return <div>
    <div data-testid="probe-count">{probes}</div>
    <div style={{ width: 320 }}>
      <ModelSelector
        target={{ kind: 'single', actorId: 'claude' }}
        actorName="Claude"
        view={view}
        candidates={[{ id: 'claude', kind: 'agent', name: 'Claude' }]}
        onOpen={onOpen}
        onChange={async () => {}}
      />
    </div>
  </div>;
}

createRoot(document.getElementById('root')).render(<Harness />);
