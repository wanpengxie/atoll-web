import React, { useEffect, useMemo, useRef, useState } from 'react';
import { artifactKindForMediaType, artifactList, previewForMediaType } from '../model/artifacts.js';
import { channelMountRoot, directoryEntries, fileListCommand, normalizeDirectory, parentDirectory } from '../model/channel-files.js';
import { LIST_WINDOW_SIZE } from '../model/list-window.js';
import { attachmentFromResource, createFileTicket, fileAddress, readFileTicket } from '../model/resources.js';
import { ChannelResources } from './ChannelResources.jsx';
import { SelectMenu } from './primitives/SelectMenu.jsx';

function fileURL(address, ticket) {
  return `/files/${encodeURIComponent(address)}?t=${encodeURIComponent(ticket)}`;
}

function safePath(name) {
  return String(name || 'upload').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+/, '') || 'upload';
}

function crumbs(directory) {
  const parts = normalizeDirectory(directory).split('/').filter(Boolean);
  return [{ name: '根目录', directory: '' }, ...parts.map((name, index) => ({ name, directory: `${parts.slice(0, index + 1).join('/')}/` }))];
}

function mediaTypeFromName(name, declared = '') {
  if (declared) return declared;
  const extension = String(name).split('.').pop()?.toLowerCase();
  return ({ md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', mp4: 'video/mp4' })[extension] || 'application/octet-stream';
}

export function ArtifactsView({ channel, state, roster, daemons, disabled, onResource, onAttach, onOpen, onPreview }) {
  const [daemonId, setDaemonId] = useState(daemons[0]?.id || '');
  const [directory, setDirectory] = useState('');
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [uploadedMeta, setUploadedMeta] = useState(new Map());
  const [filePage, setFilePage] = useState(0);
  const [referencePage, setReferencePage] = useState(0);
  const inputRef = useRef(null);
  const artifacts = useMemo(() => artifactList(state), [state, state?.lastSeq]);
  const artifactByResource = useMemo(() => new Map(artifacts.flatMap((artifact) => [
    [artifact.resourceId, artifact],
    ...(artifact.diagnostic?.address ? [[artifact.diagnostic.address, artifact]] : []),
  ])), [artifacts]);
  const activeDaemon = daemons.find((row) => row.id === daemonId);
  const qualifiedChannel = channel.qualified_name || channel.id;
  const mountRoot = daemonId ? channelMountRoot({ daemonId, qualifiedChannel }) : '';
  const prefix = `${mountRoot}${normalizeDirectory(directory)}`;
  const entries = useMemo(() => directoryEntries(items, prefix), [items, prefix]);
  const visibleEntries = entries.slice(filePage * LIST_WINDOW_SIZE, (filePage + 1) * LIST_WINDOW_SIZE);
  const visibleArtifacts = artifacts.slice(referencePage * LIST_WINDOW_SIZE, (referencePage + 1) * LIST_WINDOW_SIZE);

  useEffect(() => {
    if (!daemons.some((row) => row.id === daemonId)) setDaemonId(daemons[0]?.id || '');
  }, [daemonId, daemons]);

  useEffect(() => {
    setDirectory('');
    setItems([]);
    setFilePage(0);
    setReferencePage(0);
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
      const path = `${normalizeDirectory(directory)}${safePath(file.name)}`;
      const address = fileAddress({ daemonId, qualifiedChannel, path });
      const ticket = await onResource(createFileTicket({ channelId: channel.id, address }));
      if (!ticket?.ticket) throw new TypeError('服务端没有返回上传凭据');
      const response = await fetch(fileURL(address, ticket.ticket), { method: 'PUT', credentials: 'include', body: file });
      if (!response.ok) throw new TypeError(`上传失败 (${response.status})`);
      setUploadedMeta((current) => new Map(current).set(address, { name: file.name, type: file.type || 'application/octet-stream', size: file.size }));
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
      const response = await fetch(fileURL(receipt.address || resourceId, receipt.ticket), { credentials: 'include' });
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
    const mediaType = mediaTypeFromName(entry.name, meta?.type || entry.mediaType);
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

  return <section id="workspace-panel-artifacts" className="workspace-view artifacts-view channel-files-view" role="tabpanel" aria-labelledby="workspace-tab-artifacts" aria-label="频道文件">
    <header className="workspace-view-header artifacts-header channel-files-header">
      <div><p className="eyebrow">CHANNEL FILES</p><h2>文件</h2><p>当前频道在设备上的默认挂载目录</p></div>
      <input ref={inputRef} className="visually-hidden" aria-label="选择要上传到当前目录的文件" type="file" onChange={chooseFile} />
      <button type="button" className="primary-button artifact-upload" disabled={disabled || !daemonId || status === 'uploading'} onClick={() => inputRef.current?.click()}>{status === 'uploading' ? '上传中…' : '上传到此目录'}</button>
    </header>

    <div className="file-mount-toolbar">
      <label><span>挂载设备</span><SelectMenu ariaLabel="文件挂载设备" value={daemonId} placeholder="没有可用设备" options={daemons.map((row) => ({ value: row.id, label: row.name || row.id, description: row.id }))} onChange={setDaemonId} /></label>
      <div className="mount-location"><span>频道目录</span><code>{mountRoot || `尚未给 ${qualifiedChannel} 提供文件设备`}</code></div>
      <button type="button" aria-label="刷新文件目录" disabled={disabled || !daemonId || status === 'loading'} onClick={() => setRefreshVersion((value) => value + 1)}>刷新</button>
    </div>

    <nav className="file-breadcrumbs" aria-label="文件路径">
      {crumbs(directory).map((crumb, index, rows) => <React.Fragment key={crumb.directory || 'root'}><button type="button" aria-current={index === rows.length - 1 ? 'page' : undefined} onClick={() => setDirectory(crumb.directory)}>{crumb.name}</button>{index < rows.length - 1 && <span aria-hidden="true">/</span>}</React.Fragment>)}
    </nav>

    <div className="workspace-view-scroll channel-files-scroll">
      {error && <p className="governance-error" role="alert">{error}</p>}
      {!daemonId && <div className="artifact-empty"><strong>这个频道还没有可用的文件挂载</strong><p>先在空间管理中连接设备；每个设备会为频道提供独立的默认目录。</p></div>}
      {daemonId && <div className="channel-file-list" aria-label="当前目录内容" aria-busy={status === 'loading'}>
        {directory && <button type="button" className="channel-file-row directory-row" onClick={() => setDirectory(parentDirectory(directory))}><span className="file-kind-icon">↰</span><span><strong>上一级</strong><small>返回父目录</small></span></button>}
        {filePage > 0 && <button type="button" className="bounded-list-control" onClick={() => setFilePage((value) => Math.max(0, value - 1))}>上一页文件</button>}
        {visibleEntries.map((entry) => entry.kind === 'directory'
          ? <button type="button" className="channel-file-row directory-row" key={entry.key} onClick={() => setDirectory(`${normalizeDirectory(directory)}${entry.directory}`)}><span className="file-kind-icon">▰</span><span><strong>{entry.name}</strong><small>文件夹</small></span><span>打开</span></button>
          : <div className="channel-file-row" key={entry.key}><span className="file-kind-icon">◇</span><button type="button" className="channel-file-open" onClick={() => previewFile(entry)}><strong>{entry.name}</strong><small>{artifactByResource.has(entry.resourceId) ? '已在频道动态中引用' : '频道文件'} · 点击预览</small></button><div className="channel-file-actions"><button type="button" onClick={() => previewFile(entry)}>预览</button><button type="button" onClick={() => { const meta = uploadedMeta.get(entry.resourceId); onAttach(attachmentFromResource({ resourceId: entry.resourceId, address: entry.resourceId, file: { name: meta?.name || entry.name, type: mediaTypeFromName(entry.name, meta?.type || entry.mediaType), size: meta?.size ?? entry.size ?? 0 } })); }}>附加到消息</button>{artifactByResource.has(entry.resourceId) && <button type="button" onClick={() => onOpen(artifactByResource.get(entry.resourceId))}>查看引用</button>}<button type="button" onClick={() => download(entry.resourceId, entry.name)}>下载</button></div></div>)}
        {status === 'loading' && <div className="artifact-empty"><strong>正在读取挂载目录…</strong></div>}
        {(filePage + 1) * LIST_WINDOW_SIZE < entries.length && <button type="button" className="bounded-list-control" onClick={() => setFilePage((value) => value + 1)}>下一页文件</button>}
        {status === 'ready' && !entries.length && <div className="artifact-empty"><strong>当前目录为空</strong><p>上传文件，或返回其他目录继续浏览。</p></div>}
      </div>}

      {artifacts.length > 0 && <section className="referenced-artifacts" aria-label="消息引用的文件"><header><div><p className="eyebrow">LEDGER REFERENCES</p><h3>消息引用</h3></div><span>{artifacts.length}</span></header><p>这些文件或结果在频道动态中有可追溯来源。</p><div className="artifact-list">{referencePage > 0 && <button type="button" className="bounded-list-control" onClick={() => setReferencePage((value) => Math.max(0, value - 1))}>上一页引用</button>}{visibleArtifacts.map((artifact) => <button type="button" className="artifact-row" key={artifact.key} onClick={() => onOpen(artifact)}><span className={`artifact-preview kind-${artifact.kind}`}>{artifact.kind === 'image' ? 'IMG' : artifact.kind === 'document' ? 'DOC' : 'FILE'}</span><span className="artifact-row-body"><strong>{artifact.name}</strong><small>动态 #{artifact.source.seq} · {roster.find((row) => row.id === artifact.authorActorId)?.name || '未知作者'}</small></span><span className="artifact-state">查看来源</span></button>)}{(referencePage + 1) * LIST_WINDOW_SIZE < artifacts.length && <button type="button" className="bounded-list-control" onClick={() => setReferencePage((value) => value + 1)}>下一页引用</button>}</div></section>}
      <details className="advanced-resources"><summary>高级资源工具</summary><p>KV 与手工路径操作保留给调试和管理场景，不是频道文件的默认入口。</p><ChannelResources surface="embedded" channel={channel} daemons={daemons} disabled={disabled} onResource={onResource} onAttach={onAttach} /></details>
    </div>
  </section>;
}
