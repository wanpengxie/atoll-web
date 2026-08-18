import React, { useState } from 'react';
import { ChannelDangerPanel } from './channel/ChannelDangerPanel.jsx';
import { ChannelMembersPanel } from './channel/ChannelMembersPanel.jsx';
import { ChannelOverviewPanel } from './channel/ChannelOverviewPanel.jsx';
import { SidePanel } from './primitives/SidePanel.jsx';

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'members', label: '成员' },
  { id: 'danger', label: '危险操作' },
];

export function ChannelGovernance({ channel, channels, roster, state, principals, declarations, disabled, onSubmit, onRefresh, onClose, mode = 'manage' }) {
  const [section, setSection] = useState('overview');
  if (mode === 'create') return <SidePanel ariaLabel="新建频道" eyebrow="CHANNEL CREATION" title="新建频道" onClose={onClose}>
    <ChannelOverviewPanel mode="create" channel={channel} channels={channels} roster={roster} state={state} disabled={disabled} onSubmit={onSubmit} />
  </SidePanel>;
  return <SidePanel ariaLabel={`频道管理 ${channel?.qualified_name || channel?.id}`} eyebrow="CHANNEL CONTROL" title="频道管理" tabs={TABS} activeTab={section} onTabChange={setSection} onClose={onClose}>
    <div hidden={section !== 'overview'}><ChannelOverviewPanel mode="manage" channel={channel} channels={channels} roster={roster} state={state} disabled={disabled} onSubmit={onSubmit} /></div>
    <div hidden={section !== 'members'}><ChannelMembersPanel channel={channel} roster={roster} state={state} principals={principals} declarations={declarations} disabled={disabled} onSubmit={onSubmit} onRefresh={onRefresh} /></div>
    <div hidden={section !== 'danger'}><ChannelDangerPanel channel={channel} roster={roster} disabled={disabled} onSubmit={onSubmit} /></div>
  </SidePanel>;
}
