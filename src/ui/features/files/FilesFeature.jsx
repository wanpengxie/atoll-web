import React, { useMemo, useRef, useState } from 'react';
import { Download, FolderPlus, Paperclip, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { featureFileCrumbs, featureFileSize, parentFeatureDirectory } from '../../../model/feature-files.js';
import { SelectMenu } from '../../primitives/SelectMenu.jsx';

function modifiedLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function sortEntries(entries, sort) {
  const direction = sort.direction === 'descending' ? -1 : 1;
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : right.kind === 'directory' ? 1 : 0;
    let result = 0;
    if (sort.key === 'size') result = Number(left.size || 0) - Number(right.size || 0);
    else if (sort.key === 'modified') result = Date.parse(left.modifiedAt || 0) - Date.parse(right.modifiedAt || 0);
    else result = String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', { numeric: true });
    return result * direction;
  });
}

function Breadcrumbs({ directory, rootName, onNavigate }) {
  return <nav className="file-breadcrumbs" aria-label="文件路径">
    {featureFileCrumbs(directory, rootName).map((crumb, index, rows) => <React.Fragment key={crumb.directory || 'root'}>
      <button type="button" aria-current={index === rows.length - 1 ? 'page' : undefined} onClick={() => onNavigate?.(crumb.directory)}>{crumb.name}</button>
      {index < rows.length - 1 && <span aria-hidden="true">›</span>}
    </React.Fragment>)}
  </nav>;
}

