import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SurfaceShell, useSurfaceTopology } from './SurfaceShell.jsx';
import { useModalFocus } from '../ui/primitives/useModalFocus.js';
import { diagnostic } from '../model/diagnostics.js';

const VIEW_LABELS = Object.freeze({ conversation: '动态', tasks: '任务' });
const VIEW_ENTRIES = Object.freeze(Object.entries(VIEW_LABELS));
const PANE_CONFIG = Object.freeze({
  rail: Object.freeze({
    defaultWidth: 264,
    min: 200,
    max: 520,
    step: 16,
    storageKey: 'atoll.web.pane.rail',
    grows: 'right',
    label: '调整频道栏宽度',
  }),
  context: Object.freeze({
    defaultWidth: 360,
    min: 300,
    workspaceReserve: 420,
    step: 16,
    storageKey: 'atoll.web.pane.context',
    grows: 'left',
    label: '调整右侧面板宽度',
  }),
  artifact: Object.freeze({
    defaultWidth: 520,
    min: 420,
    workspaceReserve: 360,
    step: 16,
    storageKey: 'atoll.web.pane.artifact',
    grows: 'left',
    label: '调整右侧面板宽度',
  }),
});

function viewportWidth() {
  const value = Number(globalThis.innerWidth);
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function paneMax(kind, availableWidth = viewportWidth()) {
  const config = PANE_CONFIG[kind];
  if (!config) return null;
  if (config.max !== undefined) return config.max;
  if (!Number.isFinite(availableWidth)) return Number.POSITIVE_INFINITY;
  return Math.max(config.min, availableWidth - config.workspaceReserve);
}

function clampPaneWidth(kind, value, availableWidth = viewportWidth()) {
  const config = PANE_CONFIG[kind];
  const number = Number(value);
  if (!config || !Number.isFinite(number)) return null;
  return Math.round(Math.min(paneMax(kind, availableWidth), Math.max(config.min, number)));
}

function readPaneWidth(kind) {
  const config = PANE_CONFIG[kind];
  if (!config) return null;
  try {
    const raw = globalThis.localStorage?.getItem(config.storageKey);
    if (raw === null || raw === undefined || raw === '') return null;
    return clampPaneWidth(kind, raw);
  } catch {
    return null;
  }
}

function writePaneWidth(kind, value) {
  const config = PANE_CONFIG[kind];
  if (!config) return;
  try {
    if (value === null || value === undefined) globalThis.localStorage?.removeItem(config.storageKey);
    else globalThis.localStorage?.setItem(config.storageKey, String(Math.round(value)));
  } catch {
    // A disabled/full convenience store must not break the active shell.
  }
}

const ACTIVE_NODE_UPDATE_STATES = new Set([
  'starting',
  'downloading',
  'verifying',
  'installing',
  'restarting',
]);

function connectionLabel(state) {
  return ({ open: 'OPEN', connecting: 'CONNECTING', reconnecting: 'RECONNECTING', closed: 'CLOSED' })[state]
    || String(state || 'CLOSED').toUpperCase();
}

function activityDuration(startedAt, now) {
  const seconds = Math.max(0, Math.floor((now - Number(startedAt || now)) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// A channel row is the registry profile spread as-is, so any field on it is
// whatever the registry sent. `name` has been observed arriving as an object,
// which React refuses to render and which took the whole workspace down with
// error #31 — a malformed label must not be able to white-screen the app.
function channelLabel(channel, fallback = '') {
  for (const value of [channel?.qualified_name, channel?.name, channel?.profile?.name, channel?.id]) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
    // Report the row that carried it instead of crashing on it. Without this
    // the only evidence was a minified React #31 naming the object's keys.
    if (value && typeof value === 'object') {
      diagnostic('warn', 'channel_label.not_a_string', {
        channelId: String(channel?.id || ''),
        keys: Object.keys(value).slice(0, 8),
        access: String(channel?.access || ''),
      });
    }
  }
  return fallback;
}

function actorShortName(actorId) {
  return String(actorId || '').split(':')[1] || String(actorId || 'agent');
}

function accessLabel(access) {
  return ({
    member_stale: '离线缓存',
    member_unavailable: '暂不可用',
    observer_active: '只读旁观',
    observer_stale: '旁观中断',
    discoverable: '可发现',
    access_denied: '无权访问',
    loading: '确认中',
  })[access] || '';
}

function canReadChannel(channel) {
  return ['member_active', 'member_stale', 'member_unavailable', 'observer_active', 'observer_stale']
    .includes(String(channel?.access || ''));
}

function unreadProjection(value) {
  const count = (candidate) => {
    const number = Number(candidate);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  return {
    related: count(value?.related),
    other: count(value?.other),
    pending: value?.pending === true,
    unknown: value?.unknown === true,
  };
}

function nodeUpdateCurrentVersion(update) {
  const value = update?.current_version ?? update?.currentVersion;
  return value == null || value === '' ? '未提供' : String(value);
}

function PaneResizeHandle({ kind, width, measure, onResize, onCommit, onReset }) {
  const config = PANE_CONFIG[kind] || PANE_CONFIG.rail;
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const startWidth = useCallback(() => {
    const measured = Number(measure?.());
    return clampPaneWidth(kind, width ?? (Number.isFinite(measured) && measured > 0 ? measured : config.defaultWidth))
      ?? config.defaultWidth;
  }, [config.defaultWidth, kind, measure, width]);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originWidth: startWidth(),
      last: null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }, [startWidth]);

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const direction = config.grows === 'left' ? -1 : 1;
    const next = clampPaneWidth(kind, drag.originWidth + direction * (event.clientX - drag.originX));
    if (next === null || next === drag.last) return;
    drag.last = next;
    onResize?.(next);
  }, [config.grows, kind, onResize]);

  const finish = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    if (drag.last !== null) onCommit?.(drag.last);
  }, [onCommit]);

  const onKeyDown = useCallback((event) => {
    let delta = 0;
    if (event.key === 'ArrowLeft') delta = config.grows === 'left' ? config.step : -config.step;
    else if (event.key === 'ArrowRight') delta = config.grows === 'left' ? -config.step : config.step;
    else if (event.key === 'Home' || event.key === 'End') delta = 0;
    else return;
    event.preventDefault();
    if (event.key === 'Home') {
      onReset?.();
      return;
    }
    const next = clampPaneWidth(kind, startWidth() + delta);
    if (next !== null) {
      onResize?.(next);
      onCommit?.(next);
    }
  }, [config.grows, config.step, kind, onCommit, onResize, onReset, startWidth]);

  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label={config.label}
    aria-valuemin={config.min}
    aria-valuemax={Number.isFinite(paneMax(kind)) ? paneMax(kind) : undefined}
    aria-valuenow={width ?? undefined}
    tabIndex={0}
    className={`pane-resizer pane-resizer-${kind} grows-${config.grows}${dragging ? ' is-dragging' : ''}`}
    title="拖动调整宽度，双击复原"
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={finish}
    onPointerCancel={finish}
    onDoubleClick={() => onReset?.()}
    onKeyDown={onKeyDown}
  />;
}

