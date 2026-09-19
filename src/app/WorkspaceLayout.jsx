import React, { useEffect, useState } from 'react';
import { SurfaceShell, useSurfaceTopology } from './SurfaceShell.jsx';

const VIEW_LABELS = Object.freeze({ conversation: '动态', files: '文件', tasks: '任务' });

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

function WorkspaceRail({ session, navigation, onClose }) {
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
      return <button
        type="button"
        className={channel.id === navigation.activeChannelId ? 'channel-item active' : 'channel-item'}
        key={channel.id}
        onClick={() => {
          for (const [agentId] of settled) navigation.acknowledgeAgentActivity?.(channel.id, agentId);
          navigation.select(channel.id);
          onClose?.();
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
        {navigation.unread?.[channel.id]?.related > 0 && <span className="unread-badge unread-related">{navigation.unread[channel.id].related}</span>}
      </button>;
    })}
    {!rows.length && <p className="rail-empty">{empty}</p>}
  </div>;
  return <aside className="channel-rail">
    <header className="rail-header">
      <div className="brand-lockup"><span className="brand-dot" />ATOLL</div>
      <div className={`connection-state state-${session.wireState}`}><span aria-hidden="true" />{connectionLabel(session.wireState)}</div>
      {onClose && <button type="button" className="mobile-rail-close" onClick={onClose} aria-label="关闭频道列表">×</button>}
    </header>
    <nav aria-label="频道">
      <div className="rail-global-actions">
        <button type="button" onClick={navigation.openSearch}>全局搜索</button>
        <button type="button" onClick={navigation.openSpaceAdministration}>空间管理</button>
      </div>
      <p className="rail-caption">我的频道 <span>{memberChannels.length}</span></p>
      {renderRows(memberChannels, '还没有加入频道')}
      <p className="rail-caption space-caption">空间 <span>{otherChannels.length}</span></p>
      {renderRows(otherChannels, '没有可发现频道')}
    </nav>
    <footer className="account-card">
      <span className="avatar">{String(session.me?.display_name || session.me?.id || '?').slice(0, 1).toUpperCase()}</span>
      <span><strong>{session.me?.display_name || '已登录用户'}</strong><small>{session.me?.id}</small></span>
      <span className="account-actions"><button type="button" onClick={session.onLogout}>退出</button></span>
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
  const channel = navigation.channel;
  return <SurfaceShell
    topology={topology}
    className={['shell', mobileChannelsOpen && 'mobile-channels-open', rightPanel && 'has-context'].filter(Boolean).join(' ')}
    data-workspace-view={navigation.activeView}
  >
    <WorkspaceRail session={session} navigation={navigation} onClose={mobileChannelsOpen ? () => setMobileChannelsOpen(false) : null} />
    <main className="workspace">
      <header className="channel-header">
        <div className="channel-identity">
          <button type="button" className="mobile-channel-toggle" onClick={() => setMobileChannelsOpen(true)} aria-label="打开频道列表">‹</button>
          <div><p className="eyebrow">频道</p><h1>{channel?.qualified_name || channel?.name || '选择频道'}</h1></div>
        </div>
        <div className="channel-header-actions">
          <span className="seq-label">SEQ {Number(conversation?.state?.lastSeq || 0)}</span>
          {navigation.openTerminal && <button id="workspace-terminal-toggle" type="button" className={`header-action terminal-split-toggle${navigation.terminalVisible ? ' active' : ''}`} disabled={!channel} onClick={navigation.openTerminal}>终端</button>}
          {navigation.openRoster && <button type="button" className="header-action" disabled={!channel} onClick={navigation.openRoster}>成员</button>}
          {navigation.openChannelAdministration && <button type="button" className="header-action" disabled={!channel} onClick={navigation.openChannelAdministration}>频道治理</button>}
        </div>
      </header>
      <nav className="channel-view-tabs" role="tablist" aria-label="频道主视图">
        {Object.entries(VIEW_LABELS).map(([view, label]) => <button
          type="button"
          role="tab"
          aria-selected={navigation.activeView === view}
          tabIndex={navigation.activeView === view ? 0 : -1}
          className={navigation.activeView === view ? 'active' : ''}
          key={view}
          onClick={() => navigation.setActiveView(view)}
        >{label}</button>)}
      </nav>
      <div className="status-stack">
        {notices.error && <div className="top-error" role="alert"><span>{notices.error}</span><button type="button" onClick={notices.dismissError} aria-label="关闭错误">×</button></div>}
        {notices.channel && <div className="channel-notice" role="status"><span>{notices.channel}</span><button type="button" onClick={notices.dismissChannel} aria-label="关闭频道提示">×</button></div>}
      </div>
      {navigation.terminalVisible
        ? <div className="dynamic-workspace terminal-split-open"><div className="dynamic-message-pane">{conversation?.element}</div>{features}</div>
        : navigation.activeView === 'conversation' ? conversation?.element : features}
    </main>
    {rightPanel}
    {overlays}
  </SurfaceShell>;
}
