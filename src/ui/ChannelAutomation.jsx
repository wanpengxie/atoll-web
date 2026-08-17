import React, { useState } from 'react';
import { parseJSONObject } from '../model/space-administration.js';
import { timerPayload } from '../model/timers.js';

export function ChannelAutomation({ channel, records, disabled, onAfter, onCancel, onClose }) {
  const [duration, setDuration] = useState('5000');
  const [msgType, setMsgType] = useState('human.text');
  const [payload, setPayload] = useState('{"text":"定时消息"}');
  const [error, setError] = useState('');
  async function create() {
    setError('');
    try { await onAfter(timerPayload({ channelId: channel.id, durationMs: Number(duration), msgType, payload: parseJSONObject(payload, '消息 payload') })); }
    catch (failure) { setError(failure.message || String(failure)); }
  }
  return <aside className="governance-panel automation-panel" aria-label="定时动作">
    <header><div><p className="eyebrow">LOCAL AUTOMATION</p><h2>定时动作</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭定时动作">×</button></header>
    <div className="governance-scroll">
      <section className="local-fact"><strong>本设备记录</strong><p>服务端没有 timer list/OBS。这里仅保存本浏览器收到的 timer_id，不代表跨设备完整清单。</p></section>
      {error && <p className="governance-error" role="alert">{error}</p>}
      <section className="governance-card governance-form"><h3>安排消息</h3><label>延迟（毫秒）<input aria-label="定时延迟毫秒" type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)} /></label><label>消息类型<input aria-label="定时消息类型" value={msgType} onChange={(e) => setMsgType(e.target.value)} /></label><label>Payload JSON<textarea aria-label="定时 Payload JSON" rows="7" value={payload} onChange={(e) => setPayload(e.target.value)} /></label><button type="button" className="primary-button" disabled={disabled} onClick={create}>创建定时动作</button></section>
      <section className="governance-card"><h3>当前浏览器保存的动作</h3>{records.filter((row) => row.channelId === channel.id).map((row) => <div className="timer-row" key={row.timerId}><div><strong>{row.msgType}</strong><small>{row.timerId}</small><small>{new Date(row.dueAt).toLocaleString('zh-CN')} · {row.provenance}</small></div><span className={`timer-state state-${row.state}`}>{row.state === 'scheduled' ? '已安排' : row.state === 'cancelled' ? '已取消' : row.state === 'fired' ? '已触发' : row.state}</span>{row.state === 'scheduled' && <button type="button" disabled={disabled} onClick={() => onCancel(row.timerId)}>取消</button>}</div>)}{!records.some((row) => row.channelId === channel.id) && <p className="governance-empty">本设备尚未保存定时动作。</p>}</section>
    </div>
  </aside>;
}
