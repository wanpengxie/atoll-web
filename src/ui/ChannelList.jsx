import React from 'react';
import { isMemberAccess } from '../model/channel-access.js';

const STATE_LABEL = {
  open: 'OPEN',
  connecting: 'CONNECTING',
  reconnecting: 'RECONNECTING',
  closed: 'CLOSED',
};

export function ChannelList({ channels, activeChannelId, unread, wireState, me, onSelect, onCreate, onSpaceManage, onLogout }) {
  const mine = channels.filter((channel) => isMemberAccess(channel.access));
  const space = channels.filter((channel) => !isMemberAccess(channel.access));
  const accessLabel = (access) => ({
    member_stale: '离线缓存',
    member_unavailable: '暂不可用',
    observer_active: '只读旁观',
    observer_stale: '旁观中断',
    discoverable: '可发现',
    access_denied: '无权访问',
    loading: '确认中',
  }[access] || '');
  const group = (rows, empty) => (
    <div className="channel-items">
      {rows.map((channel) => (
        <button
          type="button"
          key={channel.id}
          className={channel.id === activeChannelId ? 'channel-item active' : 'channel-item'}
          onClick={() => onSelect(channel.id)}
        >
          <span className="channel-glyph">#</span>
          <span className="channel-name">{channel.qualified_name || channel.name || channel.id.slice(0, 8)}</span>
          {accessLabel(channel.access) && <span className={`channel-access-label label-${channel.access}`}>{accessLabel(channel.access)}</span>}
          {unread[channel.id] > 0 && <span className="unread-badge">{unread[channel.id] > 99 ? '99+' : unread[channel.id]}</span>}
        </button>
      ))}
      {!rows.length && <p className="rail-empty">{empty}</p>}
    </div>
  );
  return (
    <aside className="channel-rail">
      <header className="rail-header">
        <div className="brand-lockup"><span className="brand-dot" />ATOLL</div>
        <div className={`connection-state state-${wireState}`}><span />{STATE_LABEL[wireState] || wireState}</div>
      </header>
      <nav aria-label="频道">
        <p className="rail-caption">我的频道 <span>{mine.length}</span></p>
        <button type="button" className="rail-create-button" onClick={onCreate} aria-label="新建频道" title="新建频道"><span>＋</span> 新建频道</button>
        {group(mine, '还没有加入频道')}
        <p className="rail-caption space-caption">空间 <span>{space.length}</span></p>
        {group(space, '没有可发现频道')}
      </nav>
      <footer className="account-card">
        <span className="avatar">{(me.display_name || me.email || me.id || '?').slice(0, 1).toUpperCase()}</span>
        <span><strong>{me.display_name || me.email || '已登录用户'}</strong><small>{me.id || 'principal 未知'}</small></span>
        <span className="account-actions"><button type="button" onClick={onSpaceManage} aria-label="空间管理" title="空间管理">空间管理</button><button type="button" onClick={onLogout} aria-label="退出" title="退出">退出</button></span>
      </footer>
    </aside>
  );
}