function nodeUpdateLabel(update, wireState) {
  if (update?.status === 'unsupported' || update?.status === 'unavailable') {
    return update.detail || '当前节点升级能力不可用';
  }
  if (update?.status === 'restarting' && wireState !== 'open') return '正在重连…';
  return ({
    starting: '准备升级…',
    downloading: '正在下载…',
    verifying: '正在校验…',
    installing: '正在安装…',
    restarting: '正在重启…',
    failed: '升级失败，重试',
  })[update?.status] || `升级到 ${update?.latest_version || update?.latestVersion || '最新版'}`;
}

function WorkspaceRail({ session, navigation, onClose, closeButtonRef, railRef, onSelect }) {
  const memberChannels = navigation.channels.filter((channel) => String(channel.access || '').startsWith('member_'));
  const otherChannels = navigation.channels.filter((channel) => !String(channel.access || '').startsWith('member_'));
  const activeCount = Object.values(navigation.agentActivity?.byChannel || {})
    .reduce((count, channel) => count + (channel.active?.length || 0), 0);
  const [now, setNow] = useState(Date.now);
  const nodeUpdatePort = navigation.update;
  const nodeUpdate = nodeUpdatePort?.value;
  const nodeUpdateUnavailable = nodeUpdate?.status === 'unsupported' || nodeUpdate?.status === 'unavailable';
  const nodeUpdateActive = ACTIVE_NODE_UPDATE_STATES.has(nodeUpdate?.status);
  const nodeUpdateFailed = nodeUpdate?.status === 'failed';
  const nodeUpdateAvailable = nodeUpdate?.available === true;
  const nodeUpdateVisible = nodeUpdateUnavailable || nodeUpdateActive || nodeUpdateFailed || nodeUpdateAvailable;
  const nodeUpdatePending = nodeUpdatePort?.pending === true;
  useEffect(() => {
    if (!activeCount) return undefined;
    setNow(Date.now());
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000);
    return () => globalThis.clearInterval(timer);
  }, [activeCount]);
  const renderRows = (rows, empty) => <div className="channel-items">
    {rows.map((channel) => {
      const activity = navigation.agentActivity?.byChannel?.[channel.id] || {};
      const active = activity.active || [];
      const settled = Object.entries(activity.agents || {}).filter(([, value]) => value.state === 'settled');
      const unread = unreadProjection(navigation.unread?.[channel.id]);
      const unreadPending = unread.pending || unread.unknown;
      const label = accessLabel(channel.access);
      return <button
        type="button"
        className={channel.id === navigation.activeChannelId ? 'channel-item active' : 'channel-item'}
        key={channel.id}
        aria-current={channel.id === navigation.activeChannelId ? 'page' : undefined}
        onClick={() => {
          onSelect?.(channel.id);
          onClose?.('none');
        }}
      >
        <span className="channel-glyph">#</span>
        <span className="channel-main">
          <span className="channel-name">{channelLabel(channel)}</span>
          {active.length > 0 && <span className="channel-agent-activity" aria-label={`${active.length} 项 Agent 正在运行`}>
            {active.slice(0, 2).map((entry) => <span className="channel-agent-timer" key={entry.requestId}><i /><b>{actorShortName(entry.agentId)}</b><time>{activityDuration(entry.startedAt, now)}</time></span>)}
            {active.length > 2 && <span className="channel-agent-more" title={`另有 ${active.length - 2} 项正在运行`}>+{active.length - 2}</span>}
          </span>}
          {settled.length > 0 && <span className="channel-agent-more" aria-label={`${settled.length} 项 Agent 已完成`}>✓ {settled.length}</span>}
        </span>
        <span className="channel-trailing">
          {label && <span className={`channel-access-label label-${channel.access}`}>{label}</span>}
          {!unreadPending && unread.related > 0 && <span className="unread-badge unread-related" aria-label={`${unread.related} 条与我相关的未读消息`} title="与我相关的未读消息">{unread.related > 99 ? '99+' : unread.related}</span>}
          {!unreadPending && unread.other > 0 && <span className="unread-badge unread-total" aria-label={`${unread.other} 条其他未读消息`} title="其他未读消息">{unread.other > 99 ? '99+' : unread.other}</span>}
          {unreadPending && <span className="unread-total unread-pending" aria-label={unread.unknown ? '未读状态待同步' : '正在恢复未读状态'} title={unread.unknown ? '未读状态待同步' : '正在恢复未读状态'}>{unread.unknown ? '?' : '…'}</span>}
        </span>
      </button>;
    })}
    {!rows.length && <p className="rail-empty">{empty}</p>}
  </div>;
  return <aside ref={railRef} className="channel-rail" data-modal-layer={onClose ? '' : undefined}>
    <header className="rail-header">
      <div className="brand-lockup"><span className="brand-dot" />ATOLL</div>
      <div className={`connection-state state-${session.wireState}`}><span aria-hidden="true" />{connectionLabel(session.wireState)}</div>
      {onClose && <button ref={closeButtonRef} type="button" className="mobile-rail-close" onClick={() => onClose('toggle')} aria-label="关闭频道列表">×</button>}
    </header>
    <nav aria-label="频道">
      <div className="rail-global-actions" aria-label="全局工具">
        <button type="button" onClick={() => { onClose?.('none'); navigation.openSearch(); }} aria-label="全局搜索"><span aria-hidden="true">⌕</span> 搜索</button>
        {navigation.openActivity && <button type="button" onClick={() => { onClose?.('none'); navigation.openActivity(); }} aria-label="打开活动中心" title="活动中心"><span aria-hidden="true">◷</span> 活动</button>}
      </div>
      <p className="rail-caption">我的频道 <span>{memberChannels.length}</span></p>
      {navigation.openChannelAdministration && <button type="button" className="rail-create-button" onClick={() => { onClose?.('none'); navigation.openChannelAdministration('overview'); }} aria-label="新建频道" title="在当前频道下新建子频道"><span aria-hidden="true">＋</span> 新建频道</button>}
      {renderRows(memberChannels, '还没有加入频道')}
      <p className="rail-caption space-caption">空间 <span>{otherChannels.length}</span></p>
      {renderRows(otherChannels, '没有可发现频道')}
    </nav>
    {nodeUpdateVisible && <div className="node-update-action" aria-label="节点升级">
      <button
        type="button"
        disabled={nodeUpdateUnavailable || nodeUpdateActive || nodeUpdatePending || typeof nodeUpdatePort?.start !== 'function'}
        onClick={() => {
          if (typeof nodeUpdatePort?.start !== 'function') return;
          const target = nodeUpdate?.latest_version || nodeUpdate?.latestVersion || '最新版';
          const confirmed = typeof globalThis.confirm === 'function'
            && globalThis.confirm(`升级到 ${target}？\n\n升级会重启 Atoll，并暂时中断当前连接和正在进行的工作。频道记录、任务和工作区数据会保留。`);
          if (confirmed) void nodeUpdatePort.start().catch(() => {});
        }}
        title={nodeUpdate?.detail || `升级到 ${nodeUpdate?.latest_version || nodeUpdate?.latestVersion || '最新版'}`}
      >
        {!nodeUpdateUnavailable && <span aria-hidden="true">↑</span>}
        {nodeUpdateLabel(nodeUpdate, session.wireState)}
      </button>
      <div className="node-version" aria-label="当前版本（只读）">当前版本：{nodeUpdateCurrentVersion(nodeUpdate)}（只读）</div>
    </div>}
    {!nodeUpdateVisible && nodeUpdate && nodeUpdateCurrentVersion(nodeUpdate) !== '未提供' && <div className="node-version" aria-label="当前版本（只读）">当前版本：{nodeUpdateCurrentVersion(nodeUpdate)}（只读）</div>}
    <footer className="account-card">
      <span className="avatar">{String(session.me?.display_name || session.me?.id || '?').slice(0, 1).toUpperCase()}</span>
      <span><strong>{session.me?.display_name || '已登录用户'}</strong><small>{session.me?.id}</small></span>
      <span className="account-actions"><button type="button" onClick={() => { onClose?.('none'); navigation.openSpaceAdministration(); }} aria-label="空间管理" title="空间管理">空间管理</button><button type="button" onClick={session.onLogout} aria-label="退出" title="退出">退出</button></span>
    </footer>
  </aside>;
}

