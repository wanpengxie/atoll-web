import React, { useRef } from 'react';
import { attachmentFromResource } from '../model/resources.js';
import { mediaTypeFromFileName } from '../model/channel-file-transfer.js';
import { FileBreadcrumbs, FileBrowserRows } from './files/ChannelFileBrowser.jsx';
import { useChannelFileBrowser } from './files/useChannelFileBrowser.js';
import { SelectMenu } from './primitives/SelectMenu.jsx';
import { useModalFocus } from './primitives/useModalFocus.js';

export function ChannelFilePickerModal({ channel, daemons = [], disabled = false, onResource, onChoose, onClose }) {
  const browser = useChannelFileBrowser({ channel, daemons, disabled, onResource });
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useModalFocus({ dialogRef, initialFocusRef: closeRef, onClose });

  function choose(entry) {
    const mediaType = mediaTypeFromFileName(entry.name, entry.mediaType);
    onChoose(attachmentFromResource({
      resourceId: entry.resourceId, address: entry.resourceId,
      file: { name: entry.name, type: mediaType, size: entry.size || 0 },
    }));
    onClose();
  }

  return <div className="modal-backdrop attachment-picker-backdrop" data-modal-layer role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="attachment-picker-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-picker-title" aria-describedby="attachment-picker-description">
      <header>
        <div><h2 id="attachment-picker-title">从频道文件选择</h2><p id="attachment-picker-description">进入文件夹，选择当前频道中 agent 可以读取的文件。</p></div>
        <button ref={closeRef} type="button" aria-label="关闭频道文件选择" onClick={onClose}>×</button>
      </header>
      <div className="attachment-picker-toolbar">
        <button type="button" className="picker-back" aria-label="返回上一级目录" disabled={!browser.directory} onClick={browser.parent}>‹</button>
        <FileBreadcrumbs browser={browser} />
        {daemons.length > 1
          ? <SelectMenu ariaLabel="选择文件设备" value={browser.daemonId} placeholder="没有可用设备" options={daemons.map((row) => ({ value: row.id, label: row.name || row.id, description: row.id }))} onChange={browser.setDaemonId} />
          : browser.activeDaemon && <span className="picker-daemon">{browser.activeDaemon.name || browser.activeDaemon.id}</span>}
      </div>
      <div className="attachment-picker-list">
        {browser.error && <p className="governance-error" role="alert">{browser.error}</p>}
        {!browser.daemonId
          ? <div className="attachment-picker-empty"><strong>当前频道没有可用的 daemon 挂载</strong></div>
          : <FileBrowserRows browser={browser} mode="pick" onActivateFile={choose} />}
      </div>
      <footer><span>{browser.entries.length ? `${browser.entries.length} 项` : ''}</span><button type="button" onClick={onClose}>取消</button></footer>
    </section>
  </div>;
}
