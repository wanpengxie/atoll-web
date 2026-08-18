import React, { useMemo, useState } from 'react';
import { ActorTemplatesPanel } from './space/ActorTemplatesPanel.jsx';
import { ChannelConfigurationPanel } from './space/ChannelConfigurationPanel.jsx';
import { ChannelTemplatesPanel } from './space/ChannelTemplatesPanel.jsx';
import { DevicesPanel } from './space/DevicesPanel.jsx';
import { SidePanel } from './primitives/SidePanel.jsx';

const TABS = [
  { id: 'actors', label: 'Actor 模板' },
  { id: 'channels', label: '频道模板' },
  { id: 'config', label: '频道配置' },
  { id: 'devices', label: '设备' },
];

export function SpaceAdministration({ channel, roster, registrarRoster, state, rootState, version = 0, daemons, disabled, onSubmit, onRefresh, onClose }) {
  const [tab, setTab] = useState('actors');
  const states = useMemo(() => [state, rootState], [state, rootState]);
  return <SidePanel className="space-administration" ariaLabel="空间管理" eyebrow="SPACE CONTROL" title="空间管理" tabs={TABS} activeTab={tab} onTabChange={setTab} onClose={onClose}>
    <div hidden={tab !== 'actors'}><ActorTemplatesPanel states={states} registrarRoster={registrarRoster} disabled={disabled} onSubmit={onSubmit} /></div>
    <div hidden={tab !== 'channels'}><ChannelTemplatesPanel states={states} registrarRoster={registrarRoster} disabled={disabled} onSubmit={onSubmit} /></div>
    <div hidden={tab !== 'config'}><ChannelConfigurationPanel channel={channel} roster={roster} states={states} disabled={disabled} onSubmit={onSubmit} /></div>
    <div hidden={tab !== 'devices'}><DevicesPanel channel={channel} states={states} version={version} daemons={daemons} registrarRoster={registrarRoster} disabled={disabled} onSubmit={onSubmit} onRefresh={onRefresh} /></div>
  </SidePanel>;
}
