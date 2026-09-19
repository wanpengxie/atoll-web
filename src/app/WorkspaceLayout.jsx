import React, { useState } from 'react';
import { SurfaceShell, useSurfaceTopology } from './SurfaceShell.jsx';

const VIEW_LABELS = Object.freeze({ conversation: '动态', files: '文件', tasks: '任务' });

function connectionLabel(state) {
  return ({ open: 'OPEN', connecting: 'CONNECTING', reconnecting: 'RECONNECTING', closed: 'CLOSED' })[state]
    || String(state || 'CLOSED').toUpperCase();
}

function WorkspaceRail({ session, navigation, onClose }) {
  const memberChannels = navigation.channels.filter((channel) => String(channel.access || '').startsWith('member_'));
  const otherChannels = navigation.channels.filter((channel) => !String(channel.access || '').startsWith('member_'));
  const renderRows = (rows, empty) => <div className="channel-items">
    {rows.map((channel) => <button
      type="button"
      className={channel.id === navigation.activeChannelId ? 'channel-item active' : 'channel-item'}
      key={channel.id}
      onClick={() => { navigation.select(channel.id); onClose?.(); }}
    >
      <span className="channel-glyph">#</span>
      <span className="channel-main"><span className="channel-name">{channel.qualified_name || channel.name || channel.id}</span></span>
      {navigation.unread?.[channel.id]?.related > 0 && <span className="unread-badge unread-related">{navigation.unread[channel.id].related}</span>}
    </button>)}
    {!rows.length && <p className="rail-empty">{empty}</p>}
  </div>;
  return <aside className="channel-rail">
    <header className="rail-header">
      <div className="brand-lockup"><span className="brand-dot" />ATOLL</div>
      <div className={`connection-state state-${session.wireState}`}><span aria-hidden="true" />{connectionLabel(session.wireState)}</div>
      {onClose && <button type="button" className="mobile-rail-close" onClick={onClose} aria-label="关闭频道列表">×</button>}
    </header>
    <nav aria-label="频道">
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
