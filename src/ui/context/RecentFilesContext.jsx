import React from 'react';
import { Clock3, FileText } from 'lucide-react';
import { SidePanel } from '../primitives/SidePanel.jsx';

function openedLabel(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function RecentFilesContext({ files = [], onOpen, onClose }) {
  return <SidePanel className="recent-files-context" ariaLabel="最近阅读" title="最近阅读" closeLabel="关闭最近阅读" onClose={onClose}>
    {files.length === 0
      ? <div className="recent-files-empty"><Clock3 size={24} /><strong>还没有阅读记录</strong><p>从消息或文件区打开的文件会出现在这里。</p></div>
      : <div className="recent-files-list">{files.map((file) => <button type="button" key={`${file.channelId}:${file.resourceId}`} title={file.resourceId} onClick={() => onOpen?.(file)}>
        <FileText size={16} aria-hidden="true" />
        <span><strong>{file.name}</strong><small>{openedLabel(file.lastOpenedAt)}{file.line ? ` · 第 ${file.line} 行` : ''}</small></span>
      </button>)}</div>}
  </SidePanel>;
}
