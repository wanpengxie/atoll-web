import React, { useMemo, useState } from 'react';
import { actorNameFromMap, actorNameMap } from '../../model/actor-display.js';
import { taskControlContext } from '../../model/task-controls.js';
import { messagePresentation } from '../../model/message-presentation.js';
import { turnProcessSummary, turnStatusLabel } from '../../model/turn-presentation.js';
import { argsOf } from '../../protocol/envelope.js';
import { SidePanel } from '../primitives/SidePanel.jsx';
import { StructuredResult } from '../StructuredResult.jsx';

function timeLabel(value) {
  if (!value) return '时间未知';
  return new Date(value).toLocaleString('zh-CN');
}

function actorName(id, names) {
  return actorNameFromMap(id, names);
}

function requestSummary(request) {
  const view = messagePresentation(request);
  return [view.text, view.detail].filter(Boolean).join(' · ');
}

function RecordRow({ label, envelope, names }) {
  const payload = envelope?.payload || {};
  return <article className="turn-audit-row">
    <span className="turn-audit-mark" />
    <div><strong>{label}</strong><small>{actorName(envelope?.sender?.id, names)} · {timeLabel(envelope?.ts)}</small>{payload.detail && <p>{payload.detail}</p>}</div>
    <code>{payload.status ? turnStatusLabel({ status: payload.status }) : envelope?.type}</code>
  </article>;
}

function technicalLabel(envelope) {
  if (envelope?.type === 'agent.turn.started') return '开始处理';
  if (envelope?.type === 'agent.turn.ended') return '处理结束';
  if (envelope?.type?.startsWith('agent.tool.')) return `工具 · ${envelope.payload?.tool || '未知工具'}`;
  return '运行记录';
}

function ContextControls({ context, state = {}, onCancel, onControl }) {
  const [steering, setSteering] = useState(false);
  const [text, setText] = useState('');
  if (!context.canCancel && !context.canSteer && !state.status) return null;
  const busy = ['sending', 'accepted', 'uncertain'].includes(state.status);
  return <section className="turn-context-controls" aria-label="回合控制">
    <h3>控制</h3>
    <div>
      {context.canCancel && <button type="button" disabled={busy} onClick={onCancel}>{state.status === 'sending' ? '正在取消…' : '取消任务'}</button>}
      {context.canSteer && <button type="button" onClick={() => setSteering((value) => !value)}>调整方向</button>}
    </div>
    {steering && <div className="turn-context-steer"><textarea aria-label="回合的新方向" rows={4} value={text} onChange={(event) => setText(event.target.value)} /><div><button type="button" onClick={() => setSteering(false)}>取消</button><button type="button" disabled={!text.trim()} onClick={() => { onControl('agent.steer', { text: text.trim(), expected_turn_id: context.turnId }); setText(''); setSteering(false); }}>提交方向</button></div></div>}
    {state.status === 'accepted' && <p>控制请求已受理，最终状态仍以频道账本为准。</p>}
    {state.status === 'uncertain' && <p className="uncertain">结果待确认；重连后会按账本事实恢复。</p>}
    {state.error && <p className="error">{state.error.detail || state.error.code}</p>}
  </section>;
}

function TurnDetailBody({ turn, roster = [], selfId, access, capability, controlState, onCancel, onControl, onDownload, onSource, onCreateTask, showSource = true, showRequest = true }) {
  const names = useMemo(() => actorNameMap(roster), [roster]);
  if (!turn) return null;
  const request = turn.request;
  const context = taskControlContext(turn, { selfId, access, capability });
  return <>
    {showRequest && <div className="turn-context-source">
      <span>{actorName(request.sender?.id, names)} · {timeLabel(request.ts)}</span>
      <p>{requestSummary(request)}</p>
      {showSource && onSource && <button type="button" onClick={() => onSource({ view: 'dynamic', objectType: 'turn', objectId: turn.requestId, seq: turn.requestSeq })}>在动态中查看</button>}
    </div>}
    <section className={`turn-context-status status-${turn.status}`}><span className="turn-status-dot" /><div><strong>{turnStatusLabel(turn)}</strong><small>{turnProcessSummary(turn)}</small></div></section>
    {turn.terminal && <section className="turn-context-terminal"><h3>最终结果</h3><StructuredResult requestType={request.type} payload={turn.terminal.payload} renderText={(text) => <p>{text}</p>} /></section>}
    <section className="turn-context-section"><h3>业务进展</h3><div className="turn-context-process-scroll">{turn.provisional.length ? turn.provisional.map((item) => <RecordRow key={`${item.seq}-${item.envelope.id}`} label={item.envelope.payload?.detail || item.envelope.payload?.message || turnStatusLabel({ status: item.status })} envelope={item.envelope} names={names} />) : <p className="turn-context-empty">没有业务进展记录</p>}</div></section>
    <details className="turn-context-section turn-context-technical" open={!turn.terminal}>
      <summary>技术过程 <span>{turn.activity.length}</span></summary>
      <div className="turn-context-process-scroll">{turn.activity.length ? turn.activity.map((item) => <RecordRow key={`${item.seq}-${item.envelope.id}`} label={technicalLabel(item.envelope)} envelope={item.envelope} names={names} />) : <p className="turn-context-empty">没有工具或运行时活动</p>}</div>
    </details>
    <ContextControls context={context} state={controlState} onCancel={onCancel} onControl={onControl} />
    {argsOf(request).attachments?.length > 0 && <section className="turn-context-section"><h3>关联文件</h3>{argsOf(request).attachments.map((row) => <button type="button" className="turn-context-attachment" key={row.resource_id} onClick={() => onDownload(row)}><span>{row.name || row.resource_id}</span><small>{row.media_type || '文件'} · 下载</small></button>)}</section>}
    {onCreateTask && <div className="turn-context-business-actions"><button type="button" onClick={() => onCreateTask({ view: 'dynamic', objectType: 'turn', objectId: turn.requestId, seq: turn.requestSeq })}>从这个回合创建任务</button></div>}
    <details className="turn-context-diagnostics"><summary>技术审计{turn.anomalies.length ? ` · ${turn.anomalies.length} 个异常` : ''}</summary><dl className="turn-audit-facts"><div><dt>消息编号</dt><dd>{turn.requestId}</dd></div><div><dt>协议类型</dt><dd>{request.type}</dd></div><div><dt>账本序号</dt><dd>{turn.requestSeq}</dd></div>{turn.terminal?.id && <div><dt>终态编号</dt><dd>{turn.terminal.id}</dd></div>}</dl>{turn.anomalies.length > 0 && <div className="turn-anomaly-list">{turn.anomalies.map((item, index) => <p key={`${item.code}-${index}`}>{item.code || '未知异常'}{item.seq ? ` · 序号 ${item.seq}` : ''}</p>)}</div>}</details>
  </>;
}

export function TurnInlineDetail(props) {
  if (!props.turn) return null;
  return <section className="turn-inline-detail" role="region" aria-label="回合详情">
    <header className="turn-inline-header"><div><strong>回合详情</strong><small>结果、过程与控制</small></div><button type="button" onClick={props.onClose} aria-label="收起回合详情">收起</button></header>
    <div className="turn-inline-body"><TurnDetailBody {...props} showSource={false} showRequest={false} /></div>
  </section>;
}

export function TurnContext(props) {
  return <SidePanel className="turn-context" ariaLabel="回合详情" eyebrow="WORK TURN" title="回合详情" closeLabel="关闭回合详情" onClose={props.onClose}><TurnDetailBody {...props} /></SidePanel>;
}
