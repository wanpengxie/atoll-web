import React, { useEffect, useRef, useState } from 'react';
import { Download, FolderPlus, Paperclip, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { artifactKindForMediaType, previewForMediaType } from '../model/artifacts.js';
import { fileTransferURL, mediaTypeFromFileName, uploadChannelFile } from '../model/channel-file-transfer.js';
import { attachmentFromResource, readFileTicket } from '../model/resources.js';
import { FileBreadcrumbs, FileBrowserRows } from './files/ChannelFileBrowser.jsx';
import { useChannelFileBrowser } from './files/useChannelFileBrowser.js';
import { SelectMenu } from './primitives/SelectMenu.jsx';

export function ArtifactsView({ channel, devices = [], disabled, attachDisabled = disabled, attachDisabledReason = '', onResource, onFileOperation, onAttach, onPreview, recentFiles = [], visible = true, initialLocation = null, onLocationChange, onClose, autoFocusOnOpen = false }) {
  const surfaceRef = useRef(null);
  const browser = useChannelFileBrowser({ channel, devices, disabled, onResource, onFileOperation, initialLocation, onLocationChange });
  const [uploadedMeta, setUploadedMeta] = useState(new Map());
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const runOperation = (options, effect) => (onFileOperation
    ? onFileOperation({ channelId: channel.id, ...options }, effect)
    : effect({
      signal: undefined,
      authorize: () => true,
      resource: onResource,
      fetch: (input, init) => fetch(input, init),
    }));

  useEffect(() => {
    if (!visible || !autoFocusOnOpen) return undefined;
    const frame = requestAnimationFrame(() => surfaceRef.current?.querySelector('button[aria-label="关闭文件"]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible, autoFocusOnOpen]);

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !browser.daemonId) return;
    const uploadLocation = browser.locationKey;
    browser.setError(''); setUploading(true);
    try {
      const attachment = await runOperation({ access: 'write' }, (operation) => uploadChannelFile({
        file,
        channel,
        deviceName: browser.activeDaemon?.name,
        directory: browser.directory,
        onResource: operation.resource,
        signal: operation.signal,
        authorize: (phase) => operation.authorize(phase === 'settle' ? 'submit' : phase, { requireTransport: phase !== 'settle' }),
      }));
      setUploadedMeta((current) => new Map(current).set(attachment.address, { name: file.name, type: attachment.media_type, size: file.size }));
      await browser.refreshLocation(uploadLocation);
    } catch (failure) {
      if (browser.isCurrentLocation(uploadLocation)) browser.setError(failure?.message || String(failure));
    } finally {
      setUploading(false);
    }
  }

  async function download(entry) {
    const actionLocation = browser.locationKey;
    browser.setError('');
    try {
      const blob = await runOperation({ access: 'read' }, async (operation) => {
        const receipt = await operation.resource(readFileTicket({ channelId: channel.id, resourceId: entry.resourceId }));
        if (!receipt?.ticket) throw new TypeError('服务端没有返回下载凭据');
        const response = await operation.fetch(fileTransferURL(channel.id, receipt.ticket), { credentials: 'include' });
        if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
        return response.blob();
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = entry.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      if (browser.isCurrentLocation(actionLocation)) browser.setError(failure?.message || String(failure));
    }
  }

  function previewFile(entry) {
    const meta = uploadedMeta.get(entry.resourceId);
    const mediaType = mediaTypeFromFileName(entry.name, meta?.type || entry.mediaType);
    onPreview?.({
      key: `mounted-file:${channel.id}:${entry.resourceId}`, channelId: channel.id,
      resourceId: entry.resourceId, name: meta?.name || entry.name, mediaType,
      size: meta?.size ?? entry.size, kind: artifactKindForMediaType(mediaType),
      preview: previewForMediaType(mediaType), state: 'available', mountPath: entry.resourceId,
      provenance: { source: 'channel_mount' },
    });
  }

  async function attachFile(entry) {
    const meta = uploadedMeta.get(entry.resourceId);
    try {
      await onAttach(attachmentFromResource({
        resourceId: entry.resourceId, address: entry.resourceId,
        file: { name: meta?.name || entry.name, type: mediaTypeFromFileName(entry.name, meta?.type || entry.mediaType), size: meta?.size ?? entry.size ?? 0 },
      }), channel.id);
    } catch (failure) {
      browser.setError(failure?.message || String(failure));
    }
  }

  async function submitFolder(event) {
    event.preventDefault();
    try {
      await browser.createDirectory(folderName);
      setFolderName(''); setCreatingFolder(false);
    } catch { /* the browser owns the visible error */ }
  }

  async function remove(entry) {
    if (!window.confirm(`确定删除“${entry.name}”吗？${entry.kind === 'directory' ? '文件夹必须为空。' : ''}`)) return;
    try { await browser.deleteEntry(entry); } catch { /* visible in browser */ }
  }

  function actions(entry) {
    return <div className="channel-file-actions" role="cell">
      {entry.kind === 'file' && <>
        <button type="button" aria-label="下载" title={`下载 ${entry.name}`} onClick={(event) => { event.stopPropagation(); void download(entry); }}><Download size={15} /></button>
        <button type="button" aria-label="附加" disabled={attachDisabled} title={attachDisabled ? attachDisabledReason : `附加 ${entry.name}`} onClick={(event) => { event.stopPropagation(); void attachFile(entry); }}><Paperclip size={15} /></button>
      </>}
      <button type="button" className="danger" aria-label="删除" disabled={disabled} title={`删除 ${entry.name}`} onClick={(event) => { event.stopPropagation(); void remove(entry); }}><Trash2 size={15} /></button>
    </div>;
  }

  // 收起分屏恒只是 hidden，恒不卸载：目录、滚动位置、选中项都在这棵树里，卸一次
  // 人就得从根目录重新点回来。role 从 tabpanel 改成 region——它已经不是一个 tab
  // 的内容了，是与动态并排的一块。
  //
  // 名字只用 aria-label：aria-labelledby 与 aria-label 同在时无障碍名恒取前者，
  // 指向开关按钮就会让这一整块叫"文件"，与按钮同名。
  return <section ref={surfaceRef} id="workspace-panel-artifacts" className="workspace-view artifacts-view channel-files-view" hidden={!visible} role="region" aria-label="频道文件">
    <div className="finder-toolbar">
      <button type="button" className="finder-nav-button" aria-label="返回上一级" disabled={!browser.directory} onClick={browser.parent}>‹</button>
      <FileBreadcrumbs browser={browser} />
      <div className="finder-tools">
        {devices.length > 1
          ? <SelectMenu ariaLabel="文件挂载设备" value={browser.daemonId} placeholder="没有可用设备" options={devices.map((row) => ({ value: row.id, label: row.name || row.id, description: row.id }))} onChange={browser.setDaemonId} />
          : browser.activeDaemon && <span className="finder-device" title={browser.activeDaemon.id}>{browser.activeDaemon.name || browser.activeDaemon.id}</span>}
        <button type="button" className="finder-tool-button labeled" disabled={disabled || !browser.daemonId || browser.busy} onClick={() => setCreatingFolder(true)}><FolderPlus size={15} />新建文件夹</button>
        <button type="button" className="finder-tool-button" aria-label="刷新文件目录" disabled={!browser.daemonId || browser.busy} onClick={browser.refresh}><RefreshCw size={15} /></button>
        <span className={`finder-upload finder-native-upload${disabled || !browser.daemonId || uploading ? ' is-disabled' : ''}`}>
          <input aria-label="选择要上传到当前目录的文件" type="file" disabled={disabled || !browser.daemonId || uploading} onChange={chooseFile} />
          <span aria-hidden="true"><Upload size={14} />{uploading ? '上传中…' : '上传'}</span>
        </span>
        {onClose && <button type="button" className="finder-tool-button" aria-label="关闭文件" title="关闭文件" onClick={onClose}><X size={15} /></button>}
      </div>
    </div>
    {creatingFolder && <form className="new-folder-form" onSubmit={submitFolder}>
      <label>新文件夹名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>
      <button type="submit" disabled={disabled || !folderName.trim() || browser.busy}>创建</button>
      <button type="button" onClick={() => { setCreatingFolder(false); setFolderName(''); }}>取消</button>
    </form>}
    <div className="workspace-view-scroll channel-files-scroll">
      {browser.error && <p className="governance-error" role="alert">{browser.error}</p>}
      {recentFiles.length > 0 && <section className="recent-files" aria-label="最近查看的文件">
        <strong>最近查看</strong>
        <div>{recentFiles.slice(0, 8).map((file) => <button type="button" title={file.resourceId} key={`${file.channelId}:${file.resourceId}`} onClick={() => onPreview?.(file)}>{file.name}</button>)}</div>
      </section>}
      {!browser.daemonId
        ? <div className="artifact-empty"><strong>这个频道还没有可用的文件挂载</strong><p>连接设备后，这里会显示频道的默认目录。</p></div>
        : <FileBrowserRows browser={browser} onActivateFile={previewFile} renderActions={actions} />}
    </div>
  </section>;
}
