import React, { useEffect, useMemo, useState } from 'react';
import { artifactKindForMediaType, previewForMediaType } from '../model/artifacts.js';
import { channelMountRoot, directoryEntries, fileListCommand, normalizeDirectory, parentDirectory } from '../model/channel-files.js';
import { fileTransferURL, mediaTypeFromFileName, uploadChannelFile } from '../model/channel-file-transfer.js';
import { LIST_WINDOW_SIZE } from '../model/list-window.js';
import { attachmentFromResource, readFileTicket } from '../model/resources.js';
import { SelectMenu } from './primitives/SelectMenu.jsx';

function crumbs(directory) {
  const parts = normalizeDirectory(directory).split('/').filter(Boolean);
  return [{ name: '根目录', directory: '' }, ...parts.map((name, index) => ({ name, directory: `${parts.slice(0, index + 1).join('/')}/` }))];
}

function formatSize(size) {
  if (!Number.isFinite(Number(size))) return '—';
  const value = Number(size);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function formatModified(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function fileKind(name, mediaType = '') {
  const type = mediaTypeFromFileName(name, mediaType);
  if (type === 'application/pdf') return ['PDF', 'PDF 文稿'];
  if (type === 'text/markdown') return ['MD', 'Markdown 文稿'];
  if (type === 'application/json') return ['JSON', 'JSON 文稿'];
  if (type === 'text/csv') return ['CSV', 'CSV 文稿'];
  if (type.startsWith('text/')) return ['TXT', '文稿'];
  if (type.startsWith('image/')) return ['IMG', `${type.split('/')[1].toUpperCase()} 图像`];
  if (type.startsWith('audio/')) return ['AUDIO', '音频'];
  if (type.startsWith('video/')) return ['VIDEO', '视频'];
  return ['FILE', '文件'];
}

export function ArtifactsView({ channel, daemons, disabled, onResource, onAttach, onPreview }) {
  const [daemonId, setDaemonId] = useState(daemons[0]?.id || '');
  const [directory, setDirectory] = useState('');
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [uploadedMeta, setUploadedMeta] = useState(new Map());
  const [filePage, setFilePage] = useState(0);
  const activeDaemon = daemons.find((row) => row.id === daemonId);
  const qualifiedChannel = channel.qualified_name || channel.id;
  const mountRoot = daemonId ? channelMountRoot({ daemonId, qualifiedChannel }) : '';
  const prefix = `${mountRoot}${normalizeDirectory(directory)}`;
  const entries = useMemo(() => directoryEntries(items, prefix), [items, prefix]);
  const visibleEntries = entries.slice(filePage * LIST_WINDOW_SIZE, (filePage + 1) * LIST_WINDOW_SIZE);

  useEffect(() => {
    if (!daemons.some((row) => row.id === daemonId)) setDaemonId(daemons[0]?.id || '');
  }, [daemonId, daemons]);

  useEffect(() => {
    setDirectory('');
    setItems([]);
    setFilePage(0);
  }, [channel.id, daemonId]);

  useEffect(() => { setFilePage(0); }, [directory]);

  useEffect(() => {
    if (!daemonId || disabled) return undefined;
    let alive = true;
    setStatus('loading');
    setError('');
    onResource(fileListCommand({ channelId: channel.id, daemonId, qualifiedChannel, directory }))
      .then((page) => {
        if (!alive) return;
        setItems(Array.isArray(page?.items) ? page.items : []);
        setStatus('ready');
      })
      .catch((failure) => {
        if (!alive) return;
        setStatus('error');
        setError(failure.message || String(failure));
      });
    return () => { alive = false; };
  }, [channel.id, daemonId, directory, disabled, onResource, qualifiedChannel, refreshVersion]);

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !daemonId) return;
    setError('');
    setStatus('uploading');
    try {
      const attachment = await uploadChannelFile({ file, channel, daemonId, directory, onResource });
      setUploadedMeta((current) => new Map(current).set(attachment.address, { name: file.name, type: attachment.media_type, size: file.size }));
      setStatus('ready');
      setRefreshVersion((value) => value + 1);
    } catch (failure) {
      setStatus('error');
      setError(failure.message || String(failure));
    }
  }

  async function download(resourceId, name) {
    setError('');
    try {
      const receipt = await onResource(readFileTicket({ channelId: channel.id, resourceId }));
      if (!receipt?.ticket) throw new TypeError('服务端没有返回下载凭据');
      const response = await fetch(fileTransferURL(receipt.address || resourceId, receipt.ticket), { credentials: 'include' });
      if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  function previewFile(entry) {
    const meta = uploadedMeta.get(entry.resourceId);
    const mediaType = mediaTypeFromFileName(entry.name, meta?.type || entry.mediaType);
    onPreview?.({
      key: `mounted-file:${channel.id}:${entry.resourceId}`,
      channelId: channel.id,
      resourceId: entry.resourceId,
      name: meta?.name || entry.name,
      mediaType,
      size: meta?.size ?? entry.size,
      kind: artifactKindForMediaType(mediaType),
      preview: previewForMediaType(mediaType),
      state: 'available',
      mountPath: entry.resourceId,
      provenance: { source: 'channel_mount' },
    });
  }

  function attachFile(entry) {
    const meta = uploadedMeta.get(entry.resourceId);
    onAttach(attachmentFromResource({
      resourceId: entry.resourceId,
      address: entry.resourceId,
      file: { name: meta?.name || entry.name, type: mediaTypeFromFileName(entry.name, meta?.type || entry.mediaType), size: meta?.size ?? entry.size ?? 0 },
    }));
  }

  return <section id="workspace-panel-artifacts" className="workspace-view artifacts-view channel-files-view" role="tabpanel" aria-labelledby="workspace-tab-artifacts" aria-label="频道文件">
    <div className="finder-toolbar">
      <button type="button" className="finder-nav-button" aria-label="返回上一级" disabled={!directory} onClick={() => setDirectory(parentDirectory(directory))}>‹</button>
      <nav className="file-breadcrumbs" aria-label="文件路径">
        {crumbs(directory).map((crumb, index, rows) => <React.Fragment key={crumb.directory || 'root'}><button type="button" aria-current={index === rows.length - 1 ? 'page' : undefined} onClick={() => setDirectory(crumb.directory)}>{index === 0 ? qualifiedChannel : crumb.name}</button>{index < rows.length - 1 && <span aria-hidden="true">›</span>}</React.Fragment>)}
      </nav>
      <div className="finder-tools">
        {daemons.length > 1
          ? <SelectMenu ariaLabel="文件挂载设备" value={daemonId} placeholder="没有可用设备" options={daemons.map((row) => ({ value: row.id, label: row.name || row.id, description: row.id }))} onChange={setDaemonId} />
          : activeDaemon && <span className="finder-device" title={activeDaemon.id}>{activeDaemon.name || activeDaemon.id}</span>}
        <button type="button" className="finder-tool-button" aria-label="刷新文件目录" disabled={disabled || !daemonId || status === 'loading'} onClick={() => setRefreshVersion((value) => value + 1)}>↻</button>
        <span className={`finder-upload finder-native-upload${disabled || !daemonId || status === 'uploading' ? ' is-disabled' : ''}`}>
          <input aria-label="选择要上传到当前目录的文件" type="file" disabled={disabled || !daemonId || status === 'uploading'} onChange={chooseFile} />
          <span aria-hidden="true">{status === 'uploading' ? '上传中…' : '＋ 上传'}</span>
        </span>
      </div>
    </div>

    <div className="workspace-view-scroll channel-files-scroll">
      {error && <p className="governance-error" role="alert">{error}</p>}
      {!daemonId && <div className="artifact-empty"><strong>这个频道还没有可用的文件挂载</strong><p>连接设备后，这里会显示频道的默认目录。</p></div>}
      {daemonId && <div className="channel-file-list" role="table" aria-label="当前目录内容" aria-busy={status === 'loading'}>
        <div className="finder-list-header" role="row"><span role="columnheader">名称</span><span role="columnheader">修改日期</span><span role="columnheader">大小</span><span role="columnheader">种类</span><span aria-hidden="true" /></div>
        {filePage > 0 && <button type="button" className="bounded-list-control" onClick={() => setFilePage((value) => Math.max(0, value - 1))}>上一页文件</button>}
        {visibleEntries.map((entry, index) => {
          const rowClass = `channel-file-row ${index % 2 === 1 ? 'row-tinted' : 'row-light'}`;
          if (entry.kind === 'directory') return <button type="button" className={`${rowClass} directory-row`} role="row" key={entry.key} onClick={() => setDirectory(`${normalizeDirectory(directory)}${entry.directory}`)}><span className="finder-name-cell" role="cell"><span className="file-kind-icon folder-icon" aria-hidden="true" /><strong>{entry.name}</strong></span><span className="finder-date-cell" role="cell">{formatModified(entry.modifiedAt)}</span><span className="finder-size-cell" role="cell">—</span><span className="finder-type-cell" role="cell">文件夹</span><span className="finder-row-disclosure" aria-hidden="true">›</span></button>;
          const meta = uploadedMeta.get(entry.resourceId);
          const mediaType = mediaTypeFromFileName(entry.name, meta?.type || entry.mediaType);
          const [icon, typeLabel] = fileKind(entry.name, mediaType);
          return <div className={rowClass} role="row" key={entry.key}><button type="button" className="channel-file-open finder-name-cell" role="cell" onClick={() => previewFile(entry)}><span className={`file-kind-icon type-${artifactKindForMediaType(mediaType)}`} aria-hidden="true">{icon}</span><strong>{entry.name}</strong></button><span className="finder-date-cell" role="cell">{formatModified(entry.modifiedAt)}</span><span className="finder-size-cell" role="cell">{formatSize(meta?.size ?? entry.size)}</span><span className="finder-type-cell" role="cell">{typeLabel}</span><div className="channel-file-actions" role="cell"><button type="button" onClick={() => previewFile(entry)}>预览</button><button type="button" onClick={() => attachFile(entry)}>附加</button><button type="button" onClick={() => download(entry.resourceId, entry.name)}>下载</button></div></div>;
        })}
        {status === 'loading' && <div className="artifact-empty"><strong>正在读取目录…</strong></div>}
        {(filePage + 1) * LIST_WINDOW_SIZE < entries.length && <button type="button" className="bounded-list-control" onClick={() => setFilePage((value) => value + 1)}>下一页文件</button>}
        {status === 'ready' && !entries.length && <div className="artifact-empty"><strong>当前目录为空</strong><p>可以上传文件，或返回其他目录。</p></div>}
      </div>}
    </div>
  </section>;
}
