import React from 'react';
import { canWriteChannel, isMemberAccess } from '../model/channel-access.js';
import { createChannelState } from '../model/fold.js';
import { ChannelAutomation } from '../ui/ChannelAutomation.jsx';
import { ChannelGovernance } from '../ui/ChannelGovernance.jsx';
import { ChannelResources } from '../ui/ChannelResources.jsx';
import { Roster } from '../ui/Roster.jsx';
import { SpaceAdministration } from '../ui/SpaceAdministration.jsx';

export function RightPanelHost({ panel, active, directory, governance, resources, automation, roster }) {
  const close = () => panel.set('roster');
  if (panel.value === 'create-channel' && active.channel) {
    return <ChannelGovernance mode="create" channel={active.channel} channels={directory.channels} roster={active.roster} state={active.state} disabled={!canWriteChannel(active.access)} onSubmit={governance.onSubmit} onClose={close} />;
  }
  if (panel.value === 'governance' && active.channel) {
    return <ChannelGovernance channel={active.channel} channels={directory.channels} roster={active.roster} state={active.state} principals={governance.principals} declarations={governance.declarations} disabled={!canWriteChannel(active.access)} onSubmit={governance.onSubmit} onRefresh={governance.onRefresh} onClose={close} />;
  }
  if (panel.value === 'space' && active.channel) {
    return <SpaceAdministration channel={active.channel} channels={directory.channels} roster={active.roster} registrarRoster={governance.registrarRoster} state={active.state} rootState={governance.rootState || createChannelState('c0')} version={governance.version} daemons={governance.daemons} disabled={active.wireState !== 'open'} onSubmit={governance.onSubmit} onRefresh={governance.onRefresh} onClose={close} />;
  }
  if (panel.value === 'resources' && active.channel) {
    return <ChannelResources channel={active.channel} daemons={governance.daemons} disabled={active.wireState !== 'open' || !canWriteChannel(active.access)} onResource={resources.onResource} onAttach={resources.onAttach} onClose={close} />;
  }
  if (panel.value === 'automation' && active.channel) {
    return <ChannelAutomation channel={active.channel} records={automation.records} disabled={active.wireState !== 'open' || !canWriteChannel(active.access)} onAfter={automation.onAfter} onCancel={automation.onCancel} onClose={close} />;
  }
  return <Roster rows={active.roster} selfId={active.selfId} identityPending={isMemberAccess(active.access) && !active.selfId} busy={roster.busy} onRefresh={roster.onRefresh} selectedActor={roster.selectedActor} capability={roster.capability} disabled={!canWriteChannel(active.access)} onSelectActor={roster.onSelectActor} onCloseActor={roster.onCloseActor} onDescribe={roster.onDescribe} onInvoke={roster.onInvoke} />;
}
