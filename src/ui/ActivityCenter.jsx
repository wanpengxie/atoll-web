import React, { useState } from 'react';
import { SidePanel } from './primitives/SidePanel.jsx';

const TABS = [
  { id: 'activity', label: '活动' },
  { id: 'operations', label: '操作' },
];

function ActivityRows({ rows, empty, onOpen }) {
  return <div className="activity-list">
    {rows.map((item) => <button type="button" className={`activity-row state-${item.state || 'info'}`} key={item.key} onClick={() => onOpen(item.source)}>
      <span className="activity-kind">{item.kindLabel || item.kind || '动态'}</span>
      <span className="activity-copy"><strong>{item.title}</strong><small>{item.channelName || item.channelId}{item.detail ? ` · ${item.detail}` : ''}</small></span>
      <span className="activity-open">返回来源 ›</span>
    </button>)}
    {!rows.length && <div className="activity-empty"><strong>{empty}</strong><p>这里只展示当前账户可见频道中的真实事实。</p></div>}
  </div>;
}

export function ActivityCenter({ activities = [], operations = [], onOpen, onClose }) {
  const [tab, setTab] = useState('activity');
  return <SidePanel className="activity-center" ariaLabel="全局活动" eyebrow="GLOBAL" title="活动中心" tabs={TABS} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    {tab === 'activity'
      ? <ActivityRows rows={activities} empty="没有需要关注的活动" onOpen={onOpen} />
      : <ActivityRows rows={operations} empty="没有进行中的操作" onOpen={onOpen} />}
  </SidePanel>;
}
