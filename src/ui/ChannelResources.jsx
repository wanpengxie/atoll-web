import React, { useState } from 'react';
import { FilesPanel } from './resources/FilesPanel.jsx';
import { KeyValuePanel } from './resources/KeyValuePanel.jsx';
import { PanelTabs } from './primitives/PanelTabs.jsx';
import { SidePanel } from './primitives/SidePanel.jsx';

const TABS = [{ id: 'files', label: '文件' }, { id: 'kv', label: 'KV' }];

export function ChannelResources({ channel, devices = [], disabled, onResource, onAttach, onClose, surface = 'context' }) {
  const [tab, setTab] = useState('files');
  const content = <>
    <div hidden={tab !== 'kv'}><KeyValuePanel channel={channel} disabled={disabled} onResource={onResource} /></div>
    <div hidden={tab !== 'files'}><FilesPanel channel={channel} devices={devices} disabled={disabled} onResource={onResource} onAttach={onAttach} /></div>
  </>;
  if (surface === 'workspace') {
    return <section className="workspace-view workspace-resource-view" aria-label="频道资源">
      <header className="workspace-view-header"><div><p className="eyebrow">CHANNEL FILES</p><h2>文件</h2></div><p>浏览频道挂载目录，或把文件附加到动态草稿。</p></header>
      <PanelTabs label="文件区域" tabs={TABS} activeTab={tab} onChange={setTab} />
      <div className="workspace-view-scroll">{content}</div>
    </section>;
  }
  if (surface === 'embedded') return <div className="embedded-resources"><PanelTabs label="高级资源区域" tabs={TABS} activeTab={tab} onChange={setTab} />{content}</div>;
  return <SidePanel className="resource-panel" ariaLabel="频道资源" eyebrow="CHANNEL DATA" title="资源与文件" closeLabel="关闭频道资源" tabs={TABS} activeTab={tab} onTabChange={setTab} onClose={onClose}>{content}</SidePanel>;
}
