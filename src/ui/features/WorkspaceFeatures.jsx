import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { attachmentFromFileReference } from '../../model/file-references.js';
import { MarkdownFileReferenceProvider } from '../MarkdownContent.jsx';
import { ArtifactPreviewPanel } from './files/ArtifactPreviewPanel.jsx';
import { FilesFeature } from './files/FilesFeature.jsx';
import { ChannelAdministrationPanel, ChannelAutomationPanel, ChannelCreateModal, SpaceAdministrationPanel } from './governance/GovernanceFeature.jsx';
import { ActorDetailPanel, RosterFeature } from './roster/RosterFeature.jsx';
import { SearchFeature } from './search/SearchFeature.jsx';
import { TaskDetailPanel } from './tasks/TaskDetailPanel.jsx';
import { TasksFeature } from './tasks/TasksFeature.jsx';
import { TerminalFeature } from './terminal/TerminalFeature.jsx';
import { SidePanel } from '../primitives/SidePanel.jsx';

export const WORKSPACE_FEATURE_PANEL = Object.freeze({
  roster: 'roster',
  actor: 'actor',
  artifact: 'artifact',
  task: 'task',
  automation: 'automation',
  channelAdministration: 'channel-administration',
  spaceAdministration: 'space-administration',
  activity: 'activity',
});

const ACTIVITY_TABS = Object.freeze([
  { id: 'activity', label: '活动' },
  { id: 'operations', label: '操作' },
]);

function InaccessibleFeature({ label }) {
  return <section className="workspace-view channel-private-empty" role="region" aria-label={label}><strong>{label}不可访问</strong><p>恢复频道访问后才能查看。</p></section>;
}

