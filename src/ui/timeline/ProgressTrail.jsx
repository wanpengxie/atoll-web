import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { JsonView } from 'react-json-view-lite';
import { processObservations } from '../../model/turn-process.js';
import { useModalFocus } from '../primitives/useModalFocus.js';
import { MarkdownContent } from '../MarkdownContent.jsx';

// 回合的过程痕迹：工具调用行与 agent 的中间产物（note）是同一量级的东西，
// 合成一条按序的轨迹。进行中滚动显示末几条，回合落定后仍可展开回看——
// 过程恒不随终稿到达而消失。
const NOTE_LABEL = Object.freeze({ thinking: '思考', plan: '计划', text: '草稿' });
const THINKING_ONLY = '思考中…';
const SCROLL_ROWS = 2;

function timestampLabel(ts) {
  if (!ts) return '';
  const value = new Date(ts);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function durationLabel(start, now) {
  const started = new Date(start).getTime();
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const JSON_TREE_STYLES = Object.freeze({
  container: 'progress-json-tree',
  childFieldsContainer: 'progress-json-children',
  basicChildStyle: 'progress-json-row',
  collapseIcon: 'progress-json-toggle is-open',
  expandIcon: 'progress-json-toggle',
  collapsedContent: 'progress-json-collapsed',
  label: 'progress-json-label',
  clickableLabel: 'progress-json-label is-clickable',
  nullValue: 'progress-json-value is-null',
  undefinedValue: 'progress-json-value is-undefined',
  numberValue: 'progress-json-value is-number',
  stringValue: 'progress-json-value is-string',
  booleanValue: 'progress-json-value is-boolean',
  otherValue: 'progress-json-value',
  punctuation: 'progress-json-punctuation',
  noQuotesForStringValues: false,
  quotesForFieldNames: true,
  stringifyStringValues: true,
  ariaLables: { collapseJson: '收起 JSON 节点', expandJson: '展开 JSON 节点' },
});

const expandShallowJson = (level) => level < 2;

function rawToolData(row) {
  const value = {};
  if (row.input !== undefined) value.input = row.input;
  if (row.output !== undefined) value.output = row.output;
  return Object.keys(value).length ? value : null;
}

function toolRow(seq, envelope, ended, payload = envelope.payload || {}) {
  const tool = payload.tool || '工具';
  const detail = payload.detail || '';
  const status = payload.outcome || '';
  return {
    seq,
    lastSeq: seq,
    key: `tool:${payload.tool_call_id || seq}`,
    callId: payload.tool_call_id || '',
    kind: 'tool',
    label: `tool · ${tool}`,
    line: ended ? `tool: ${tool} ${status === 'failed' ? '失败' : '完成'}` : `tool: ${tool} …`,
    detail,
    input: payload.input,
    output: payload.output,
    status: ended ? status || 'completed' : 'started',
    ts: envelope.ts,
  };
}

function noteRow(seq, envelope, payload = envelope.payload || {}) {
  const kind = payload.stage;
  const { text } = payload;
  // codex 的思考区间没有文本可给（模型侧不下发明文）——它是一段状态，
  // 不是一条可展开的记录。
  if (!text) return { seq, lastSeq: seq, key: `note:${seq}`, kind, label: NOTE_LABEL[kind] || kind, line: THINKING_ONLY, body: '', ts: envelope.ts, stateOnly: true };
  return { seq, lastSeq: seq, key: `note:${seq}`, kind, label: NOTE_LABEL[kind] || kind, line: `${NOTE_LABEL[kind] || kind} · ${text}`, body: text, ts: envelope.ts };
}

export function progressRows(turn) {
  const rows = [];
  const tools = new Map();
  const scope = turn?.requestId || turn?.request?.id || 'turn';
  for (const observation of processObservations(turn)) {
    const { seq, envelope, process } = observation;
    if (process.kind === 'tool') {
      if (process.phase === 'started') {
        const row = toolRow(seq, envelope, false, process);
        rows.push(row);
        if (row.callId) tools.set(row.callId, row);
        continue;
      }
      if (process.phase !== 'ended') continue;
      const ended = toolRow(seq, envelope, true, process);
      const started = ended.callId && tools.get(ended.callId);
      if (started) {
        started.lastSeq = ended.seq;
        started.line = ended.line;
        started.status = ended.status;
        started.detail = ended.detail || started.detail;
        started.output = ended.output;
        started.ts = ended.ts || started.ts;
      } else {
        rows.push(ended);
      }
      continue;
    }
    if (process.kind === 'stage') rows.push(noteRow(seq, envelope, process));
  }
  rows.sort((a, b) => a.lastSeq - b.lastSeq || a.seq - b.seq);
  return rows.map((row) => ({ ...row, key: `${scope}:${row.key}` }));
}

const ProgressDetailContext = createContext(null);
export function useProgressDetail() { return useContext(ProgressDetailContext); }

// ProgressTrailHost 管住抽屉这一个全局浮层：轨迹行分散在每个回合卡片里，
// 但同一时刻只该有一个详情被拉开。
export function ProgressTrailHost({ children }) {
  const [row, setRow] = useState(null);
  const value = useMemo(() => ({
    open: setRow,
    sync(next) {
      setRow((current) => current?.key === next.key && current.lastSeq !== next.lastSeq ? next : current);
    },
  }), []);
  return <ProgressDetailContext.Provider value={value}>
    {children}
    {row && <ProgressDetailDrawer row={row} onClose={() => setRow(null)} />}
  </ProgressDetailContext.Provider>;
}

function ProgressDetailDrawer({ row, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const toolData = row.kind === 'tool' ? rawToolData(row) : null;
  useModalFocus({ dialogRef, initialFocusRef: closeRef, onClose });
  return <div className="progress-drawer-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose?.();
  }}>
    <aside ref={dialogRef} tabIndex={-1} className="progress-drawer" role="dialog" aria-modal="true" aria-label={`过程详情：${row.label}`}>
      <header className="progress-drawer-header">
        <div><strong>{row.label}</strong>{row.ts && !row.hideTimestamp && <small>{new Date(row.ts).toLocaleTimeString('zh-CN', { hour12: false })}</small>}</div>
        <button ref={closeRef} type="button" className="progress-drawer-close" aria-label="关闭详情" onClick={onClose}>×</button>
      </header>
      <div className="progress-drawer-body">
        {row.kind === 'tool' ? <div className="progress-tool-data">
          {toolData && <div className="progress-json-shell"><JsonView data={toolData} style={JSON_TREE_STYLES} shouldExpandNode={expandShallowJson} clickToExpandNode /></div>}
          {row.detail && <div className="progress-tool-detail"><strong>执行说明</strong><p>{row.detail}</p></div>}
          {row.input === undefined && row.output === undefined && !row.detail && <p className="progress-empty">这次调用没有返回可展示的数据。</p>}
        </div> : <MarkdownContent text={row.body} />}
      </div>
    </aside>
  </div>;
}

function RowMeta({ row, active = false, now = 0 }) {
  return <span className="progress-row-meta">
    {active && <span className="progress-row-duration" aria-hidden="true"><i />{durationLabel(row.ts, now)}</span>}
    {row.ts && <time dateTime={new Date(row.ts).toISOString()}>{timestampLabel(row.ts)}</time>}
  </span>;
}

function TrailRow({ row, onOpen, onSync, active = false, now = 0, showTime = false }) {
  useEffect(() => onSync?.(row), [onSync, row.key, row.lastSeq]);
  if (row.stateOnly) return <li className="progress-row is-state"><span className="progress-row-line">{row.line}</span>{showTime && <RowMeta row={row} active={active} now={now} />}</li>;
  return <li className="progress-row">
    <button type="button" onClick={() => onOpen?.({ ...row, hideTimestamp: !showTime })} title="查看完整内容"><span className="progress-row-line">{row.line}</span>{showTime && <RowMeta row={row} active={active} now={now} />}</button>
  </li>;
}

function PreviewRow({ row, active, now }) {
  return <li className={`progress-row preview${row.stateOnly ? ' is-state' : ''}`}>
    <span className="progress-row-line">{row.line}</span>
    <RowMeta row={row} active={active} now={now} />
  </li>;
}

// running=true：处理中，默认滚动显示末几条，可展开成全列表。
// running=false：回合已落定，收成一行入口，展开后是同一个列表。
export function ProgressTrail({ turn, running, title = '', startedAt = 0, mergedCount = 0 }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const detail = useProgressDetail();
  const rows = progressRows(turn);
  useEffect(() => {
    if (!running || rows.length === 0) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, rows.at(-1)?.key, rows.at(-1)?.lastSeq]);
  const visible = open ? rows : rows.slice(-SCROLL_ROWS);
  const toggle = <button type="button" className="progress-trail-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
    <span aria-hidden="true">⤷</span>
    <span>{rows.length} 条过程记录</span>
    <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
  </button>;

  if (!running) {
    if (rows.length === 0) return null;
    return <div className="progress-trail settled">
      {toggle}
      {open && <ol className="progress-trail-list">{rows.map((row) => <TrailRow key={row.key} row={row} onOpen={detail?.open} onSync={detail?.sync} />)}</ol>}
    </div>;
  }
  const latestKey = rows.at(-1)?.key;
  const started = startedAt || rows[0]?.ts;
  return <div className={`progress-trail running agent-processing-status${open ? ' is-open' : ''}`} role="status" aria-live="polite" onClick={(event) => {
    if (!event.target.closest('button')) setOpen((value) => !value);
  }}>
    <button type="button" className="progress-running-header" aria-label={`${open ? '收起' : '展开'}过程详情：${title}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <strong><i aria-hidden="true" />处理中: {title}{mergedCount ? `（含合并 ${mergedCount} 条）` : ''}</strong>
      <span className="progress-running-time"><b aria-hidden="true">运行 {durationLabel(started, now)}</b>{started && <time dateTime={new Date(started).toISOString()}>{timestampLabel(started)}</time>}</span>
    </button>
    {rows.length > 0 && <ol className="progress-trail-list">
      {visible.map((row) => open
        ? <TrailRow key={row.key} row={row} onOpen={detail?.open} onSync={detail?.sync} active={row.key === latestKey} now={now} showTime />
        : <PreviewRow key={row.key} row={row} active={row.key === latestKey} now={now} />)}
    </ol>}
  </div>;
}