// Pure shell chrome. Domain lifetimes remain in the ports composed by
// WorkspaceApp and its existing owners.
export function WorkspaceLayout({
  session,
  navigation,
  notices = {},
  conversation,
  features = null,
  rightPanel = null,
  overlays = null,
}) {
  const topology = useSurfaceTopology();
  const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false);
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const channel = navigation.channel;
  const filesOpen = navigation.activeView === 'files';
  const readingHistoryAvailable = typeof navigation.openReadingHistory === 'function'
    && canReadChannel(channel);
  const mobileChannelToggleRef = useRef(null);
  const mobileRailRef = useRef(null);
  const inactiveMobileDialogRef = useRef(null);
  const mobileRailCloseRef = useRef(null);
  const mobileDrawerReturnFocusRef = useRef(null);
  const mobileDrawerNoFocusRef = useRef({ isConnected: false });
  const channelHeadingRef = useRef(null);
  const channelMenuRef = useRef(null);
  const channelMenuButtonRef = useRef(null);
  const channelMenuReturnFocusRef = useRef(null);
  const filesToggleRef = useRef(null);
  const filesOpenRef = useRef(filesOpen);
  const viewTabRefs = useRef([]);
  const [paneWidths, setPaneWidths] = useState(() => ({
    rail: readPaneWidth('rail'),
    context: readPaneWidth('context'),
    artifact: readPaneWidth('artifact'),
  }));
  const previewPaneWidth = useCallback((kind, value) => {
    const next = clampPaneWidth(kind, value);
    if (next === null) return;
    setPaneWidths((current) => current[kind] === next ? current : { ...current, [kind]: next });
  }, []);
  const commitPaneWidth = useCallback((kind, value) => {
    const next = clampPaneWidth(kind, value);
    if (next === null) return;
    setPaneWidths((current) => current[kind] === next ? current : { ...current, [kind]: next });
    writePaneWidth(kind, next);
  }, []);
  const resetPaneWidth = useCallback((kind) => {
    if (!PANE_CONFIG[kind]) return;
    setPaneWidths((current) => current[kind] === null ? current : { ...current, [kind]: null });
    writePaneWidth(kind, null);
  }, []);
  const measureRailWidth = useCallback(() => {
    const measured = Number(mobileRailRef.current?.getBoundingClientRect?.().width);
    return Number.isFinite(measured) && measured > 0 ? measured : PANE_CONFIG.rail.defaultWidth;
  }, []);
  // WorkspaceLayout is the sole geometry/storage owner. ContextHost only
  // receives this narrow presentation port and never owns width state or keys.
  const paneLayoutPort = {
    forPane: (kind) => {
      const config = PANE_CONFIG[kind];
      if (!config) return null;
      return {
        kind,
        width: paneWidths[kind],
        min: config.min,
        max: paneMax(kind),
        grows: config.grows,
        label: config.label,
        renderHandle: (measure) => <PaneResizeHandle
          kind={kind}
          width={paneWidths[kind]}
          measure={measure}
          onResize={(value) => previewPaneWidth(kind, value)}
          onCommit={(value) => commitPaneWidth(kind, value)}
          onReset={() => resetPaneWidth(kind)}
        />,
      };
    },
  };
  const rightPanelElement = React.isValidElement(rightPanel)
    ? React.cloneElement(rightPanel, { layout: paneLayoutPort, returnFocusRef: channelMenuReturnFocusRef })
    : rightPanel;
  useLayoutEffect(() => {
    if (!rightPanel) channelMenuReturnFocusRef.current = null;
  }, [rightPanel]);
  const pendingChannelSelectionRef = useRef(null);
  // Presentation-only handoff gate. `navigation.activeChannelId` remains the
  // sole committed selection authority; this state only disables controls
  // while that owner commits or explicitly rejects the request.
  const [pendingChannelSelection, setPendingChannelSelection] = useState(null);
  // The responsive CSS hides the message pane when a compact/mobile terminal
  // or file surface takes the only column. Keep that layout fact on the
  // committed shell boundary and pass it to the conversation owner; CSS alone
  // must not be mistaken for a readable/visible message surface.
  const messageSurfaceCovered = (topology === 'mobile' || topology === 'compact')
    && (navigation.terminalVisible || filesOpen);
  const messageSurfaceVisible = conversation?.surfaceVisible !== false && !messageSurfaceCovered;
  // Files owns the only mobile content surface, but it must not remove the
  // mounted Conversation composer. This is a presentation handoff only: the
  // conversation owner still receives the committed `surfaceVisible` state
  // above, while the mobile layout keeps its bottom input affordance
  // available as an overlay over the full Files surface.
  const mobileFilesComposerVisible = (topology === 'mobile' || topology === 'compact')
    && filesOpen
    && !navigation.terminalVisible;
  const conversationElement = React.isValidElement(conversation?.element)
    ? React.cloneElement(conversation.element, {
      ...(typeof conversation.element.type === 'string' ? {} : { surfaceVisible: messageSurfaceVisible }),
      'data-surface-visible': String(messageSurfaceVisible),
    })
    : conversation?.element;
  const terminalTransitionPending = Boolean(
    pendingChannelSelection
    && pendingChannelSelection.origin === navigation.activeChannelId
    && pendingChannelSelection.target !== navigation.activeChannelId,
  );
  const clearPendingChannelSelection = useCallback((selection = null) => {
    const current = pendingChannelSelectionRef.current;
    if (selection && current !== selection) return;
    pendingChannelSelectionRef.current = null;
    setPendingChannelSelection((value) => (selection && value !== selection ? value : null));
  }, []);
  const selectChannel = useCallback((channelId) => {
    if (!channelId) return;
    if (channelId === navigation.activeChannelId) {
      // A→B may still be waiting for the navigation owner to commit. A fast
      // reselect of the committed A is a cancellation of that presentation
      // handoff, not a second navigation command; never replay the side
      // effect through the canonical selection owner.
      if (pendingChannelSelectionRef.current?.origin === navigation.activeChannelId) {
        clearPendingChannelSelection();
      }
      return;
    }
    const pending = {
      target: channelId,
      origin: navigation.activeChannelId,
      focusOrigin: document.activeElement,
    };
    pendingChannelSelectionRef.current = pending;
    setPendingChannelSelection(pending);
    try {
      const accepted = navigation.select(channelId);
      // The navigation owner may explicitly reject an invalid request. An
      // omitted return remains pending because the public shell test doubles
      // and async owners commit identity separately.
      if (accepted === false) clearPendingChannelSelection(pending);
    } catch (error) {
      clearPendingChannelSelection(pending);
      throw error;
    }
  }, [clearPendingChannelSelection, navigation.activeChannelId, navigation.select]);
  useLayoutEffect(() => {
    const pending = pendingChannelSelectionRef.current;
    if (!pending) return;
    const activeChannelId = navigation.activeChannelId;
    if (activeChannelId === pending.target) {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body || activeElement === pending.focusOrigin) {
        channelHeadingRef.current?.focus({ preventScroll: true });
      }
      clearPendingChannelSelection(pending);
      return;
    }
    // A different committed identity means another navigation owner superseded
    // this request. Do not let the stale selection focus the later channel.
    if (activeChannelId !== pending.origin) clearPendingChannelSelection(pending);
  }, [clearPendingChannelSelection, navigation.activeChannelId]);
  const openMobileChannels = () => {
    mobileDrawerReturnFocusRef.current = mobileChannelToggleRef.current;
    setMobileChannelsOpen(true);
  };
  const closeMobileChannels = (focus = 'toggle') => {
    mobileDrawerReturnFocusRef.current = focus === 'none'
      ? mobileDrawerNoFocusRef.current
      : focus === 'heading' ? channelHeadingRef.current : mobileChannelToggleRef.current;
    setMobileChannelsOpen(false);
  };
  const mobileDialogRef = mobileChannelsOpen ? mobileRailRef : inactiveMobileDialogRef;
  useModalFocus({
    dialogRef: mobileDialogRef,
    initialFocusRef: mobileRailCloseRef,
    returnFocusRef: mobileDrawerReturnFocusRef,
    onClose: () => closeMobileChannels('toggle'),
  });
  useLayoutEffect(() => {
    const wasOpen = filesOpenRef.current;
    filesOpenRef.current = filesOpen;
    if (!wasOpen || filesOpen) return;
    // The Files surface owns the close button, but the route belongs to the
    // existing Workspace navigation owner. Once that surface unmounts, return
    // focus only when the close action removed the active element; an explicit
    // Dynamic/tab or channel action keeps its own focus target.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const target = topology === 'mobile' || topology === 'compact'
      ? channelMenuButtonRef.current
      : filesToggleRef.current;
    target?.focus({ preventScroll: true });
  }, [filesOpen, topology]);
  useEffect(() => {
    if (!channelMenuOpen) return undefined;
    const closeOutside = (event) => {
      if (!channelMenuRef.current?.contains(event.target)) setChannelMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setChannelMenuOpen(false);
      channelMenuButtonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [channelMenuOpen]);
  const toggleFiles = () => {
    if (!channel) return;
    navigation.setActiveView(filesOpen ? 'conversation' : 'files');
  };
  const toggleTerminal = () => {
    if (!channel || terminalTransitionPending) return;
    navigation.openTerminal?.();
  };
  useEffect(() => {
    if (!navigation.openTerminal) return undefined;
    const toggleByKey = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== 'F12' || !channel) return;
      event.preventDefault();
      if (terminalTransitionPending) return;
      toggleTerminal();
    };
    document.addEventListener('keydown', toggleByKey, true);
    return () => document.removeEventListener('keydown', toggleByKey, true);
  }, [channel, navigation.openTerminal, terminalTransitionPending]);
  useEffect(() => {
    const switchChannel = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="menu"], [role="listbox"]')) return;
      const channels = navigation.channels.filter((row) => String(row.access || '').startsWith('member_'));
      if (!channels.length) return;
      const direct = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
      const direction = event.key.toLowerCase() === 'n' ? 1 : event.key.toLowerCase() === 'p' ? -1 : 0;
      if (direct < 0 && !direction) return;
      const current = channels.findIndex((row) => row.id === navigation.activeChannelId);
      const target = direct >= 0
        ? channels[direct]
        : channels[(current < 0 ? (direction > 0 ? 0 : channels.length - 1) : current + direction + channels.length) % channels.length];
      if (!target || target.id === navigation.activeChannelId) return;
      event.preventDefault();
      selectChannel(target.id);
    };
    document.addEventListener('keydown', switchChannel);
    return () => document.removeEventListener('keydown', switchChannel);
  }, [navigation.activeChannelId, navigation.channels, selectChannel]);
  const runChannelMenuAction = (command) => {
    setChannelMenuOpen(false);
    channelMenuReturnFocusRef.current = channelMenuButtonRef.current;
    // The menu item is about to unmount. Preserve the stable channel-action
    // opener so ContextHost restores focus on desktop and compact/mobile rails.
    channelMenuButtonRef.current?.focus({ preventScroll: true });
    command?.();
  };
  const moveChannelMenu = (event) => {
    const items = [...(channelMenuRef.current?.querySelectorAll('[role="menuitem"]') || [])]
      .filter((item) => item.offsetParent !== null && !item.disabled);
    if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[next].focus();
  };
  const moveViewTab = (event, index) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % VIEW_ENTRIES.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + VIEW_ENTRIES.length) % VIEW_ENTRIES.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = VIEW_ENTRIES.length - 1;
    else return;
    event.preventDefault();
    navigation.setActiveView(VIEW_ENTRIES[nextIndex][0]);
    viewTabRefs.current[nextIndex]?.focus();
  };
  return <SurfaceShell
    topology={topology}
    className={['shell', mobileChannelsOpen && 'mobile-channels-open', rightPanel && 'has-context'].filter(Boolean).join(' ')}
    data-workspace-view={navigation.activeView}
    style={paneWidths.rail === null ? undefined : { '--rail-width': String(paneWidths.rail) + 'px' }}
  >
    <WorkspaceRail session={session} navigation={navigation} onSelect={selectChannel} onClose={mobileChannelsOpen ? closeMobileChannels : null} closeButtonRef={mobileRailCloseRef} railRef={mobileRailRef} />
    <PaneResizeHandle
      kind="rail"
      width={paneWidths.rail}
      measure={measureRailWidth}
      onResize={(value) => previewPaneWidth('rail', value)}
      onCommit={(value) => commitPaneWidth('rail', value)}
      onReset={() => resetPaneWidth('rail')}
    />
    <main className="workspace">
      <header className="channel-header">
        <div className="channel-identity">
          <button ref={mobileChannelToggleRef} type="button" className="mobile-channel-toggle" onClick={openMobileChannels} aria-label="打开频道列表">‹</button>
          <div><p className="eyebrow">频道</p><h1 ref={channelHeadingRef} tabIndex={-1}>{channelLabel(channel, '选择频道')}</h1></div>
        </div>
        <div className="channel-header-actions">
          <span className="seq-label">SEQ {Number(conversation?.state?.lastSeq || 0)}</span>
          {navigation.openRoster && <button type="button" className="header-action" disabled={!channel} onClick={navigation.openRoster}>成员</button>}
          <div className="channel-menu" ref={channelMenuRef}>
            <button ref={channelMenuButtonRef} type="button" className="header-action" disabled={!channel} aria-label="频道操作" aria-haspopup="menu" aria-expanded={channelMenuOpen} onClick={() => setChannelMenuOpen((value) => !value)}>•••</button>
            {channelMenuOpen && <div className="channel-menu-popover" role="menu" aria-label="频道操作菜单" onKeyDown={moveChannelMenu}>
              {(navigation.openChannelDetails || navigation.openChannelAdministration) && <button type="button" role="menuitem" onClick={() => runChannelMenuAction(navigation.openChannelDetails || navigation.openChannelAdministration)}>频道详情</button>}
              {navigation.openAutomation && <button type="button" role="menuitem" onClick={() => runChannelMenuAction(navigation.openAutomation)}>定时动作</button>}
              {navigation.openResources && <button type="button" role="menuitem" onClick={() => runChannelMenuAction(navigation.openResources)}>高级资源工具</button>}
              {(navigation.openChannelCreate || navigation.openChannelAdministration) && <button type="button" role="menuitem" onClick={() => runChannelMenuAction(navigation.openChannelCreate || (() => navigation.openChannelAdministration('overview')))}>新建子频道</button>}
              <button type="button" role="menuitem" className="mobile-channel-menu-action" onClick={() => runChannelMenuAction(toggleFiles)}>{filesOpen ? '关闭文件' : '打开文件'}</button>
              {navigation.openTerminal && <button type="button" role="menuitem" className="mobile-channel-menu-action" disabled={!channel || terminalTransitionPending} onClick={() => runChannelMenuAction(toggleTerminal)}>{navigation.terminalVisible ? '关闭终端' : '打开终端'}</button>}
              {navigation.channelRestart && <button
                type="button"
                role="menuitem"
                data-capability-state={navigation.channelRestart.available === false ? 'unsupported' : 'available'}
                title={navigation.channelRestart.reason || '重启频道'}
                disabled={!channel || typeof navigation.channelRestart.invoke !== 'function'}
                onClick={() => runChannelMenuAction(navigation.channelRestart.invoke)}
              >重启频道</button>}
            </div>}
          </div>
        </div>
      </header>
      <nav className="channel-view-tabs" role="tablist" aria-label="频道主视图">
        {VIEW_ENTRIES.map(([view, label], index) => <button
          ref={(node) => { viewTabRefs.current[index] = node; }}
          type="button"
          role="tab"
          aria-selected={view === 'conversation' ? navigation.activeView !== 'tasks' : navigation.activeView === view}
          tabIndex={(view === 'conversation' ? navigation.activeView !== 'tasks' : navigation.activeView === view) ? 0 : -1}
          className={(view === 'conversation' ? navigation.activeView !== 'tasks' : navigation.activeView === view) ? 'active' : ''}
          key={view}
          onKeyDown={(event) => moveViewTab(event, index)}
          onClick={() => navigation.setActiveView(view === 'conversation' && filesOpen ? 'files' : view)}
        >{label}</button>)}
      </nav>
      <div className="workspace-quick-actions">
        <button ref={filesToggleRef} id="workspace-files-toggle" type="button" className={`terminal-split-toggle${filesOpen ? ' active' : ''}`} aria-pressed={filesOpen} disabled={!channel} onClick={toggleFiles}><span aria-hidden="true">▤</span>文件</button>
        {navigation.openTerminal && <button id="workspace-terminal-toggle" type="button" className={`terminal-split-toggle${navigation.terminalVisible ? ' active' : ''}`} aria-pressed={navigation.terminalVisible} disabled={!channel || terminalTransitionPending} onClick={toggleTerminal}><span aria-hidden="true">▥</span>终端</button>}
        {navigation.channelRestart && <button
          id="workspace-channel-restart"
          type="button"
          className="channel-restart-action"
          data-capability-state={navigation.channelRestart.available === false ? 'unsupported' : 'available'}
          title={navigation.channelRestart.reason || '重启频道'}
          disabled={!channel || typeof navigation.channelRestart.invoke !== 'function'}
          onClick={() => navigation.channelRestart.invoke?.()}
        ><span aria-hidden="true">⟳</span>重启频道</button>}
      </div>
      <div className="status-stack">
        {notices.error && <div className="top-error" role="alert"><span>{notices.error}</span><button type="button" onClick={notices.dismissError} aria-label="关闭错误">×</button></div>}
        {notices.channel && <div className="channel-notice" role="status"><span>{notices.channel}</span><button type="button" onClick={notices.dismissChannel} aria-label="关闭频道提示">×</button></div>}
      </div>
      <div className={[
        'dynamic-workspace',
        navigation.terminalVisible && 'terminal-split-open',
        // Files is a committed route and Terminal is an overlay.  Keep both
        // grid facts when they are open so the existing desktop two-surface
        // geometry can place files above the terminal without remounting it.
        filesOpen && 'files-split-open',
        mobileFilesComposerVisible && 'mobile-files-composer-open',
        navigation.activeView === 'tasks' && !navigation.terminalVisible && 'tasks-view-open',
      ].filter(Boolean).join(' ')}>
        <div className="dynamic-message-pane" data-surface-visible={String(messageSurfaceVisible)}>{conversationElement}</div>
        {features}
      </div>
    </main>
    {readingHistoryAvailable && <button
      type="button"
      className="reading-history-edge-tab"
      aria-label="打开最近阅读"
      title="最近阅读"
      onClick={navigation.openReadingHistory}
    >最近</button>}
    {rightPanelElement}
    {overlays}
  </SurfaceShell>;
}
