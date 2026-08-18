import React, { useState } from 'react';
import { FilesPanel } from './resources/FilesPanel.jsx';
import { KeyValuePanel } from './resources/KeyValuePanel.jsx';
import { SidePanel } from './primitives/SidePanel.jsx';

const TABS = [{ id: 'kv', label: 'KV' }, { id: 'files', label: '文件与附件' }];

export function ChannelResources({ channel, daemons, disabled, onResource, onAttach, onClose }) {
  const [tab, setTab] = useState('kv');
  return <SidePanel className="resource-panel" ariaLabel="频道资源" eyebrow="CHANNEL DATA" title="资源与文件" closeLabel="关闭频道资源" tabs={TABS} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    <div hidden={tab !== 'kv'}><KeyValuePanel channel={channel} disabled={disabled} onResource={onResource} /></div>
    <div hidden={tab !== 'files'}><FilesPanel channel={channel} daemons={daemons} disabled={disabled} onResource={onResource} onAttach={onAttach} /></div>
  </SidePanel>;
}
