import React, { useState } from 'react';
import { TYPES } from '../protocol/vocab.js';

const META_FIELDS = new Set(['status', 'reason', 'error_code', 'detail', 'cancelled', 'closed_by']);
const SENSITIVE_FIELD = /^(password|secret|secret_hash|token|access_token|refresh_token|private_key|key|credential)$/i;

const FAILURE_LABELS = {
  unanswered_timeout: '请求在截止时间前没有得到最终响应',
  receiver_unavailable: '接收方已不可用',
  receiver_internal_error: '接收方处理失败',
  type_unsupported: '接收方不支持这个操作',
  payload_invalid: '请求参数不符合要求',
  bad_payload: '请求格式不正确',
  forbidden: '没有执行该操作的权限',
  permission_denied: '没有执行该操作的权限',
};

export function redactSensitive(value, key = '') {
  if (key && SENSITIVE_FIELD.test(key)) return '已隐藏';
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSensitive(item, name)]));
  }
  return value;
}

export function terminalPresentation(requestType, payload = {}) {
  const safe = redactSensitive(payload);
  const business = Object.fromEntries(Object.entries(safe || {}).filter(([key]) => !META_FIELDS.has(key)));
  if (payload.status === 'failed') {
    const code = payload.cancelled === true ? 'cancelled' : payload.error_code || payload.reason || '';
    return {
      kind: 'failed',
      title: payload.cancelled === true ? '任务已取消' : FAILURE_LABELS[code] || FAILURE_LABELS[payload.reason] || '请求失败',
      detail: payload.detail || '',
      code,
      value: business,
    };
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'text')) {
    return { kind: 'text', text: String(payload.text ?? ''), empty: payload.text === '' };
  }
  // actor.describe 的终态就是 Describe 平铺在 status 旁边：{class, interfaces,
  // capabilities, words}。
  if (requestType === TYPES.describe || (payload.words && payload.class)) {
    const value = Object.fromEntries(Object.entries(business).filter(([key]) => !META_FIELDS.has(key)));
    return { kind: 'describe', title: payload.class ? `${payload.class} 的能力` : 'Actor 能力', value };
  }
  if (payload.word || Object.prototype.hasOwnProperty.call(payload, 'value')) {
    return { kind: 'registrar', title: payload.word || requestType || '操作结果', value: safe.value, meta: business };
  }
  if (Object.keys(business).length) return { kind: 'structured', title: '结构化结果', value: business };
  return { kind: 'ack', title: '已完成' };
}

function Scalar({ value }) {
  if (value === null) return <span className="structured-null">null</span>;
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  return <span>{String(value)}</span>;
}

function StructuredTree({ value, depth = 0 }) {
  if (value == null || typeof value !== 'object') return <Scalar value={value} />;
  if (Array.isArray(value)) {
    const shown = value.slice(0, 20);
    return (
      <div className="structured-array">
        <p>{value.length} 项{value.length > shown.length ? `，先显示 ${shown.length} 项` : ''}</p>
        {shown.map((item, index) => <div className="structured-array-item" key={index}><code>{index + 1}</code><StructuredTree value={item} depth={depth + 1} /></div>)}
      </div>
    );
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span>空对象</span>;
  const content = <dl className="structured-object">{entries.map(([key, item]) => (
    <div key={key}><dt>{key}</dt><dd><StructuredTree value={item} depth={depth + 1} /></dd></div>
  ))}</dl>;
  return depth >= 2 ? <details><summary>{entries.length} 个字段</summary>{content}</details> : content;
}

function ChannelTable({ rows }) {
  return (
    <div className="structured-table-wrap"><table className="structured-table"><thead><tr><th>频道</th><th>名称</th><th>状态</th></tr></thead><tbody>
      {rows.slice(0, 100).map((row, index) => <tr key={row.id || row.channel_id || index}><td><code>{row.id || row.channel_id}</code></td><td>{row.qualified_name || row.name || '—'}</td><td>{row.status || (row.open === true ? 'open' : row.open === false ? 'closed' : '—')}</td></tr>)}
    </tbody></table></div>
  );
}

function parseJSONText(text) {
  const source = String(text || '').trim();
  if (!source || !['{', '['].includes(source[0])) return undefined;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function valueSummary(value) {
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} 个字段`;
  return '';
}

function CollapsibleResult({ title, value, children }) {
  const [open, setOpen] = useState(false);
  return <details className="structured-result-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>{title}</span><small>{valueSummary(value)}</small><span className="structured-result-action">{open ? '收起' : '展开'}</span></summary>
    <div className="structured-result-scroll">{children || <StructuredTree value={value} />}</div>
  </details>;
}

export function StructuredResult({ requestType = '', payload = {}, renderText }) {
  const view = terminalPresentation(requestType, payload);
  if (view.kind === 'text') {
    if (view.empty) return <p className="empty-result">返回了空文本</p>;
    const json = parseJSONText(view.text);
    if (json !== undefined) return <CollapsibleResult title="JSON 结果" value={json} />;
    return renderText ? renderText(view.text) : <p>{view.text}</p>;
  }
  if (view.kind === 'ack') return <p className="completion-ack">✓ {view.title}</p>;
  if (view.kind === 'failed') {
    return <div className="failure-result"><strong>{view.title}</strong>{view.code && <code>{view.code}</code>}{view.detail && <p>{view.detail}</p>}{Object.keys(view.value || {}).length > 0 && <CollapsibleResult title="错误数据" value={view.value} />}</div>;
  }
  if (view.kind === 'registrar') {
    const channelRows = Array.isArray(view.value)
      && view.value.length > 0
      && view.value.every((row) => row && typeof row === 'object' && ('id' in row || 'channel_id' in row));
    if (!view.value || typeof view.value !== 'object') return <div className="structured-result"><strong>{view.title}</strong><Scalar value={view.value} /></div>;
    return <div className="structured-result"><CollapsibleResult title={view.title} value={view.value}>{channelRows ? <ChannelTable rows={view.value} /> : <StructuredTree value={view.value} />}</CollapsibleResult></div>;
  }
  if (view.kind === 'describe') {
    return <div className="structured-result actor-describe-result"><CollapsibleResult title={view.title} value={view.value} /></div>;
  }
  return <div className="structured-result"><CollapsibleResult title={view.title} value={view.value} /></div>;
}
