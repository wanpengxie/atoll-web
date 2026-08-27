import React, { useState } from 'react';
import { Download, Eye, FolderOpen, FolderPlus, Paperclip, RefreshCw, Trash2, Upload } from 'lucide-react';
import { artifactKindForMediaType, previewForMediaType } from '../model/artifacts.js';
import { fileTransferURL, mediaTypeFromFileName, uploadChannelFile } from '../model/channel-file-transfer.js';
import { attachmentFromResource, readFileTicket } from '../model/resources.js';
import { FileBreadcrumbs, FileBrowserRows } from './files/ChannelFileBrowser.jsx';
import { useChannelFileBrowser } from './files/useChannelFileBrowser.js';
import { SelectMenu } from './primitives/SelectMenu.jsx';

export function ArtifactsView({ channel, daemons, disabled, onResource, onAttach, onPreview }) {
  const browser = useChannelFileBrowser({ channel, daemons, disabled, onResource });
  const [uploadedMeta, setUploadedMeta] = useState(new Map());
  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !browser.daemonName) return;
    const uploadLocation = browser.locationKey;
    browser.setError(''); setUploading(true);
    try {
      const attachment = await uploadChannelFile({ file, channel, daemonName: browser.daemonName, directory: browser.directory, onResource });
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
      const receipt = await onResource(readFileTicket({ channelId: channel.id, resourceId: entry.resourceId }));
      if (!receipt?.ticket) throw new TypeError('服务端没有返回下载凭据');
      const response = await fetch(fileTransferURL(channel.id, receipt.ticket), { credentials: 'include' });
      if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
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

  function attachFile(entry) {
    const meta = uploadedMeta.get(entry.resourceId);
    onAttach(attachmentFromResource({
      resourceId: entry.resourceId, address: entry.resourceId,
      file: { name: meta?.name || entry.name, type: mediaTypeFromFileName(entry.name, meta?.type || entry.mediaType), size: meta?.size ?? entry.size ?? 0 },
    }));
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
      {entry.kind === 'directory'
        ? <button type="button" title={`打开 ${entry.name}`} onClick={(event) => { event.stopPropagation(); browser.openDirectory(entry); }}><FolderOpen size={14} />打开</button>
        : entry.kind === 'file' ? <>
          <button type="button" title={`预览 ${entry.name}`} onClick={(event) => { event.stopPropagation(); previewFile(entry); }}><Eye size={14} />预览</button>
          <button type="button" title={`附加 ${entry.name}`} onClick={(event) => { event.stopPropagation(); attachFile(entry); }}><Paperclip size={14} />附加</button>
          <button type="button" title={`下载 ${entry.name}`} onClick={(event) => { event.stopPropagation(); void download(entry); }}><Download size={14} />下载</button>
        </> : null}
      <button type="button" className="danger" title={`删除 ${entry.name}`} onClick={(event) => { event.stopPropagation(); void remove(entry); }}><Trash2 size={14} />删除</button>
    </div>;
  }

  return <section id="workspace-panel-artifacts" className="workspace-view artifacts-view channel-files-view" role="tabpanel" aria-labelledby="workspace-tab-artifacts" aria-label="频道文件">
    <div className="finder-toolbar">
      <button type="button" className="finder-nav-button" aria-label="返回上一级" disabled={!browser.directory} onClick={browser.parent}>‹</button>
      <FileBreadcrumbs browser={browser} />
      <div className="finder-tools">
        {daemons.length > 1
          ? <SelectMenu ariaLabel="文件挂载设备" value={browser.daemonId} placeholder="没有可用设备" options={daemons.map((row) => ({ value: row.id, label: row.name || row.id, description: row.id }))} onChange={browser.setDaemonId} />
          : browser.activeDaemon && <span className="finder-device" title={browser.activeDaemon.id}>{browser.activeDaemon.name || browser.activeDaemon.id}</span>}
        <button type="button" className="finder-tool-button labeled" disabled={disabled || !browser.daemonId || browser.busy} onClick={() => setCreatingFolder(true)}><FolderPlus size={15} />新建文件夹</button>
        <button type="button" className="finder-tool-button" aria-label="刷新文件目录" disabled={disabled || !browser.daemonId || browser.busy} onClick={browser.refresh}><RefreshCw size={15} /></button>
        <span className={`finder-upload finder-native-upload${disabled || !browser.daemonId || uploading ? ' is-disabled' : ''}`}>
          <input aria-label="选择要上传到当前目录的文件" type="file" disabled={disabled || !browser.daemonId || uploading} onChange={chooseFile} />
          <span aria-hidden="true"><Upload size={14} />{uploading ? '上传中…' : '上传'}</span>
        </span>
      </div>
    </div>
    {creatingFolder && <form className="new-folder-form" onSubmit={submitFolder}>
      <label>新文件夹名称<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>
      <button type="submit" disabled={!folderName.trim() || browser.busy}>创建</button>
      <button type="button" onClick={() => { setCreatingFolder(false); setFolderName(''); }}>取消</button>
    </form>}
    <div className="workspace-view-scroll channel-files-scroll">
      {browser.error && <p className="governance-error" role="alert">{browser.error}</p>}
      {!browser.daemonId
        ? <div className="artifact-empty"><strong>这个频道还没有可用的文件挂载</strong><p>连接设备后，这里会显示频道的默认目录。</p></div>
        : <FileBrowserRows browser={browser} onActivateFile={previewFile} renderActions={actions} />}
    </div>
  </section>;
}
