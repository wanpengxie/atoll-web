import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import { TYPES } from '../../protocol/vocab.js';
import { useModalFocus } from '../primitives/useModalFocus.js';
import { MarkdownContent } from '../MarkdownContent.jsx';

// 回合的过程痕迹：工具调用行与 agent 的中间产物（note）是同一量级的东西，
// 合成一条按序的轨迹。进行中滚动显示末几条，回合落定后仍可展开回看——
// 过程恒不随终稿到达而消失。
const NOTE_LABEL = Object.freeze({ thinking: '思考', plan: '计划', text: '草稿' });
const THINKING_ONLY = '思考中…';
const SCROLL_ROWS = 4;

function toolRow(seq, envelope, ended) {
  const tool = envelope.payload?.tool || '工具';
  const detail = envelope.payload?.detail || '';
  const status = envelope.payload?.status || '';
  return {
    seq,
    kind: 'tool',
    label: `tool · ${tool}`,
    line: ended ? `tool: ${tool} ${status === 'failed' ? '失败' : '完成'}${detail ? ` · ${detail}` : ''}` : `tool: ${tool} …`,
    body: detail,
    ts: envelope.ts,
  };
}

function noteRow(seq, envelope) {
  const { kind, text } = envelope.payload || {};
  // codex 的思考区间没有文本可给（模型侧不下发明文）——它是一段状态，
  // 不是一条可展开的记录。
  if (!text) return { seq, kind, label: NOTE_LABEL[kind] || kind, line: THINKING_ONLY, body: '', ts: envelope.ts, stateOnly: true };
  return { seq, kind, label: NOTE_LABEL[kind] || kind, line: `${NOTE_LABEL[kind] || kind} · ${text}`, body: text, ts: envelope.ts };
}

export function progressRows(turn) {
  const rows = [];
  for (const item of turn?.activity || []) {
    const env = item?.envelope;
    if (env?.type === TYPES.activity.toolStarted) rows.push(toolRow(Number(item.seq), env, false));
    if (env?.type === TYPES.activity.toolEnded) rows.push(toolRow(Number(item.seq), env, true));
  }
  for (const item of turn?.provisional || []) {
    const env = item?.envelope;
    if (env?.payload?.kind) rows.push(noteRow(Number(item.seq), env));
  }
  rows.sort((a, b) => a.seq - b.seq);
  return rows;
}

const ProgressDetailContext = createContext(null);
export function useProgressDetail() { return useContext(ProgressDetailContext); }

// ProgressTrailHost 管住抽屉这一个全局浮层：轨迹行分散在每个回合卡片里，
// 但同一时刻只该有一个详情被拉开。
export function ProgressTrailHost({ children }) {
  const [row, setRow] = useState(null);
  const value = useMemo(() => ({ open: setRow }), []);
  return <ProgressDetailContext.Provider value={value}>
    {children}
    {row && <ProgressDetailDrawer row={row} onClose={() => setRow(null)} />}
  </ProgressDetailContext.Provider>;
}

function ProgressDetailDrawer({ row, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useModalFocus({ dialogRef, initialFocusRef: closeRef, onClose });
  return <div className="progress-drawer-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose?.();
  }}>
    <aside ref={dialogRef} tabIndex={-1} className="progress-drawer" role="dialog" aria-modal="true" aria-label={`过程详情：${row.label}`}>
      <header className="progress-drawer-header">
        <div><strong>{row.label}</strong>{row.ts && <small>{new Date(row.ts).toLocaleTimeString('zh-CN', { hour12: false })}</small>}</div>
        <button ref={closeRef} type="button" className="progress-drawer-close" aria-label="关闭详情" onClick={onClose}>×</button>
      </header>
      <div className="progress-drawer-body">
        {row.kind === 'tool' ? <pre>{row.body || '（这一步没有留下细节）'}</pre> : <MarkdownContent text={row.body} />}
      </div>
    </aside>
  </div>;
}

function TrailRow({ row, onOpen }) {
  if (row.stateOnly) return <li className="progress-row is-state">{row.line}</li>;
  return <li className="progress-row">
    <button type="button" onClick={() => onOpen?.(row)} title="查看完整内容">{row.line}</button>
  </li>;
}

// running=true：处理中，默认滚动显示末几条，可展开成全列表。
// running=false：回合已落定，收成一行入口，展开后是同一个列表。
export function ProgressTrail({ turn, running }) {
  const [open, setOpen] = useState(false);
  const detail = useProgressDetail();
  const rows = progressRows(turn);
  if (rows.length === 0) return null;
  const visible = open ? rows : rows.slice(-SCROLL_ROWS);
  const toggle = <button type="button" className="progress-trail-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
    <span aria-hidden="true">⤷</span>
    <span>{rows.length} 条过程记录</span>
    <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
  </button>;

  if (!running) {
    return <div className="progress-trail settled">
      {toggle}
      {open && <ol className="progress-trail-list">{rows.map((row) => <TrailRow key={row.seq} row={row} onOpen={detail?.open} />)}</ol>}
    </div>;
  }
  return <div className="progress-trail running">
    <ol className={`progress-trail-list${open ? '' : ' is-tail'}`}>
      {visible.map((row) => <TrailRow key={row.seq} row={row} onOpen={detail?.open} />)}
    </ol>
    {rows.length > SCROLL_ROWS && toggle}
  </div>;
}