function FileRows({ entries, selectedKey, disabled, attachDisabled, commands }) {
  const [sort, setSort] = useState({ key: 'name', direction: 'ascending' });
  const rows = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const changeSort = (key) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
  }));
  const activate = (entry) => {
    commands.select?.(entry);
    if (entry.kind === 'directory') commands.navigate?.(entry.directory || entry.path || `${entry.name}/`);
    else commands.preview?.(entry);
  };
  return <div className="channel-file-list" role="table" aria-label="当前目录内容">
    <div className="finder-list-header" role="row">
      {[['name', '名称'], ['modified', '修改日期'], ['size', '大小'], ['kind', '种类']].map(([key, label]) => <span role="columnheader" aria-sort={sort.key === key ? sort.direction : 'none'} key={key}><button type="button" className={`finder-sort-button finder-sort-${key}`} onClick={() => changeSort(key)}>{label}</button></span>)}
      <span aria-hidden="true" />
    </div>
    {rows.map((entry, index) => <div
      className={`channel-file-row ${index % 2 ? 'row-tinted' : 'row-light'}${selectedKey === entry.key ? ' is-selected' : ''}${entry.kind === 'directory' ? ' directory-row' : ''}`}
      role="row"
      tabIndex={0}
      aria-selected={selectedKey === entry.key}
      key={entry.key || entry.resourceId || entry.path || entry.name}
      onDoubleClick={() => activate(entry)}
      onClick={() => commands.select?.(entry)}
      onKeyDown={(event) => { if (event.key === 'Enter') activate(entry); }}
    >
      <span className="finder-name-cell" role="cell"><span className={`file-kind-icon${entry.kind === 'directory' ? ' folder-icon' : ''}`} aria-hidden="true">{entry.kind === 'directory' ? '▰' : '▤'}</span><strong>{entry.name}</strong></span>
      <span className="finder-date-cell" role="cell">{modifiedLabel(entry.modifiedAt)}</span>
      <span className="finder-size-cell" role="cell">{entry.kind === 'file' ? featureFileSize(entry.size) : '—'}</span>
      <span className="finder-type-cell" role="cell">{entry.kind === 'directory' ? '文件夹' : entry.mediaType || '文件'}</span>
      <span className="channel-file-actions" role="cell">
        {entry.kind === 'file' && <>
          <button type="button" aria-label={`下载 ${entry.name}`} onClick={(event) => { event.stopPropagation(); commands.download?.(entry); }}><Download size={15} /></button>
          <button type="button" aria-label={`附加 ${entry.name}`} disabled={attachDisabled} onClick={(event) => { event.stopPropagation(); commands.attach?.(entry); }}><Paperclip size={15} /></button>
        </>}
        <button type="button" className="danger" aria-label={`删除 ${entry.name}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); commands.remove?.(entry); }}><Trash2 size={15} /></button>
      </span>
    </div>)}
  </div>;
}

export function FilesFeature({ channel, port = {}, visible = true, onClose }) {
  const uploadRef = useRef(null);
  const [folderName, setFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const commands = port.commands || {};
  const entries = port.entries || [];
  const devices = port.devices || [];
  const disabled = port.disabled === true;
  const submitFolder = (event) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    commands.createDirectory?.({ name, directory: port.directory || '', deviceId: port.deviceId || '' });
    setFolderName('');
    setCreatingFolder(false);
  };
  const chooseUpload = (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length) commands.upload?.({ files, directory: port.directory || '', deviceId: port.deviceId || '' });
  };
  return <section id="workspace-panel-files" className="workspace-view artifacts-view channel-files-view" hidden={!visible} role="region" aria-label="频道文件">
    <div className="finder-toolbar">
      <button type="button" className="finder-nav-button" aria-label="返回上一级" disabled={!port.directory} onClick={() => commands.navigate?.(parentFeatureDirectory(port.directory))}>‹</button>
      <Breadcrumbs directory={port.directory || ''} rootName={channel?.name || channel?.qualified_name || '文件'} onNavigate={commands.navigate} />
      <div className="finder-tools">
        {devices.length > 1 ? <SelectMenu ariaLabel="文件挂载设备" value={port.deviceId || ''} options={devices.map((row) => ({ value: row.id, label: row.name || row.id }))} onChange={commands.selectDevice} /> : devices[0] && <span className="finder-device">{devices[0].name || devices[0].id}</span>}
        <button type="button" className="finder-tool-button labeled" disabled={disabled || port.busy} onClick={() => setCreatingFolder(true)}><FolderPlus size={15} />新建文件夹</button>
        <button type="button" className="finder-tool-button" aria-label="刷新文件目录" disabled={port.busy} onClick={() => commands.refresh?.()}><RefreshCw size={15} /></button>
        <button type="button" className="finder-upload finder-native-upload" disabled={disabled || port.uploading} onClick={() => uploadRef.current?.click()}><Upload size={14} />{port.uploading ? '上传中…' : '上传'}</button>
        <input ref={uploadRef} hidden multiple type="file" onChange={chooseUpload} />
        {onClose && <button type="button" className="finder-tool-button" aria-label="关闭文件" onClick={onClose}><X size={15} /></button>}
      </div>
    </div>
    {creatingFolder && <form className="new-folder-form" onSubmit={submitFolder}><label>新文件夹名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label><button type="submit" disabled={disabled || !folderName.trim()}>创建</button><button type="button" onClick={() => setCreatingFolder(false)}>取消</button></form>}
    <div className="workspace-view-scroll channel-files-scroll" aria-busy={port.busy || undefined}>
      {port.error && <p className="governance-error" role="alert">{port.error}</p>}
      {(port.recent || []).length > 0 && <section className="recent-files" aria-label="最近查看的文件"><strong>最近查看</strong><div>{port.recent.slice(0, 8).map((entry) => <button type="button" key={entry.key || entry.resourceId} onClick={() => commands.preview?.(entry)}>{entry.name}</button>)}</div></section>}
      {!port.deviceId && devices.length === 0 ? <div className="artifact-empty"><strong>这个频道还没有可用的文件挂载</strong><p>连接设备后，这里会显示频道文件。</p></div> : <FileRows entries={entries} selectedKey={port.selectedKey} disabled={disabled} attachDisabled={port.attachDisabled === true} commands={commands} />}
      {port.busy && !entries.length && <div className="artifact-empty"><strong>正在读取目录…</strong></div>}
      {!port.busy && port.deviceId && !entries.length && <div className="artifact-empty"><strong>当前目录为空</strong><p>可以新建文件夹或上传文件。</p></div>}
      {port.next && <button type="button" className="bounded-list-control" onClick={() => commands.loadMore?.(port.next)}>载入更多</button>}
    </div>
  </section>;
}
