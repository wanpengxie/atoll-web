import React, { useState } from 'react';
import { TYPES } from '../protocol/vocab.js';
import { parseJSONObject } from '../model/space-administration.js';
import { timerPayload } from '../model/timers.js';
import { PanelCard } from './primitives/PanelCard.jsx';
import { SidePanel } from './primitives/SidePanel.jsx';

export function ChannelAutomation({ channel, records, disabled, onAfter, onCancel, onClose, surface = 'context' }) {
  const [duration, setDuration] = useState('5000');
  const [msgType, setMsgType] = useState(TYPES.agentAsk);
  const [payload, setPayload] = useState('{"text":"定时消息"}');
  const [error, setError] = useState('');
  async function create() {
    setError('');
    try { await onAfter(timerPayload({ channelId: channel.id, durationMs: Number(duration), msgType, payload: parseJSONObject(payload, '消息 payload') })); }
    catch (failure) { setError(failure.message || String(failure)); }
  }
  const content = <>
      <section className="local-fact"><strong>本设备记录</strong><p>服务端没有 timer list/OBS。这里仅保存本浏览器收到的 timer_id，不代表跨设备完整清单。</p></section>
      {error && <p className="governance-error" role="alert">{error}</p>}
      <PanelCard className="governance-form" title="安排消息"><label>延迟（毫秒）<input aria-label="定时延迟毫秒" type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)} /></label><label>消息类型<input aria-label="定时消息类型" value={msgType} onChange={(e) => setMsgType(e.target.value)} /></label><label>Payload JSON<textarea aria-label="定时 Payload JSON" rows="7" value={payload} onChange={(e) => setPayload(e.target.value)} /></label><button type="button" className="primary-button" disabled={disabled} onClick={create}>创建定时动作</button></PanelCard>
      <PanelCard title="当前浏览器保存的动作">{records.filter((row) => row.channelId === channel.id).map((row) => <div className="timer-row" key={row.timerId}><div><strong>{row.msgType}</strong><small>{row.timerId}</small><small>{new Date(row.dueAt).toLocaleString('zh-CN')} · {row.provenance}</small></div><span className={`timer-state state-${row.state}`}>{row.state === 'scheduled' ? '已安排' : row.state === 'cancelled' ? '已取消' : row.state === 'fired' ? '已触发' : row.state}</span>{row.state === 'scheduled' && <button type="button" disabled={disabled} onClick={() => onCancel(row.timerId)}>取消</button>}</div>)}{!records.some((row) => row.channelId === channel.id) && <p className="governance-empty">本设备尚未保存定时动作。</p>}</PanelCard>
  </>;
  if (surface === 'workspace') {
    return <section className="workspace-view workspace-task-view" aria-label="定时动作">
      <header className="workspace-view-header"><div><p className="eyebrow">TASKS</p><h2>任务</h2></div><p>当前先承接已有的本设备自动动作；正式 WorkItem 将在 F4 汇总。</p></header>
      <div className="workspace-view-scroll">{content}</div>
    </section>;
  }
  return <SidePanel className="automation-panel" ariaLabel="定时动作" eyebrow="LOCAL AUTOMATION" title="定时动作" onClose={onClose}>{content}</SidePanel>;
}