// The picker is a presentation of the existing Files owner. It never keeps a
// directory/device/resource store of its own: navigation, refresh and the
// resource rows all come from the typed Files port, while the Workspace owner
// resolves the one-shot selection back to Composer.
function ChannelFilePickerModal({ channel, files = {}, onChoose, onClose }) {
  const closeRef = useRef(null);
  const openerRef = useRef(null);
  const commands = files.commands || {};
  const entries = files.entries || [];
  useLayoutEffect(() => {
    const active = document.activeElement;
    openerRef.current = active && active !== document.body && active.isConnected ? active : null;
    closeRef.current?.focus({ preventScroll: true });
    return () => openerRef.current?.isConnected && openerRef.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose?.();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  useEffect(() => {
    if (!channel?.id || !files.deviceId || typeof commands.refresh !== 'function') return;
    void Promise.resolve(commands.refresh()).catch(() => {});
    // The Files owner changes its directory/device state; the picker only
    // asks for the initial authoritative page when its channel/device changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, files.deviceId]);
  return <div
    className="modal-backdrop attachment-picker-backdrop"
    data-modal-layer
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
  >
    <section className="attachment-picker-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-picker-title" aria-describedby="attachment-picker-description">
      <header>
        <div><h2 id="attachment-picker-title">从频道文件选择</h2><p id="attachment-picker-description">选择当前频道挂载目录中 Agent 可以读取的文件。</p></div>
        <button ref={closeRef} type="button" aria-label="关闭频道文件选择" onClick={onClose}>×</button>
      </header>
      <div className="attachment-picker-toolbar">
        <button type="button" className="picker-back" aria-label="返回上一级目录" disabled={!files.directory} onClick={() => commands.navigate?.(String(files.directory || '').replace(/[^/]+\/$/, ''))}>‹</button>
        <nav className="file-breadcrumbs" aria-label="选择文件路径"><button type="button" aria-current={!files.directory ? 'page' : undefined} onClick={() => commands.navigate?.('')}>{channel?.qualified_name || channel?.name || channel?.id}</button>{files.directory && <span>{files.directory}</span>}</nav>
        {files.devices?.length > 1
          ? <select aria-label="选择文件设备" value={files.deviceId || ''} onChange={(event) => commands.selectDevice?.(event.target.value)}>{files.devices.map((device) => <option value={device.id} key={device.id}>{device.name || device.id}</option>)}</select>
          : files.devices?.[0] && <span className="picker-daemon">{files.devices[0].name || files.devices[0].id}</span>}
      </div>
      <div className="attachment-picker-list" aria-busy={files.busy || undefined}>
        {files.error && <p className="governance-error" role="alert">{files.error}</p>}
        {!files.deviceId && <div className="attachment-picker-empty"><strong>当前频道没有可用的 daemon 挂载</strong></div>}
        {files.deviceId && files.busy && !entries.length && <div className="attachment-picker-empty"><strong>正在读取频道目录…</strong></div>}
        {files.deviceId && !files.busy && !entries.length && <div className="attachment-picker-empty"><strong>当前目录为空</strong></div>}
        {entries.map((entry) => entry.kind === 'directory'
          ? <button type="button" className="attachment-picker-row directory" key={entry.key} onClick={() => commands.navigate?.(entry.directory || entry.path || `${entry.name}/`)}><span className="file-kind-icon folder-icon" aria-hidden="true" /><strong>{entry.name}</strong><small>文件夹</small><span aria-hidden="true">›</span></button>
          : entry.kind === 'file' && <button type="button" className="attachment-picker-row file" key={entry.key} onClick={() => onChoose?.(entry)}><span className="file-kind-icon" aria-hidden="true">FILE</span><strong>{entry.name}</strong><small>{Number(entry.size || 0)} B</small><span>选择</span></button>)}
        {files.next && <button type="button" className="bounded-list-control" disabled={files.busy} onClick={() => commands.loadMore?.(files.next)}>载入更多</button>}
      </div>
      <footer><button type="button" onClick={onClose}>取消</button></footer>
    </section>
  </div>;
}

function ActivityRows({ rows = [], empty, unavailable = '', onOpen }) {
  if (unavailable) {
    return <div className="activity-list">
      <div className="activity-empty"><strong>{unavailable}</strong><p>当前后端没有可验证的操作事实；这里不会伪造历史记录。</p></div>
    </div>;
  }
  return <div className="activity-list">
    {rows.map((item) => <button
      type="button"
      className={`activity-row state-${item.state || 'info'}`}
      key={item.key}
      onClick={() => onOpen?.(item.source)}
    >
      <span className="activity-kind">{item.kindLabel || item.kind || '动态'}</span>
      <span className="activity-copy"><strong>{item.title}</strong><small>{item.channelName || item.channelId}{item.detail ? ` · ${item.detail}` : ''}</small></span>
      <span className="activity-open">返回来源 ›</span>
    </button>)}
    {!rows.length && <div className="activity-empty"><strong>{empty}</strong><p>这里只展示当前账户可见频道中的真实事实。</p></div>}
  </div>;
}

function ActivityFeature({ port = {}, onClose }) {
  const [tab, setTab] = useState('activity');
  const operationsUnavailable = tab === 'operations' && port.operationsUnavailable;
  const rows = tab === 'activity' ? port.activities || [] : port.operations || [];
  const empty = tab === 'activity' ? '没有需要关注的活动' : '没有进行中的操作';
  return <SidePanel
    className="activity-center"
    ariaLabel="全局活动"
    eyebrow="GLOBAL"
    title="活动中心"
    tabs={ACTIVITY_TABS}
    activeTab={tab}
    onTabChange={setTab}
    onClose={onClose}
  >
    <ActivityRows rows={rows} empty={empty} unavailable={operationsUnavailable ? '当前没有可用的进行中操作快照' : ''} onOpen={port.commands?.open} />
  </SidePanel>;
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
  const terminalChannelId = channel?.id || terminal.channelId || '';
  // This is only a view-lifetime latch: PTY session/screen truth remains in
  // the retained terminal owner. Once opened for a channel, keeping the view
  // mounted while hidden prevents close/reopen from tearing down its attach.
  const [openedTerminalChannels, setOpenedTerminalChannels] = useState(() => new Set());
  useEffect(() => {
    if (!terminal.visible || !terminalChannelId) return;
    setOpenedTerminalChannels((current) => {
      if (current.has(terminalChannelId)) return current;
      const next = new Set(current);
      next.add(terminalChannelId);
      return next;
    });
  }, [terminal.visible, terminalChannelId]);
  const terminalMounted = terminal.mounted !== false
    && contentVisible
    && openedTerminalChannels.has(terminalChannelId);
  return <>
    {filesActive && (contentVisible ? <FilesFeature key="files" channel={channel} port={files} visible onClose={files.commands?.close} /> : <InaccessibleFeature key="files-inaccessible" label="文件" />)}
    {tasksActive && (contentVisible ? <TasksFeature key="tasks" port={tasks} /> : <InaccessibleFeature key="tasks-inaccessible" label="任务" />)}
    {terminalMounted && <TerminalFeature key={`terminal:${terminalChannelId}`} channelId={terminalChannelId} port={terminal} visible={terminal.visible} onClose={terminal.commands?.close} />}
  </>;
}

function ContextHost({ type, focusKey, onClose, children }) {
  const hostRef = useRef(null);
  const openerRef = useRef(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    openerRef.current = active && active !== document.body && active.isConnected
      ? active
      : document.querySelector('.mobile-channel-toggle');
    hostRef.current?.querySelector('.context-pane button[aria-label^="关闭"]')?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const escape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose?.();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return <div ref={hostRef} className="context-host" data-context-type={type || 'context'} data-context-key={focusKey || ''}>
    <button type="button" className="context-backdrop" aria-label="关闭上下文" tabIndex={-1} onClick={onClose} />
    <div className="context-pane">{children}</div>
  </div>;
}

function ArtifactReferenceBoundary({ channel, files, children }) {
  const channelId = String(channel?.id || '');
  const selectedChannelId = String(files.selectedArtifact?.channelId || '');
  const preview = files.commands?.preview;
  const openFileReference = (reference) => {
    // A right-panel artifact is owned by the channel that produced it. Keep
    // the public preview command as the only navigation owner; a stale panel
    // or a missing command must not guess a target channel or open a host
    // path in the browser.
    if (!channelId || selectedChannelId !== channelId || typeof preview !== 'function') return;
    const attachment = attachmentFromFileReference(reference);
    preview({
      ...attachment,
      key: `resource:${channelId}:${attachment.resource_id}`,
      channelId,
      resourceId: attachment.resource_id,
      mediaType: attachment.media_type,
    });
  };
  return <MarkdownFileReferenceProvider onOpen={openFileReference}>{children}</MarkdownFileReferenceProvider>;
}

export function WorkspaceRightPanel({ panel, channel, files = {}, tasks = {}, roster = {}, governance = {}, automation = {}, activity = {}, onClose }) {
  const kind = typeof panel === 'string' ? panel : panel?.kind || panel?.value || '';
  let content = null;
  let dismiss = onClose;
  let focusKey = kind;
  if (kind === WORKSPACE_FEATURE_PANEL.roster) content = <RosterFeature port={roster} onClose={onClose} />;
  else if (kind === WORKSPACE_FEATURE_PANEL.actor) {
    focusKey = `${kind}:${roster.selectedActor?.id || ''}`;
    content = <ActorDetailPanel port={roster} onClose={onClose} />;
  }
  else if (kind === WORKSPACE_FEATURE_PANEL.artifact) {
    focusKey = `${kind}:${files.selectedArtifact?.key || files.selectedArtifact?.resourceId || ''}`;
    dismiss = () => {
      files.commands?.select?.(null);
      onClose?.();
    };
    content = <ArtifactPreviewPanel port={files} onClose={onClose} />;
  }
  else if (kind === WORKSPACE_FEATURE_PANEL.task) {
    focusKey = `${kind}:${tasks.selectedItem?.key || tasks.selectedItem?.id || ''}`;
    content = <TaskDetailPanel port={tasks} onClose={onClose} />;
  }
  else if (kind === WORKSPACE_FEATURE_PANEL.automation) content = <ChannelAutomationPanel channel={channel} port={automation} onClose={onClose} />;
  else if (kind === WORKSPACE_FEATURE_PANEL.channelAdministration) {
    const initialTab = typeof panel === 'object' ? panel.initialTab : undefined;
    focusKey = `${kind}:${initialTab || 'members'}`;
    const governancePort = governance.channel || governance;
    content = initialTab === 'overview'
      ? <ChannelCreateModal channel={channel} port={governancePort} onClose={onClose} />
      : <ChannelAdministrationPanel channel={channel} port={governancePort} initialTab={initialTab} onClose={onClose} />;
  }
  else if (kind === WORKSPACE_FEATURE_PANEL.spaceAdministration) content = <SpaceAdministrationPanel channel={channel} port={governance.space || governance} onClose={onClose} />;
  else if (kind === WORKSPACE_FEATURE_PANEL.activity) content = <ActivityFeature port={activity} onClose={onClose} />;
  if (!content) return null;
  // A new-channel request is an app-level modal, not a context side panel.
  // Keep this feature-owned branch outside ContextHost so the public rail
  // contract has one dialog and no hidden governance panel behind it.
  if (kind === WORKSPACE_FEATURE_PANEL.channelAdministration && typeof panel === 'object' && panel.initialTab === 'overview') return content;
  const wrappedContent = kind === WORKSPACE_FEATURE_PANEL.artifact
    ? <ArtifactReferenceBoundary channel={channel} files={files}>{content}</ArtifactReferenceBoundary>
    : content;
  return <ContextHost key={focusKey} type={kind === WORKSPACE_FEATURE_PANEL.artifact ? 'artifact' : kind} focusKey={focusKey} onClose={dismiss}>{wrappedContent}</ContextHost>;
}

export function WorkspaceFeatureOverlays({ search = {}, filePicker = null }) {
  return <>
    {search.open && <SearchFeature port={search} />}
    {filePicker?.open && <ChannelFilePickerModal
      channel={filePicker.channel}
      files={filePicker.files}
      onChoose={filePicker.onChoose}
      onClose={filePicker.onClose}
    />}
  </>;
}

export function workspaceFeatureChannelListProps(commands = {}) {
  return Object.freeze({
    onSearch: () => commands.openSearch?.(),
    onSpaceManage: () => commands.openSpaceAdministration?.(),
  });
}
