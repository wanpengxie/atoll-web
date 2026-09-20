import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock3, FileText } from 'lucide-react';
import { turnProcessAuditFacts } from '../../model/terminal-result.js';
import { argsOf } from '../../protocol/envelope.js';
import { ArtifactPreviewPanel } from './files/ArtifactPreviewPanel.jsx';
import { FilesFeature } from './files/FilesFeature.jsx';
import { ChannelAdministrationPanel, ChannelAutomationPanel, ChannelCreateModal, SpaceAdministrationPanel } from './governance/GovernanceFeature.jsx';
import { ActorDetailPanel, RosterFeature } from './roster/RosterFeature.jsx';
import { SearchFeature } from './search/SearchFeature.jsx';
import { TaskDetailPanel } from './tasks/TaskDetailPanel.jsx';
import { TasksFeature } from './tasks/TasksFeature.jsx';
import { TerminalFeature } from './terminal/TerminalFeature.jsx';
import { SidePanel } from '../primitives/SidePanel.jsx';
import { useModalFocus } from '../primitives/useModalFocus.js';

export const WORKSPACE_FEATURE_PANEL = Object.freeze({
  roster: 'roster',
  actor: 'actor',
  artifact: 'artifact',
  task: 'task',
  automation: 'automation',
  channelAdministration: 'channel-administration',
  spaceAdministration: 'space-administration',
  activity: 'activity',
  readingHistory: 'reading-history',
});

const ACTIVITY_TABS = Object.freeze([
  { id: 'activity', label: '活动' },
  { id: 'operations', label: '操作' },
]);

function InaccessibleFeature({ label }) {
  return <section className="workspace-view channel-private-empty" role="region" aria-label={label}><strong>{label}不可访问</strong><p>恢复频道访问后才能查看。</p></section>;
}

function processFactLabel(fact) {
  const kind = fact.kind === 'tool' ? '工具过程' : fact.kind === 'stage' ? '阶段过程' : fact.kind === 'turn' ? '回合过程' : '运行过程';
  return fact.phase ? `${kind} · ${fact.phase}` : kind;
}

