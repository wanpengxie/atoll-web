import React, { useLayoutEffect, useRef } from 'react';
import { canWriteChannel, isMemberAccess } from '../model/channel-access.js';
import { createChannelState } from '../model/fold.js';
import { ChannelGovernance } from '../ui/ChannelGovernance.jsx';
import { Roster } from '../ui/Roster.jsx';
import { SpaceAdministration } from '../ui/SpaceAdministration.jsx';
import { ArtifactContext } from '../ui/context/ArtifactContext.jsx';
import { WorkItemContext } from '../ui/context/WorkItemContext.jsx';
import { ChannelAutomation } from '../ui/ChannelAutomation.jsx';
import { ActivityCenter } from '../ui/ActivityCenter.jsx';
import { ChannelResources } from '../ui/ChannelResources.jsx';

function ContextHost({ type, focusKey, onClose, children }) {
  const hostRef = useRef(null);
  const openerRef = useRef(null);
  useLayoutEffect(() => {
    openerRef.current = document.activeElement;
    hostRef.current?.querySelector('.context-pane button[aria-label^="关闭"]')?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected && !opener.disabled) opener.focus();
    };
  }, []);
  return <div ref={hostRef} className="context-host" data-context-type={type || 'transitional'} data-context-key={focusKey || ''}>
    <button type="button" className="context-backdrop" aria-label="关闭上下文" tabIndex={-1} onClick={onClose} />
    <div className="context-pane">{children}</div>
  </div>;
}

export function RightPanelHost({ panel, active, directory, governance, roster, artifacts, workItems, activity }) {
  const close = panel.close;
  let content = null;
  if (panel.value === 'governance' && active.channel) {
    content = <ChannelGovernance channel={active.channel} channels={directory.channels} roster={active.roster} state={active.state} principals={governance.principals} declarations={governance.declarations} selfId={active.selfId} identityPending={isMemberAccess(active.access) && !active.selfId} disabled={!canWriteChannel(active.access)} onSubmit={governance.onSubmit} onRefresh={governance.onRefresh} onSelectActor={roster.onSelectActor} onClose={close} />;
  }
  else if (panel.value === 'space' && active.channel) {
    content = <SpaceAdministration channel={active.channel} channels={directory.channels} roster={active.roster} registrarRoster={governance.registrarRoster} state={active.state} rootState={governance.rootState || createChannelState('c0')} version={governance.version} daemons={governance.daemons} disabled={active.wireState !== 'open'} onSubmit={governance.onSubmit} onRefresh={governance.onRefresh} onClose={close} />;
  }
  else if (panel.value === 'roster-focus' && active.channel) {
    content = <Roster rows={active.roster} selfId={active.selfId} identityPending={isMemberAccess(active.access) && !active.selfId} busy={roster.busy} focused onClosePanel={close} onRefresh={roster.onRefresh} selectedActor={roster.selectedActor} capability={roster.capability} disabled={!canWriteChannel(active.access)} onSelectActor={roster.onSelectActor} onCloseActor={roster.onCloseActor} onDescribe={roster.onDescribe} onInvoke={roster.onInvoke} />;
  }
  else if (panel.value === 'artifact-focus' && artifacts.selected) {
    content = <ArtifactContext artifact={artifacts.selected} authorName={artifacts.authorName} onResource={artifacts.onResource} onDownload={artifacts.onDownload} onAttach={artifacts.onAttach} onSource={artifacts.onSource} onClose={close} />;
  }
  else if (panel.value === 'work-item-focus' && workItems.selected) {
    content = <WorkItemContext item={workItems.selected} roster={workItems.roster} onSource={workItems.onSource} onResolve={workItems.onResolve} onOpenTurn={workItems.onOpenTurn} onRetry={workItems.onRetry} onCancelAutomation={workItems.onCancelAutomation} onClose={close} />;
  }
  else if (panel.value === 'automation' && active.channel) {
    content = <ChannelAutomation channel={active.channel} records={active.automation.records} disabled={active.automation.disabled} onAfter={active.automation.onAfter} onCancel={active.automation.onCancel} onClose={close} />;
  }
  else if (panel.value === 'resources' && active.channel) {
    content = <ChannelResources channel={active.channel} daemons={governance.daemons} disabled={!canWriteChannel(active.access)} onResource={artifacts.onResource} onAttach={artifacts.onAttach} onClose={close} />;
  }
  else if (panel.value === 'activity') {
    content = <ActivityCenter activities={activity.activities} operations={activity.operations} onOpen={activity.onOpen} onClose={close} />;
  }
  if (!content) return null;
  const contextType = panel.value === 'artifact-focus' ? 'artifact' : panel.focus?.type;
  return <ContextHost type={contextType} focusKey={panel.focus?.key} onClose={close}>{content}</ContextHost>;
}
