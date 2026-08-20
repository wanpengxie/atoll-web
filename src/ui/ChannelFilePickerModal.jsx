import React, { useEffect, useMemo, useRef, useState } from 'react';
import { channelMountRoot, directoryEntries, fileListCommand, normalizeDirectory, parentDirectory } from '../model/channel-files.js';
import { mediaTypeFromFileName } from '../model/channel-file-transfer.js';
import { LIST_WINDOW_SIZE } from '../model/list-window.js';
import { attachmentFromResource } from '../model/resources.js';
import { SelectMenu } from './primitives/SelectMenu.jsx';
import { useModalFocus } from './primitives/useModalFocus.js';

function crumbs(directory) {
  const parts = normalizeDirectory(directory).split('/').filter(Boolean);
  return [{ name: '根目录', directory: '' }, ...parts.map((name, index) => ({ name, directory: `${parts.slice(0, index + 1).join('/')}/` }))];
}

function formatSize(size) {
  if (!Number.isFinite(Number(size))) return '—';
  const value = Number(size);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

export function ChannelFilePickerModal({ channel, daemons = [], disabled = false, onResource, onChoose, onClose }) {
  const [daemonId, setDaemonId] = useState(daemons[0]?.id || '');
  const [directory, setDirectory] = useState('');
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const qualifiedChannel = channel?.qualified_name || channel?.id || '';
  // 设备在菜单里按 id 选（稳定的键），但地址按名字拼——服务端按名字解析。
  const daemonName = daemons.find((row) => row.id === daemonId)?.name || '';
  const prefix = daemonName && qualifiedChannel ? `${channelMountRoot({ daemonName, qualifiedChannel })}${normalizeDirectory(directory)}` : '';
  const entries = useMemo(() => directoryEntries(items, prefix).slice(0, LIST_WINDOW_SIZE), [items, prefix]);
  useModalFocus({ dialogRef, initialFocusRef: closeRef, onClose });

  useEffect(() => {
    if (!daemons.some((row) => row.id === daemonId)) setDaemonId(daemons[0]?.id || '');
  }, [daemonId, daemons]);

  useEffect(() => { setDirectory(''); }, [daemonId]);

  useEffect(() => {
    if (!channel?.id || !daemonName || disabled) { setItems([]); setStatus('ready'); return undefined; }
    let alive = true;
    setStatus('loading');
    setError('');
    onResource(fileListCommand({ channelId: channel.id, daemonName, qualifiedChannel, directory }))
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
  }, [channel?.id, daemonName, directory, disabled, onResource, qualifiedChannel]);

  function choose(entry) {
    const mediaType = mediaTypeFromFileName(entry.name, entry.mediaType);
    onChoose(attachmentFromResource({
      resourceId: entry.resourceId,
      address: entry.resourceId,
      file: { name: entry.name, type: mediaType, size: entry.size || 0 },
    }));
    onClose();
  }

  return <div className="modal-backdrop attachment-picker-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="attachment-picker-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-picker-title" aria-describedby="attachment-picker-description">
      <header>
        <div><h2 id="attachment-picker-title">从频道文件选择</h2><p id="attachment-picker-description">选择当前频道挂载目录中 agent 可以读取的文件。</p></div>
        <button ref={closeRef} type="button" aria-label="关闭频道文件选择" onClick={onClose}>×</button>
      </header>
      <div className="attachment-picker-toolbar">
        <button type="button" className="picker-back" aria-label="返回上一级目录" disabled={!directory} onClick={() => setDirectory(parentDirectory(directory))}>‹</button>
        <nav className="file-breadcrumbs" aria-label="选择文件路径">{crumbs(directory).map((crumb, index, rows) => <React.Fragment key={crumb.directory || 'root'}><button type="button" aria-current={index === rows.length - 1 ? 'page' : undefined} onClick={() => setDirectory(crumb.directory)}>{index === 0 ? qualifiedChannel : crumb.name}</button>{index < rows.length - 1 && <span aria-hidden="true">›</span>}</React.Fragment>)}</nav>
        {daemons.length > 1
          ? <SelectMenu ariaLabel="选择文件设备" value={daemonId} placeholder="没有可用设备" options={daemons.map((row) => ({ value: row.id, label: row.name || row.id, description: row.id }))} onChange={setDaemonId} />
          : daemons[0] && <span className="picker-daemon">{daemons[0].name || daemons[0].id}</span>}
      </div>
      <div className="attachment-picker-list" aria-busy={status === 'loading'}>
        {error && <p className="governance-error" role="alert">{error}</p>}
        {!daemonId && <div className="attachment-picker-empty"><strong>当前频道没有可用的 daemon 挂载</strong></div>}
        {status === 'loading' && <div className="attachment-picker-empty"><strong>正在读取频道目录…</strong></div>}
        {status === 'ready' && daemonId && !entries.length && <div className="attachment-picker-empty"><strong>当前目录为空</strong></div>}
        {entries.map((entry) => entry.kind === 'directory'
          ? <button type="button" className="attachment-picker-row directory" key={entry.key} onClick={() => setDirectory(`${normalizeDirectory(directory)}${entry.directory}`)}><span className="file-kind-icon folder-icon" aria-hidden="true" /><strong>{entry.name}</strong><small>文件夹</small><span aria-hidden="true">›</span></button>
          : <button type="button" className="attachment-picker-row file" key={entry.key} onClick={() => choose(entry)}><span className="file-kind-icon" aria-hidden="true">FILE</span><strong>{entry.name}</strong><small>{formatSize(entry.size)}</small><span>选择</span></button>)}
        {status === 'ready' && directoryEntries(items, prefix).length > LIST_WINDOW_SIZE && <p className="bounded-list-note">当前只显示前 {LIST_WINDOW_SIZE} 项，请进入更具体的目录后选择。</p>}
      </div>
      <footer><button type="button" onClick={onClose}>取消</button></footer>
    </section>
  </div>;
}
