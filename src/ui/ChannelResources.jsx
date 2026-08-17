import React, { useEffect, useState } from 'react';
import { attachmentFromResource, createFileTicket, fileAddress, kvResource, readFileTicket } from '../model/resources.js';
import { parseJSONObject } from '../model/space-administration.js';

function fileURL(address, ticket) {
  return `/files/${encodeURIComponent(address)}?t=${encodeURIComponent(ticket)}`;
}

export function ChannelResources({ channel, daemons, disabled, onResource, onAttach, onClose }) {
  const [tab, setTab] = useState('kv');
  const [resourceId, setResourceId] = useState('kv:demo');
  const [args, setArgs] = useState('{"value":"hello"}');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [daemonId, setDaemonId] = useState(daemons[0]?.id || '');
  const [file, setFile] = useState(null);
  const [path, setPath] = useState('uploads/demo.txt');
  const [files, setFiles] = useState([]);
  const [uploadState, setUploadState] = useState('idle');

  useEffect(() => {
    if (!daemonId && daemons[0]?.id) setDaemonId(daemons[0].id);
  }, [daemonId, daemons]);

  async function runKV(op) {
    setError('');
    try {
      const value = await onResource(kvResource({ channelId: channel.id, op, id: resourceId, ...(op === 'create' || op === 'write' ? { args: parseJSONObject(args, 'KV args') } : {}) }));
      setResult(value);
    } catch (failure) { setError(failure.message || String(failure)); }
  }

  async function upload() {
    if (!file) { setError('请选择文件'); return; }
    setError('');
    setUploadState('ticket');
    try {
      const address = fileAddress({ daemonId, qualifiedChannel: channel.qualified_name || channel.id, path });
      const ticket = await onResource(createFileTicket({ channelId: channel.id, address }));
      if (!ticket?.ticket) throw new TypeError('服务端没有返回上传 ticket');
      setUploadState('uploading');
      const response = await fetch(fileURL(address, ticket.ticket), { method: 'PUT', credentials: 'include', body: file });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new TypeError(body.detail || `上传失败 (${response.status})`); }
      setUploadState('confirming');
      const id = ticket.resource_id || ticket.id || address;
      const readable = await onResource(readFileTicket({ channelId: channel.id, resourceId: id }));
      if (!readable?.ticket) throw new TypeError('PUT 已完成，但资源尚未返回可读 ticket；不会重复上传字节');
      const row = { resourceId: id, address, file: { name: file.name, type: file.type, size: file.size }, state: 'available' };
      setFiles((current) => [row, ...current.filter((item) => item.resourceId !== id)]);
      setUploadState('completed');
      setResult({ status: 'ok', resource_id: id, address });
    } catch (failure) { setUploadState('error'); setError(failure.message || String(failure)); }
  }

  async function download(row) {
    setError('');
    try {
      const ticket = await onResource(readFileTicket({ channelId: channel.id, resourceId: row.resourceId }));
      if (!ticket?.ticket) throw new TypeError('服务端没有返回下载 ticket');
      const response = await fetch(fileURL(ticket.address || row.address, ticket.ticket), { credentials: 'include' });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new TypeError(body.detail || `下载失败 (${response.status})`); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = row.file.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) { setError(failure.message || String(failure)); }
  }

  return <aside className="governance-panel resource-panel" aria-label="频道资源">
    <header><div><p className="eyebrow">CHANNEL DATA</p><h2>资源与文件</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭频道资源">×</button></header>
    <nav aria-label="资源区域"><button type="button" className={tab === 'kv' ? 'active' : ''} onClick={() => setTab('kv')}>KV</button><button type="button" className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>文件与附件</button></nav>
    <div className="governance-scroll">
      {error && <p className="governance-error" role="alert">{error}</p>}
      {tab === 'kv' && <>
        <section className="governance-card governance-form"><h3>KV 资源</h3><label>资源 ID<input aria-label="KV 资源 ID" value={resourceId} onChange={(e) => setResourceId(e.target.value)} /></label><label>Args JSON<textarea aria-label="KV Args JSON" rows="6" value={args} onChange={(e) => setArgs(e.target.value)} /></label><div className="resource-actions">{['create', 'read', 'write', 'stat', 'list', 'delete'].map((op) => <button type="button" key={op} className={op === 'delete' ? 'danger-text' : op === 'create' ? 'primary-button' : ''} disabled={disabled} onClick={() => runKV(op)}>{({ create: '创建', read: '读取', write: '写入', stat: '状态', list: '列出', delete: '删除' })[op]}</button>)}</div></section>
        {result && <section className="governance-card resource-result"><h3>最近结果</h3><pre>{JSON.stringify(result, null, 2)}</pre></section>}
      </>}
      {tab === 'files' && <>
        <section className="governance-card governance-form"><h3>上传文件</h3><p>控制面先创建 ticket，文件字节再通过 HTTP PUT 发送。</p><label>目标设备<select aria-label="文件目标设备" value={daemonId} onChange={(e) => setDaemonId(e.target.value)}><option value="">选择在线设备</option>{daemons.map((row) => <option value={row.id} key={row.id}>{row.name} · {row.id}</option>)}</select></label><label>文件路径<input aria-label="文件资源路径" value={path} onChange={(e) => setPath(e.target.value)} /></label><label className="file-picker">本地文件<input aria-label="选择上传文件" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /><span>{file ? `${file.name} · ${file.size} bytes` : '尚未选择'}</span></label><button type="button" className="primary-button" disabled={disabled || !daemonId || !file || ['ticket', 'uploading', 'confirming'].includes(uploadState)} onClick={upload}>上传</button>{uploadState !== 'idle' && <p className={`upload-state state-${uploadState}`}>{({ ticket: '正在创建票据', uploading: '正在上传字节', confirming: 'PUT 已完成，确认资源可读', completed: '上传完成', error: '上传失败，可重新获取票据' })[uploadState]}</p>}</section>
        <section className="governance-card"><h3>本次会话文件</h3>{files.map((row) => <div className="file-row" key={row.resourceId}><div><strong>{row.file.name}</strong><small>{row.file.type || 'application/octet-stream'} · {row.file.size} bytes</small><code>{row.resourceId}</code></div><div><button type="button" onClick={() => download(row)}>下载</button><button type="button" className="primary-button" onClick={() => onAttach(attachmentFromResource(row))}>附加到消息</button></div></div>)}{!files.length && <p className="governance-empty">本次会话还没有上传文件。</p>}</section>
      </>}
    </div>
  </aside>;
}
