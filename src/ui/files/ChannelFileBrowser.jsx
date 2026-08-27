import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, File, Folder } from 'lucide-react';
import { normalizeDirectory } from '../../model/channel-files.js';

export function fileCrumbs(directory, rootName) {
  const parts = normalizeDirectory(directory).split('/').filter(Boolean);
  return [{ name: rootName, directory: '' }, ...parts.map((name, index) => ({
    name,
    directory: `${parts.slice(0, index + 1).join('/')}/`,
  }))];
}

export function formatFileSize(size) {
  if (!Number.isFinite(Number(size))) return '—';
  const value = Number(size);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function formatFileModified(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export function FileBreadcrumbs({ browser, rootName = browser.qualifiedChannel }) {
  return <nav className="file-breadcrumbs" aria-label="文件路径">
    {fileCrumbs(browser.directory, rootName).map((crumb, index, rows) => <React.Fragment key={crumb.directory || 'root'}>
      <button type="button" aria-current={index === rows.length - 1 ? 'page' : undefined} onClick={() => browser.navigate(crumb.directory)}>{crumb.name}</button>
      {index < rows.length - 1 && <ChevronRight size={13} aria-hidden="true" />}
    </React.Fragment>)}
  </nav>;
}

function FileGlyph({ entry }) {
  return entry.kind === 'directory'
    ? <span className="file-kind-icon folder-icon" aria-hidden="true"><Folder size={16} /></span>
    : <span className="file-kind-icon" aria-hidden="true"><File size={14} /></span>;
}

const SORT_COLUMNS = [
  { key: 'name', label: '名称' },
  { key: 'modified', label: '修改日期' },
  { key: 'size', label: '大小' },
  { key: 'kind', label: '种类' },
];

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function kindOrder(entry) {
  return entry.kind === 'directory' ? 0 : entry.kind === 'file' ? 1 : 2;
}

export function sortFileEntries(entries, sort) {
  const direction = sort.direction === 'descending' ? -1 : 1;
  return [...entries].sort((left, right) => {
    // Finder-style grouping keeps folders discoverable while sorting file facts.
    if (sort.key !== 'kind' && kindOrder(left) !== kindOrder(right)) return kindOrder(left) - kindOrder(right);
    let result = 0;
    if (sort.key === 'name') result = nameCollator.compare(left.name, right.name);
    if (sort.key === 'kind') result = kindOrder(left) - kindOrder(right);
    if (sort.key === 'modified') {
      const leftValue = Date.parse(left.modifiedAt || '');
      const rightValue = Date.parse(right.modifiedAt || '');
      const leftMissing = Number.isNaN(leftValue);
      const rightMissing = Number.isNaN(rightValue);
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (!leftMissing) result = leftValue - rightValue;
    }
    if (sort.key === 'size') {
      const leftMissing = !Number.isFinite(Number(left.size));
      const rightMissing = !Number.isFinite(Number(right.size));
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (!leftMissing) result = Number(left.size) - Number(right.size);
    }
    if (result) return result * direction;
    return nameCollator.compare(left.name, right.name) || String(left.key).localeCompare(String(right.key));
  });
}

function SortHeader({ column, sort, onSort }) {
  const active = sort.key === column.key;
  return <span role="columnheader" aria-sort={active ? sort.direction : 'none'}>
    <button type="button" className={`finder-sort-button finder-sort-${column.key}`} onClick={() => onSort(column.key)}>
      <span>{column.label}</span>
      {active && (sort.direction === 'ascending' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)}
    </button>
  </span>;
}

export function FileBrowserRows({ browser, mode = 'manage', onActivateFile, renderActions }) {
  const [sort, setSort] = useState({ key: 'name', direction: 'ascending' });
  const entries = useMemo(() => sortFileEntries(browser.entries, sort), [browser.entries, sort]);
  const changeSort = (key) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
  }));
  const activate = (entry) => {
    browser.setSelectedKey(entry.key);
    if (entry.kind === 'directory') browser.openDirectory(entry);
    else if (entry.kind === 'file') onActivateFile?.(entry);
  };

  return <div className={`channel-file-list file-browser-${mode}`} role="table" aria-label="当前目录内容" aria-busy={browser.busy}>
    <div className="finder-list-header" role="row">
      {SORT_COLUMNS.map((column) => <SortHeader key={column.key} column={column} sort={sort} onSort={changeSort} />)}
      <span aria-hidden="true" />
    </div>
    {entries.map((entry, index) => {
      const selected = browser.selectedKey === entry.key;
      const className = `channel-file-row ${index % 2 ? 'row-tinted' : 'row-light'}${selected ? ' is-selected' : ''}${entry.kind === 'directory' ? ' directory-row' : ''}`;
      const contents = <>
        <span className="finder-name-cell" role="cell"><FileGlyph entry={entry} /><strong>{entry.name}</strong></span>
        <span className="finder-date-cell" role="cell">{formatFileModified(entry.modifiedAt)}</span>
        <span className="finder-size-cell" role="cell">{entry.kind === 'file' ? formatFileSize(entry.size) : '—'}</span>
        <span className="finder-type-cell" role="cell">{entry.kind === 'directory' ? '文件夹' : entry.kind === 'file' ? '文件' : '不支持的节点'}</span>
        {mode === 'pick' ? <span className="finder-row-disclosure" aria-hidden="true">{entry.kind === 'directory' ? '›' : entry.kind === 'file' ? '选择' : '不可选'}</span> : renderActions?.(entry)}
      </>;
      if (mode === 'pick') return <button type="button" className={className} aria-pressed={selected} disabled={entry.kind === 'other'} key={entry.key} onClick={() => activate(entry)}>{contents}</button>;
      return <div className={className} role="row" tabIndex={0} aria-selected={selected} key={entry.key}
        onClick={(event) => { if (event.detail < 2) activate(entry); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(entry); } }}>
        {contents}
      </div>;
    })}
    {browser.status === 'loading' && <div className="artifact-empty"><strong>正在读取目录…</strong></div>}
    {browser.status === 'ready' && !browser.entries.length && <div className="artifact-empty"><strong>当前目录为空</strong><p>可以新建文件夹或上传文件。</p></div>}
    {browser.next && <button type="button" className="bounded-list-control" disabled={browser.status === 'loading-more'} onClick={browser.loadMore}>{browser.status === 'loading-more' ? '正在载入…' : '载入更多'}</button>}
  </div>;
}
