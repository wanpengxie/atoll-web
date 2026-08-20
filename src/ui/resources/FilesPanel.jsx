import React, { useEffect, useState } from 'react';
import { attachmentFromResource, createFileTicket, fileAddress, readFileTicket } from '../../model/resources.js';
import { PanelCard } from '../primitives/PanelCard.jsx';
import { SelectMenu } from '../primitives/SelectMenu.jsx';

function fileURL(ticket) {
  return `/files?t=${encodeURIComponent(ticket)}`;
}

export function FilesPanel({ channel, daemons, disabled, onResource, onAttach }) {
  const [error, setError] = useState('');
  const [daemonId, setDaemonId] = useState(daemons[0]?.id || '');
  const [file, setFile] = useState(null);
  const [path, setPath] = useState('uploads/demo.txt');
  const [files, setFiles] = useState([]);
  const [uploadState, setUploadState] = useState('idle');

  useEffect(() => {
    if (!daemonId && daemons[0]?.id) setDaemonId(daemons[0].id);
  }, [daemonId, daemons]);

  async function upload() {
    if (!file) { setError('请选择文件'); return; }
    setError('');
    setUploadState('ticket');
    try {
      const daemonName = daemons.find((row) => row.id === daemonId)?.name;
      const address = fileAddress({ daemonName, qualifiedChannel: channel.qualified_name || channel.id, path });
      const ticket = await onResource(createFileTicket({ channelId: channel.id, address }));
      if (!ticket?.ticket) throw new TypeError('服务端没有返回上传 ticket');
      setUploadState('uploading');
      const response = await fetch(fileURL(ticket.ticket), { method: 'PUT', credentials: 'include', body: file });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new TypeError(body.detail || `上传失败 (${response.status})`); }
      setUploadState('confirming');
      const id = ticket.resource_id || ticket.id || address;
      const readable = await onResource(readFileTicket({ channelId: channel.id, resourceId: id }));
      if (!readable?.ticket) throw new TypeError('PUT 已完成，但资源尚未返回可读 ticket；不会重复上传字节');
      const row = { resourceId: id, address, file: { name: file.name, type: file.type, size: file.size }, state: 'available' };
      setFiles((current) => [row, ...current.filter((item) => item.resourceId !== id)]);
      setUploadState('completed');
    } catch (failure) {
      setUploadState('error');
      setError(failure.message || String(failure));
    }
  }

  async function download(row) {
    setError('');
    try {
      const ticket = await onResource(readFileTicket({ channelId: channel.id, resourceId: row.resourceId }));
      if (!ticket?.ticket) throw new TypeError('服务端没有返回下载 ticket');
      const response = await fetch(fileURL(ticket.ticket), { credentials: 'include' });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new TypeError(body.detail || `下载失败 (${response.status})`); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = row.file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      setError(failure.message || String(failure));
    }
  }

  return <>
    {error && <p className="governance-error" role="alert">{error}</p>}
    <PanelCard className="governance-form" title="上传文件">
      <p>控制面先创建 ticket，文件字节再通过 HTTP PUT 发送。</p>
      <label>目标设备<SelectMenu ariaLabel="文件目标设备" value={daemonId} placeholder="选择在线设备" options={daemons.map((row) => ({ value: row.id, label: `${row.name} · ${row.id}` }))} onChange={setDaemonId} /></label>
      <label>文件路径<input aria-label="文件资源路径" value={path} onChange={(event) => setPath(event.target.value)} /></label>
      <label className="file-picker">本地文件<input aria-label="选择上传文件" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /><span>{file ? `${file.name} · ${file.size} bytes` : '尚未选择'}</span></label>
      <button type="button" className="primary-button" disabled={disabled || !daemonId || !file || ['ticket', 'uploading', 'confirming'].includes(uploadState)} onClick={upload}>上传</button>
      {uploadState !== 'idle' && <p className={`upload-state state-${uploadState}`}>{({ ticket: '正在创建票据', uploading: '正在上传字节', confirming: 'PUT 已完成，确认资源可读', completed: '上传完成', error: '上传失败，可重新获取票据' })[uploadState]}</p>}
    </PanelCard>
    <PanelCard title="本次会话文件">
      {files.map((row) => <div className="file-row" key={row.resourceId}><div><strong>{row.file.name}</strong><small>{row.file.type || 'application/octet-stream'} · {row.file.size} bytes</small><code>{row.resourceId}</code></div><div><button type="button" onClick={() => download(row)}>下载</button><button type="button" className="primary-button" onClick={() => onAttach(attachmentFromResource(row))}>附加到消息</button></div></div>)}
      {!files.length && <p className="governance-empty">本次会话还没有上传文件。</p>}
    </PanelCard>
  </>;
}
