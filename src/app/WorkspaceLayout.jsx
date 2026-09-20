import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SurfaceShell, useSurfaceTopology } from './SurfaceShell.jsx';
import { useModalFocus } from '../ui/primitives/useModalFocus.js';

const VIEW_LABELS = Object.freeze({ conversation: '动态', tasks: '任务' });
const VIEW_ENTRIES = Object.freeze(Object.entries(VIEW_LABELS));

function connectionLabel(state) {
  return ({ open: 'OPEN', connecting: 'CONNECTING', reconnecting: 'RECONNECTING', closed: 'CLOSED' })[state]
    || String(state || 'CLOSED').toUpperCase();
}

function activityDuration(startedAt, now) {
  const seconds = Math.max(0, Math.floor((now - Number(startedAt || now)) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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

function WorkspaceRail({ session, navigation, onClose, closeButtonRef, railRef, onSelect }) {
  const memberChannels = navigation.channels.filter((channel) => String(channel.access || '').startsWith('member_'));
  const otherChannels = navigation.channels.filter((channel) => !String(channel.access || '').startsWith('member_'));
  const activeCount = Object.values(navigation.agentActivity?.byChannel || {})
    .reduce((count, channel) => count + (channel.active?.length || 0), 0);
  const [now, setNow] = useState(Date.now);
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
      const unread = navigation.unread?.[channel.id] || {};
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
          <span className="channel-name">{channel.qualified_name || channel.name || channel.id}</span>
          {active.length > 0 && <span className="channel-agent-activity" aria-label={`${active.length} 项 Agent 正在运行`}>
            {active.slice(0, 2).map((entry) => <span className="channel-agent-timer" key={entry.requestId}><i /><b>{actorShortName(entry.agentId)}</b><time>{activityDuration(entry.startedAt, now)}</time></span>)}
            {active.length > 2 && <span className="channel-agent-more" title={`另有 ${active.length - 2} 项正在运行`}>+{active.length - 2}</span>}
          </span>}
          {settled.length > 0 && <span className="channel-agent-more" aria-label={`${settled.length} 项 Agent 已完成`}>✓ {settled.length}</span>}
        </span>
        <span className="channel-trailing">
          {label && <span className={`channel-access-label label-${channel.access}`}>{label}</span>}
          {unread.related > 0 && <span className="unread-badge unread-related" aria-label={`${unread.related} 条与我相关的未读消息`} title="与我相关的未读消息">{unread.related > 99 ? '99+' : unread.related}</span>}
          {(unread.pending || unread.unknown) && <span className="unread-total unread-pending" aria-label={unread.unknown ? '未读状态待同步' : '正在恢复未读状态'} title={unread.unknown ? '未读状态待同步' : '正在恢复未读状态'}>{unread.unknown ? '?' : '…'}</span>}
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
  const mobileChannelToggleRef = useRef(null);
  const mobileRailRef = useRef(null);
  const inactiveMobileDialogRef = useRef(null);
  const mobileRailCloseRef = useRef(null);
  const mobileDrawerReturnFocusRef = useRef(null);
  const mobileDrawerNoFocusRef = useRef({ isConnected: false });
  const channelHeadingRef = useRef(null);
  const channelMenuRef = useRef(null);
  const channelMenuButtonRef = useRef(null);
  const viewTabRefs = useRef([]);
  const pendingChannelSelectionRef = useRef(null);
  // Presentation-only handoff gate. `navigation.activeChannelId` remains the
  // sole committed selection authority; this state only disables controls
  // while that owner commits or explicitly rejects the request.
  const [pendingChannelSelection, setPendingChannelSelection] = useState(null);
  const channel = navigation.channel;
  const filesOpen = navigation.activeView === 'files';
  // The responsive CSS hides the message pane when a compact/mobile terminal
  // or file surface takes the only column. Keep that layout fact on the
  // committed shell boundary and pass it to the conversation owner; CSS alone
  // must not be mistaken for a readable/visible message surface.
  const messageSurfaceCovered = (topology === 'mobile' || topology === 'compact')
    && (navigation.terminalVisible || filesOpen);
  const messageSurfaceVisible = conversation?.surfaceVisible !== false && !messageSurfaceCovered;
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
  >
    <WorkspaceRail session={session} navigation={navigation} onSelect={selectChannel} onClose={mobileChannelsOpen ? closeMobileChannels : null} closeButtonRef={mobileRailCloseRef} railRef={mobileRailRef} />
    <main className="workspace">
      <header className="channel-header">
        <div className="channel-identity">
          <button ref={mobileChannelToggleRef} type="button" className="mobile-channel-toggle" onClick={openMobileChannels} aria-label="打开频道列表">‹</button>
          <div><p className="eyebrow">频道</p><h1 ref={channelHeadingRef} tabIndex={-1}>{channel?.qualified_name || channel?.name || '选择频道'}</h1></div>
        </div>
        <div className="channel-header-actions">
          <span className="seq-label">SEQ {Number(conversation?.state?.lastSeq || 0)}</span>
          {navigation.openRoster && <button type="button" className="header-action" disabled={!channel} onClick={navigation.openRoster}>成员</button>}
          <div className="channel-menu" ref={channelMenuRef}>
            <button ref={channelMenuButtonRef} type="button" className="header-action" disabled={!channel} aria-label="频道操作" aria-haspopup="menu" aria-expanded={channelMenuOpen} onClick={() => setChannelMenuOpen((value) => !value)}>•••</button>
            {channelMenuOpen && <div className="channel-menu-popover" role="menu" aria-label="频道操作菜单" onKeyDown={moveChannelMenu}>
              {navigation.openChannelAdministration && <button type="button" role="menuitem" onClick={() => runChannelMenuAction(navigation.openChannelAdministration)}>频道详情</button>}
              {navigation.openAutomation && <button type="button" role="menuitem" onClick={() => runChannelMenuAction(navigation.openAutomation)}>定时动作</button>}
              <button type="button" role="menuitem" className="mobile-channel-menu-action" onClick={() => runChannelMenuAction(toggleFiles)}>{filesOpen ? '关闭文件' : '打开文件'}</button>
              {navigation.openTerminal && <button type="button" role="menuitem" className="mobile-channel-menu-action" disabled={!channel || terminalTransitionPending} onClick={() => runChannelMenuAction(toggleTerminal)}>{navigation.terminalVisible ? '关闭终端' : '打开终端'}</button>}
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
        <button id="workspace-files-toggle" type="button" className={`terminal-split-toggle${filesOpen ? ' active' : ''}`} aria-pressed={filesOpen} disabled={!channel} onClick={toggleFiles}><span aria-hidden="true">▤</span>文件</button>
        {navigation.openTerminal && <button id="workspace-terminal-toggle" type="button" className={`terminal-split-toggle${navigation.terminalVisible ? ' active' : ''}`} aria-pressed={navigation.terminalVisible} disabled={!channel || terminalTransitionPending} onClick={toggleTerminal}><span aria-hidden="true">▥</span>终端</button>}
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
        navigation.activeView === 'tasks' && !navigation.terminalVisible && 'tasks-view-open',
      ].filter(Boolean).join(' ')}>
        <div className="dynamic-message-pane" data-surface-visible={String(messageSurfaceVisible)}>{conversationElement}</div>
        {features}
      </div>
    </main>
    {rightPanel}
    {overlays}
  </SurfaceShell>;
}
