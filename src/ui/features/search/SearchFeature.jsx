import React, { useMemo, useRef, useState } from 'react';
import { searchFeatureIndex } from '../../../model/feature-search.js';
import { useModalFocus } from '../../primitives/useModalFocus.js';

const KIND_LABELS = {
  channel: '频道', entry: '动态', turn: '回合', artifact: '文件引用',
  work_item: '任务', participant: '成员', operation: '操作',
};

function openSearchResult(item, commands) {
  const source = item?.source || item;
  if (!source?.channelId) return;
  // Search owns the result presentation only. The Workspace command is the
  // sole route/access owner and receives one typed SourceRef envelope.
  commands.open?.({ source });
}

export function SearchFeature({ port = {} }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const commands = port.commands || {};
  const results = useMemo(() => searchFeatureIndex(port.index || [], query, port.limit || 40), [port.index, port.limit, query]);
  useModalFocus({ dialogRef, initialFocusRef: inputRef, onClose: commands.close });
  return <div className="global-search-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) commands.close?.(); }}>
    <section ref={dialogRef} tabIndex={-1} className="global-search" role="dialog" aria-modal="true" aria-label="全局搜索">
      <header><div><p className="eyebrow">SEARCH</p><h2>搜索可见内容</h2></div><button type="button" className="icon-button" onClick={() => commands.close?.()} aria-label="关闭全局搜索">×</button></header>
      <label className="global-search-input"><span aria-hidden="true">⌕</span><input ref={inputRef} aria-label="搜索频道、消息、文件、任务或成员" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词…" /></label>
      <div className="global-search-results" aria-live="polite">
        {query.trim() && results.map((item, index) => <button type="button" className="global-search-result" key={item.key || `${item.kind}:${item.id || index}`} onClick={() => openSearchResult(item, commands)}><span>{KIND_LABELS[item.objectType || item.kind] || '结果'}</span><strong>{item.title || item.name || '未命名结果'}</strong><small>{item.channelName || item.channelId || ''}{item.subtitle ? ` · ${item.subtitle}` : ''}</small></button>)}
        {!query.trim() && <p className="global-search-hint">搜索范围仅包含当前账户可以看到的频道与对象；不会从不可访问频道读取缓存。</p>}
        {query.trim() && !results.length && <p className="global-search-hint">没有匹配的可见结果。</p>}
      </div>
    </section>
  </div>;
}
