import React from 'react';
import { ArtifactPreviewPanel } from './files/ArtifactPreviewPanel.jsx';
import { FilesFeature } from './files/FilesFeature.jsx';
import { ChannelAdministrationPanel, SpaceAdministrationPanel } from './governance/GovernanceFeature.jsx';
import { ActorDetailPanel, RosterFeature } from './roster/RosterFeature.jsx';
import { SearchFeature } from './search/SearchFeature.jsx';
import { TaskDetailPanel } from './tasks/TaskDetailPanel.jsx';
import { TasksFeature } from './tasks/TasksFeature.jsx';
import { TerminalFeature } from './terminal/TerminalFeature.jsx';

export const WORKSPACE_FEATURE_PANEL = Object.freeze({
  roster: 'roster',
  actor: 'actor',
  artifact: 'artifact',
  task: 'task',
  channelAdministration: 'channel-administration',
  spaceAdministration: 'space-administration',
});

function InaccessibleFeature({ label }) {
  return <section className="workspace-view channel-private-empty" role="region" aria-label={label}><strong>{label}不可访问</strong><p>恢复频道访问后才能查看。</p></section>;
}

// Product surfaces consume only domain projections and command callbacks.
// The composition root remains the owner of session, feed, and reading state.
export function WorkspaceFeatures({
  activeView = 'conversation',
  channel,
  contentVisible = true,
  files = {},
  tasks = {},
  terminal = {},
}) {
  const filesActive = activeView === 'files';
  const tasksActive = activeView === 'tasks';
  return <>
    {filesActive && (contentVisible ? <FilesFeature channel={channel} port={files} visible onClose={files.commands?.close} /> : <InaccessibleFeature label="文件" />)}
    {tasksActive && (contentVisible ? <TasksFeature port={tasks} /> : <InaccessibleFeature label="任务" />)}
    {terminal.mounted !== false && terminal.visible && contentVisible && <TerminalFeature channelId={channel?.id || terminal.channelId || ''} port={terminal} visible={terminal.visible} onClose={terminal.commands?.close} />}
  </>;
}

export function WorkspaceRightPanel({ panel, channel, files = {}, tasks = {}, roster = {}, governance = {}, onClose }) {
  const kind = typeof panel === 'string' ? panel : panel?.kind || panel?.value || '';
  if (kind === WORKSPACE_FEATURE_PANEL.roster) return <RosterFeature port={roster} onClose={onClose} />;
  if (kind === WORKSPACE_FEATURE_PANEL.actor) return <ActorDetailPanel port={roster} onClose={onClose} />;
  if (kind === WORKSPACE_FEATURE_PANEL.artifact) return <ArtifactPreviewPanel port={files} onClose={onClose} />;
  if (kind === WORKSPACE_FEATURE_PANEL.task) return <TaskDetailPanel port={tasks} onClose={onClose} />;
  if (kind === WORKSPACE_FEATURE_PANEL.channelAdministration) return <ChannelAdministrationPanel channel={channel} port={governance.channel || governance} onClose={onClose} />;
  if (kind === WORKSPACE_FEATURE_PANEL.spaceAdministration) return <SpaceAdministrationPanel channel={channel} port={governance.space || governance} onClose={onClose} />;
  return null;
}

export function WorkspaceFeatureOverlays({ search = {} }) {
  return search.open ? <SearchFeature port={search} /> : null;
}

export function workspaceFeatureChannelListProps(commands = {}) {
  return Object.freeze({
    onSearch: () => commands.openSearch?.(),
    onSpaceManage: () => commands.openSpaceAdministration?.(),
  });
}
