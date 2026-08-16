import React from 'react';

const STATE_LABEL = {
  open: 'OPEN',
  connecting: 'CONNECTING',
  reconnecting: 'RECONNECTING',
  closed: 'CLOSED',
};

export function ChannelList({ channels, activeChannelId, unread, wireState, me, onSelect, onLogout }) {
  return (
    <aside className="channel-rail">
      <header className="rail-header">
        <div className="brand-lockup"><span className="brand-dot" />ATOLL</div>
        <div className={`connection-state state-${wireState}`}><span />{STATE_LABEL[wireState] || wireState}</div>
      </header>
      <nav aria-label="频道">
        <p className="rail-caption">CHANNELS <span>{channels.length}</span></p>
        <div className="channel-items">
          {channels.map((channel) => (
            <button
              type="button"
              key={channel.id}
              className={channel.id === activeChannelId ? 'channel-item active' : 'channel-item'}
              onClick={() => onSelect(channel.id)}
            >
              <span className="channel-glyph">#</span>
              <span className="channel-name">{channel.qualified_name || channel.name || channel.id.slice(0, 8)}</span>
              {unread[channel.id] > 0 && <span className="unread-badge">{unread[channel.id] > 99 ? '99+' : unread[channel.id]}</span>}
            </button>
          ))}
          {!channels.length && <p className="rail-empty">等待 feed 中的频道…</p>}
        </div>
      </nav>
      <footer className="account-card">
        <span className="avatar">{(me.display_name || me.email || me.id || '?').slice(0, 1).toUpperCase()}</span>
        <span><strong>{me.display_name || me.email || '已登录用户'}</strong><small>{me.id || 'principal 未知'}</small></span>
        <button type="button" onClick={onLogout}>退出</button>
      </footer>
    </aside>
  );
}
