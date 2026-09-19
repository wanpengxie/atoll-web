import React, { useMemo, useRef, useState } from 'react';
import { searchFeatureIndex } from '../../../model/feature-search.js';
import { useModalFocus } from '../../primitives/useModalFocus.js';

const KIND_LABELS = {
  channel: '频道', message: '消息', actor: '成员', task: '任务', file: '文件',
};
const KIND_ORDER = ['channel', 'message', 'actor', 'task', 'file'];

function joinScope(labels) {
  if (labels.length < 2) return labels[0] || '可见内容';
  return `${labels.slice(0, -1).join('、')}和${labels.at(-1)}`;
}

export function SearchFeature({ port = {} }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const commands = port.commands || {};
  const scope = useMemo(() => joinScope(KIND_ORDER
    .filter((kind) => (port.index || []).some((item) => item?.kind === kind))
    .map((kind) => KIND_LABELS[kind])), [port.index]);
  const results = useMemo(() => searchFeatureIndex(port.index || [], query, port.limit || 40), [port.index, port.limit, query]);
  useModalFocus({ dialogRef, initialFocusRef: inputRef, onClose: commands.close });
  return <div className="global-search-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) commands.close?.(); }}>
    <section ref={dialogRef} tabIndex={-1} className="global-search" role="dialog" aria-modal="true" aria-label="全局搜索">
      <header><div><p className="eyebrow">SEARCH</p><h2>搜索可见内容</h2></div><button type="button" className="icon-button" onClick={() => commands.close?.()} aria-label="关闭全局搜索">×</button></header>
      <label className="global-search-input"><span aria-hidden="true">⌕</span><input ref={inputRef} aria-label={`搜索${scope}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词…" /></label>
      <div className="global-search-results" aria-live="polite">
        {query.trim() && results.map((item, index) => <button type="button" className="global-search-result" key={item.key || `${item.kind}:${item.id || index}`} onClick={() => commands.open?.(item.source || item)}><span>{KIND_LABELS[item.objectType || item.kind] || '结果'}</span><strong>{item.title || item.name || '未命名结果'}</strong><small>{item.channelName || item.channelId || ''}{item.subtitle ? ` · ${item.subtitle}` : ''}</small></button>)}
        {!query.trim() && <p className="global-search-hint">当前可搜索：{scope}。范围仅包含 Workspace 当前提供的可见对象，不会读取不可访问频道或历史缓存。</p>}
        {query.trim() && !results.length && <p className="global-search-hint">没有匹配的可见结果。</p>}
      </div>
    </section>
  </div>;
}