function TurnDetailPanel({ turn, onClose }) {
  const request = argsOf(turn?.request);
  const terminal = argsOf(turn?.terminal);
  const processFacts = turnProcessAuditFacts(turn);
  const value = terminal.value && typeof terminal.value === 'object' && !Array.isArray(terminal.value)
    ? terminal.value
    : terminal;
  const title = String(request.name || request.text || request.description || turn?.request?.type || '频道回合');
  return <section className="turn-detail-page" role="region" aria-label="回合详情">
    <header className="turn-detail-header"><button type="button" onClick={onClose}>← 返回动态</button><div><p className="eyebrow">WORK TURN</p><h2>回合详情</h2></div></header>
    <div className="turn-detail-scroll"><div className="turn-detail-content">
      <h3>{title}</h3>
      <dl><dt>请求编号</dt><dd>{turn?.requestId || turn?.request?.id || '—'}</dd><dt>类型</dt><dd>{turn?.request?.type || '—'}</dd><dt>状态</dt><dd>{terminal.status || turn?.status || '进行中'}</dd>{turn?.requestSeq != null && <><dt>账本序号</dt><dd>{turn.requestSeq}</dd></>}{turn?.terminal?.id && <><dt>终态编号</dt><dd>{turn.terminal.id}</dd></>}</dl>
      {processFacts.length > 0 && <section className="turn-detail-process" aria-label="执行过程"><h3>执行过程</h3><ol>{processFacts.map((fact) => <li key={`${fact.seq}:${fact.identifiers.map((item) => item.value).join('|')}`}><strong>{processFactLabel(fact)}</strong><small>账本序号 {fact.seq}</small>{fact.identifiers.length > 0 && <dl>{fact.identifiers.map((item) => <div key={`${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}</li>)}</ol></section>}
      {value.channel_id && <p>目标频道：{value.channel_id}</p>}
      {terminal.detail && <p>{terminal.detail}</p>}
    </div></div>
  </section>;
}

// The picker is a presentation of the existing Files owner. It never keeps a
// directory/device/resource store of its own: navigation, refresh and the
// resource rows all come from the typed Files port, while the Workspace owner
// resolves the one-shot selection back to Composer.
function ChannelFilePickerModal({ channel, files = {}, requestId, onChoose, onClose, onRequestSettled }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const refreshBaselineRef = useRef(null);
  const refreshSettledRef = useRef(false);
  const commands = files.commands || {};
  const entries = files.entries || [];
  useModalFocus({ dialogRef, initialFocusRef: closeRef, onClose });
  useEffect(() => {
    if (!channel?.id || !files.deviceId || typeof commands.refresh !== 'function') return;
    const baseline = Number(files.refreshReceipt?.epoch || 0);
    refreshBaselineRef.current = {
      epoch: baseline,
      requestId: String(requestId || ''),
      channelId: String(channel.id),
      deviceId: String(files.deviceId),
    };
    refreshSettledRef.current = false;
    let active = true;
    void Promise.resolve()
      .then(() => commands.refresh())
      .catch(() => {
        if (active) onRequestSettled?.(null, requestId);
      });
    return () => { active = false; };
    // The Files owner changes its directory/device state; the picker only
    // asks for the initial authoritative page when its channel/device changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, files.deviceId, requestId]);
  useEffect(() => {
    const baseline = refreshBaselineRef.current;
    const receipt = files.refreshReceipt;
    if (!baseline || refreshSettledRef.current
      || String(baseline.requestId) !== String(requestId || '')
      || String(receipt?.channelId || '') !== baseline.channelId
      || String(receipt?.deviceId || '') !== baseline.deviceId
      || Number(receipt?.epoch || 0) <= baseline.epoch
      || receipt?.phase !== 'settled') return;
    refreshSettledRef.current = true;
    if (receipt.error) onRequestSettled?.(null, requestId);
  }, [files.refreshReceipt, onRequestSettled, requestId]);
  const refreshBaseline = refreshBaselineRef.current;
  const refreshError = refreshBaseline
    && String(files.refreshReceipt?.channelId || '') === refreshBaseline.channelId
    && String(files.refreshReceipt?.deviceId || '') === refreshBaseline.deviceId
    && Number(files.refreshReceipt?.epoch || 0) > refreshBaseline.epoch
    && files.refreshReceipt?.phase === 'settled'
    ? String(files.refreshReceipt?.error || '')
    : '';
  return <div
    className="modal-backdrop attachment-picker-backdrop"
    data-modal-layer
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
  >
    <section ref={dialogRef} className="attachment-picker-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-picker-title" aria-describedby="attachment-picker-description">
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
        {refreshError && <p className="governance-error" role="alert">{refreshError}</p>}
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
      onClick={() => onOpen?.(item)}
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
  const open = (item) => {
    const source = item?.source;
    if (!source) return;
    // Activity owns presentation only. The Workspace command validates access,
    // chooses the channel/view, preserves the typed focus and commits the URL.
    port.commands?.open?.({ source });
  };
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
    <ActivityRows rows={rows} empty={empty} unavailable={operationsUnavailable ? '当前没有可用的进行中操作快照' : ''} onOpen={open} />
  </SidePanel>;
}

function openedLabel(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function ReadingHistoryFeature({ files = {}, onClose }) {
  const recent = Array.isArray(files.recent) ? files.recent : [];
  const open = files.commands?.preview;
  return <SidePanel
    className="recent-files-context"
    ariaLabel="最近阅读"
    title="最近阅读"
    closeLabel="关闭最近阅读"
    onClose={onClose}
  >
    {recent.length === 0
      ? <div className="recent-files-empty"><Clock3 size={24} /><strong>还没有阅读记录</strong><p>从消息或文件区打开的文件会出现在这里。</p></div>
      : <div className="recent-files-list">{recent.map((file) => <button
        type="button"
        key={file.key || `${file.channelId}:${file.resourceId}`}
        title={file.resourceId}
        disabled={typeof open !== 'function'}
        onClick={() => open?.(file)}
      >
        <FileText size={16} aria-hidden="true" />
        <span><strong>{file.name}</strong><small>{openedLabel(file.lastOpenedAt)}{file.line ? ` · 第 ${file.line} 行` : ''}</small></span>
      </button>)}</div>}
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

function ContextHost({ type, focusKey, onClose, paneLayout = null, children }) {
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
  const measurePane = () => {
    const measured = Number(hostRef.current?.querySelector('.context-pane')?.getBoundingClientRect?.().width);
    return Number.isFinite(measured) && measured > 0 ? measured : undefined;
  };
  return <div
    ref={hostRef}
    className="context-host"
    data-context-type={type || 'context'}
    data-context-key={focusKey || ''}
    style={paneLayout?.width == null ? undefined : { '--context-width': String(paneLayout.width) + 'px' }}
  >
    <button type="button" className="context-backdrop" aria-label="关闭上下文" tabIndex={-1} onClick={onClose} />
    <div className="context-pane">
      {paneLayout?.renderHandle?.(measurePane)}
      {children}
    </div>
  </div>;
}

export function WorkspaceRightPanel({ panel, channel, files = {}, tasks = {}, roster = {}, governance = {}, automation = {}, activity = {}, turn = null, onClose, layout = null }) {
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
    content = <ArtifactPreviewPanel channel={channel} port={files} onClose={onClose} />;
  }
  else if (kind === WORKSPACE_FEATURE_PANEL.task) {
    focusKey = `${kind}:${tasks.selectedItem?.key || tasks.selectedItem?.id || ''}`;
    content = <TaskDetailPanel port={tasks} onClose={onClose} />;
  }
  else if (kind === 'turn') {
    focusKey = `${kind}:${typeof panel === 'object' ? panel.requestId || panel.key || '' : ''}`;
    content = <TurnDetailPanel turn={turn} onClose={onClose} />;
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
  else if (kind === WORKSPACE_FEATURE_PANEL.readingHistory) content = <ReadingHistoryFeature files={files} onClose={onClose} />;
  if (!content) return null;
  // A new-channel request is an app-level modal, not a context side panel.
  // Keep this feature-owned branch outside ContextHost so the public rail
  // contract has one dialog and no hidden governance panel behind it.
  if (kind === WORKSPACE_FEATURE_PANEL.channelAdministration && typeof panel === 'object' && panel.initialTab === 'overview') return content;
  const paneLayout = layout?.forPane?.(kind === WORKSPACE_FEATURE_PANEL.artifact ? 'artifact' : 'context') || null;
  return <ContextHost
    key={focusKey}
    type={kind === WORKSPACE_FEATURE_PANEL.artifact ? 'artifact' : kind}
    focusKey={focusKey}
    onClose={dismiss}
    paneLayout={paneLayout}
  >{content}</ContextHost>;
}

export function WorkspaceFeatureOverlays({ search = {}, filePicker = null }) {
  return <>
    {search.open && <SearchFeature port={search} />}
    {filePicker?.open && <ChannelFilePickerModal
      channel={filePicker.channel}
      files={filePicker.files}
      requestId={filePicker.requestId}
      onChoose={filePicker.onChoose}
      onClose={filePicker.onClose}
      onRequestSettled={filePicker.onRequestSettled}
    />}
  </>;
}

export function workspaceFeatureChannelListProps(commands = {}) {
  return Object.freeze({
    onSearch: () => commands.openSearch?.(),
    onSpaceManage: () => commands.openSpaceAdministration?.(),
  });
}
