import React from 'react';
import { ChevronRight, File, Folder } from 'lucide-react';
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

export function FileBrowserRows({ browser, mode = 'manage', onActivateFile, renderActions }) {
  const activate = (entry) => {
    if (entry.kind === 'directory') browser.openDirectory(entry);
    else if (entry.kind === 'file') onActivateFile?.(entry);
  };

  return <div className={`channel-file-list file-browser-${mode}`} role="table" aria-label="当前目录内容" aria-busy={browser.busy}>
    <div className="finder-list-header" role="row"><span role="columnheader">名称</span><span role="columnheader">修改日期</span><span role="columnheader">大小</span><span role="columnheader">种类</span><span aria-hidden="true" /></div>
    {browser.entries.map((entry, index) => {
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
        onClick={() => browser.setSelectedKey(entry.key)} onDoubleClick={() => activate(entry)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); activate(entry); } }}>
        {contents}
      </div>;
    })}
    {browser.status === 'loading' && <div className="artifact-empty"><strong>正在读取目录…</strong></div>}
    {browser.status === 'ready' && !browser.entries.length && <div className="artifact-empty"><strong>当前目录为空</strong><p>可以新建文件夹或上传文件。</p></div>}
    {browser.next && <button type="button" className="bounded-list-control" disabled={browser.status === 'loading-more'} onClick={browser.loadMore}>{browser.status === 'loading-more' ? '正在载入…' : '载入更多'}</button>}
  </div>;
}
