import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, ChevronRight, Download, File, Folder, FolderPlus, Paperclip, RefreshCw, Trash2, Upload, X,
} from 'lucide-react';
import { featureFileCrumbs, featureFileSize, parentFeatureDirectory } from '../../../model/feature-files.js';
import { SelectMenu } from '../../primitives/SelectMenu.jsx';

function modifiedLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function kindOrder(entry) {
  return entry.kind === 'directory' ? 0 : entry.kind === 'file' ? 1 : 2;
}

function sortEntries(entries, sort) {
  const direction = sort.direction === 'descending' ? -1 : 1;
  return [...entries].sort((left, right) => {
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

function Breadcrumbs({ directory, rootName, onNavigate }) {
  return <nav className="file-breadcrumbs" aria-label="文件路径">
    {featureFileCrumbs(directory, rootName).map((crumb, index, rows) => <React.Fragment key={crumb.directory || 'root'}>
      <button type="button" aria-current={index === rows.length - 1 ? 'page' : undefined} onClick={() => onNavigate?.(crumb.directory)}>{crumb.name}</button>
      {index < rows.length - 1 && <ChevronRight size={13} aria-hidden="true" />}
    </React.Fragment>)}
  </nav>;
}

const SORT_COLUMNS = [
  { key: 'name', label: '名称' },
  { key: 'modified', label: '修改日期' },
  { key: 'size', label: '大小' },
  { key: 'kind', label: '种类' },
];

function FileRows({ entries, selectedKey, disabled, attachDisabled, attachDisabledReason, busy, next, commands }) {
  const [sort, setSort] = useState({ key: 'name', direction: 'ascending' });
  const rows = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const changeSort = (key) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
  }));
  const activate = (entry) => {
    commands.select?.(entry);
    if (entry.kind === 'directory') commands.navigate?.(entry.directory || entry.path || `${entry.name}/`);
    else if (entry.kind === 'file') commands.preview?.(entry);
  };
  const remove = async (entry) => {
    if (!window.confirm(`确定删除“${entry.name}”吗？${entry.kind === 'directory' ? '文件夹必须为空。' : ''}`)) return;
    try { await commands.remove?.(entry); } catch { /* attachment owner publishes the visible error */ }
  };
  return <div className="channel-file-list" role="table" aria-label="当前目录内容" aria-busy={busy || undefined}>
    <div className="finder-list-header" role="row">
      {SORT_COLUMNS.map((column) => {
        const active = sort.key === column.key;
        return <span role="columnheader" aria-sort={active ? sort.direction : 'none'} key={column.key}>
          <button type="button" className={`finder-sort-button finder-sort-${column.key}`} onClick={() => changeSort(column.key)}>
            <span>{column.label}</span>
            {active && (sort.direction === 'ascending' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)}
          </button>
        </span>;
      })}
      <span aria-hidden="true" />
    </div>
    {rows.map((entry, index) => <div
      className={`channel-file-row ${index % 2 ? 'row-tinted' : 'row-light'}${selectedKey === entry.key ? ' is-selected' : ''}${entry.kind === 'directory' ? ' directory-row' : ''}`}
      role="row"
      tabIndex={0}
      aria-selected={selectedKey === entry.key}
      key={entry.key || entry.resourceId || entry.path || entry.name}
      onClick={() => activate(entry)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(entry); } }}
    >
      <span className="finder-name-cell" role="cell">
        <span className={`file-kind-icon${entry.kind === 'directory' ? ' folder-icon' : ''}`} aria-hidden="true">{entry.kind === 'directory' ? <Folder size={16} /> : <File size={14} />}</span>
        <strong>{entry.name}</strong>
      </span>
      <span className="finder-date-cell" role="cell">{modifiedLabel(entry.modifiedAt)}</span>
      <span className="finder-size-cell" role="cell">{entry.kind === 'file' ? featureFileSize(entry.size) : '—'}</span>
      <span className="finder-type-cell" role="cell">{entry.kind === 'directory' ? '文件夹' : entry.kind === 'file' ? '文件' : '不支持的节点'}</span>
      <span className="channel-file-actions" role="cell">
        {entry.kind === 'file' && <>
          <button type="button" aria-label="下载" title={`下载 ${entry.name}`} onClick={(event) => { event.stopPropagation(); void commands.download?.(entry); }}><Download size={15} /></button>
          <button type="button" aria-label="附加" title={attachDisabled ? attachDisabledReason : `附加 ${entry.name}`} disabled={attachDisabled} onClick={(event) => { event.stopPropagation(); void Promise.resolve(commands.attach?.(entry)).catch(() => {}); }}><Paperclip size={15} /></button>
        </>}
        <button type="button" className="danger" aria-label="删除" title={`删除 ${entry.name}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); void remove(entry); }}><Trash2 size={15} /></button>
      </span>
    </div>)}
    {busy && !entries.length && <div className="artifact-empty"><strong>正在读取目录…</strong></div>}
    {!busy && !entries.length && <div className="artifact-empty"><strong>当前目录为空</strong><p>可以新建文件夹或上传文件。</p></div>}
    {next && <button type="button" className="bounded-list-control" disabled={busy} onClick={() => commands.loadMore?.(next)}>{busy ? '正在载入…' : '载入更多'}</button>}
  </div>;
}

export function FilesFeature({ channel, port = {}, visible = true, onClose }) {
  const surfaceRef = useRef(null);
  const scrollRef = useRef(null);
  const [folderName, setFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const commands = port.commands || {};
  const entries = port.entries || [];
  const devices = port.devices || [];
  const disabled = port.disabled === true;
  useLayoutEffect(() => {
    if (scrollRef.current && Number.isFinite(Number(port.scrollTop))) scrollRef.current.scrollTop = Number(port.scrollTop);
    if (visible) surfaceRef.current?.querySelector('button[aria-label="关闭文件"]')?.focus();
  }, [port.directory, port.deviceId, visible]);
  const submitFolder = async (event) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    try {
      await commands.createDirectory?.({ name, directory: port.directory || '', deviceId: port.deviceId || '' });
      setFolderName('');
      setCreatingFolder(false);
    } catch { /* attachment owner publishes the visible error */ }
  };
  const chooseUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { await commands.upload?.({ files: [file], directory: port.directory || '', deviceId: port.deviceId || '' }); } catch { /* visible via owner */ }
  };
  return <section ref={surfaceRef} id="workspace-panel-files" className="workspace-view artifacts-view channel-files-view" hidden={!visible} role="region" aria-label="频道文件">
    <div className="finder-toolbar">
      <button type="button" className="finder-nav-button" aria-label="返回上一级" disabled={!port.directory} onClick={() => commands.navigate?.(parentFeatureDirectory(port.directory))}>‹</button>
      <Breadcrumbs directory={port.directory || ''} rootName={channel?.qualified_name || channel?.name || '文件'} onNavigate={commands.navigate} />
      <div className="finder-tools">
        {devices.length > 1 ? <SelectMenu ariaLabel="文件挂载设备" value={port.deviceId || ''} placeholder="没有可用设备" options={devices.map((row) => ({ value: row.id, label: row.name || row.id, description: row.id }))} onChange={commands.selectDevice} /> : devices[0] && <span className="finder-device" title={devices[0].id}>{devices[0].name || devices[0].id}</span>}
        <button type="button" className="finder-tool-button labeled" disabled={disabled || !port.deviceId || port.busy} onClick={() => setCreatingFolder(true)}><FolderPlus size={15} />新建文件夹</button>
        <button type="button" className="finder-tool-button" aria-label="刷新文件目录" disabled={!port.deviceId || port.busy} onClick={() => commands.refresh?.()}><RefreshCw size={15} /></button>
        <span className={`finder-upload finder-native-upload${disabled || !port.deviceId || port.uploading ? ' is-disabled' : ''}`}>
          <input aria-label="选择要上传到当前目录的文件" type="file" disabled={disabled || !port.deviceId || port.uploading} onChange={chooseUpload} />
          <span aria-hidden="true"><Upload size={14} />{port.uploading ? '上传中…' : '上传'}</span>
        </span>
        {onClose && <button type="button" className="finder-tool-button" aria-label="关闭文件" title="关闭文件" onClick={onClose}><X size={15} /></button>}
      </div>
    </div>
    {creatingFolder && <form className="new-folder-form" onSubmit={submitFolder}><label>新文件夹名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label><button type="submit" disabled={disabled || !folderName.trim() || port.busy}>创建</button><button type="button" onClick={() => { setFolderName(''); setCreatingFolder(false); }}>取消</button></form>}
    <div ref={scrollRef} className="workspace-view-scroll channel-files-scroll" onScroll={(event) => commands.rememberScroll?.(event.currentTarget.scrollTop)}>
      {port.error && <p className="governance-error" role="alert">{port.error}</p>}
      {(port.recent || []).length > 0 && <section className="recent-files" aria-label="最近查看的文件"><strong>最近查看</strong><div>{port.recent.slice(0, 8).map((entry) => <button type="button" title={entry.resourceId} key={`${entry.channelId || channel?.id}:${entry.resourceId}`} onClick={() => commands.preview?.(entry)}>{entry.name}</button>)}</div></section>}
      {!port.deviceId
        ? <div className="artifact-empty"><strong>这个频道还没有可用的文件挂载</strong><p>连接设备后，这里会显示频道的默认目录。</p></div>
        : <FileRows entries={entries} selectedKey={port.selectedKey} disabled={disabled} attachDisabled={port.attachDisabled === true || disabled} attachDisabledReason={port.attachDisabledReason || (disabled ? '当前频道不可写' : '编辑已有消息时不能附加频道文件')} busy={port.busy} next={port.next} commands={commands} />}
    </div>
  </section>;
}
