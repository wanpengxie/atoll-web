import React from 'react';
import { SidePanel } from '../../primitives/SidePanel.jsx';

export function TaskDetailPanel({ port = {}, onClose }) {
  const item = port.selectedItem;
  if (!item) return null;
  return <SidePanel ariaLabel="任务详情" eyebrow="WORK ITEM" title={item.title || '任务详情'} onClose={onClose}>
    <div className={`work-item-context-state state-${item.state || 'active'}`}><span>{item.kind || 'task'}</span><strong>{item.state || 'active'}</strong></div>
    <dl className="work-item-metadata"><dt>负责人</dt><dd>{item.ownerName || item.ownerId || (item.assigneeActorIds || []).join('、') || '未指定'}</dd><dt>来源频道</dt><dd>{item.channelName || item.channelId || '当前频道'}</dd><dt>创建时间</dt><dd>{item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '未知'}</dd></dl>
    {item.description && <section className="work-item-detail"><h3>说明</h3><p>{item.description}</p></section>}
    {item.waitingFor && <section className="work-item-detail"><h3>正在等待</h3><p>{item.waitingFor}</p></section>}
    <section className="work-item-detail"><h3>操作</h3><div className="work-item-actions">{(item.actions || []).map((action) => <button type="button" className={action === 'reject' || action === 'cancel' ? 'danger' : action === 'approve' ? 'approve' : ''} key={action} onClick={() => port.commands?.control?.({ action, itemId: item.id || item.key, item })}>{action}</button>)}</div></section>
  </SidePanel>;
}
