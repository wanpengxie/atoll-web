import React, { useEffect, useState } from 'react';
import { isMemberAccess } from '../model/channel-access.js';
import { agentActivityDuration } from '../model/agent-activity.js';
import { ACTIVE_UPDATE_STATES, nodeUpdateLabel } from '../model/node-update.js';

const STATE_LABEL = {
  open: 'OPEN',
  connecting: 'CONNECTING',
  reconnecting: 'RECONNECTING',
  closed: 'CLOSED',
};

function agentLabel(actorId = '') {
  const parts = String(actorId).split(':');
  return parts.length >= 2 ? parts[1] : actorId;
}

export function ChannelList({ channels, activeChannelId, unread, agentActivity, wireState, me, update, onSelect, onCreate, onSearch, onActivity, onSpaceManage, onLogout, onCloseMobile }) {
  const mine = channels.filter((channel) => isMemberAccess(channel.access));
  const space = channels.filter((channel) => !isMemberAccess(channel.access));
  const [now, setNow] = useState(() => Date.now());
  const activeCount = Object.values(agentActivity?.byChannel || {}).reduce((count, channel) => count + (channel.active?.length || 0), 0);
  const updateValue = update?.value;
  const updateActive = ACTIVE_UPDATE_STATES.has(updateValue?.status);
  const showUpdate = Boolean(updateValue?.available || updateActive);
  useEffect(() => {
    if (!activeCount) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeCount]);
  const otherUnread = (channelId) => Math.max(0, Number(unread[channelId]?.total || 0) - Number(unread[channelId]?.related || 0));
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
      {rows.map((channel) => {
        const active = agentActivity?.byChannel?.[channel.id]?.active || [];
        const shown = active.slice(0, 2);
        return (
        <button
          type="button"
          key={channel.id}
          className={channel.id === activeChannelId ? 'channel-item active' : 'channel-item'}
          onClick={() => onSelect(channel.id)}
        >
          <span className="channel-glyph">#</span>
          <span className="channel-main">
            <span className="channel-name">{channel.qualified_name || channel.name || channel.id.slice(0, 8)}</span>
            {shown.length > 0 && <span className="channel-agent-activity" aria-label={`${active.length} 项 Agent 正在运行`}>
              {shown.map((entry) => <span className="channel-agent-timer" key={entry.requestId} title={`${agentLabel(entry.agentId)} 正在运行`}>
                <i aria-hidden="true" />
                <b>{agentLabel(entry.agentId)}</b>
                <time>{agentActivityDuration(entry.startedAt, now)}</time>
              </span>)}
              {active.length > shown.length && <span className="channel-agent-more" title={`另有 ${active.length - shown.length} 项正在运行`}>+{active.length - shown.length}</span>}
            </span>}
          </span>
          <span className="channel-trailing">
            {accessLabel(channel.access) && <span className={`channel-access-label label-${channel.access}`}>{accessLabel(channel.access)}</span>}
            {unread[channel.id]?.related > 0 && <span className="unread-badge unread-related" aria-label={`${unread[channel.id].related} 条与我相关的未读消息`} title="与我相关的未读消息">{unread[channel.id].related > 99 ? '99+' : unread[channel.id].related}</span>}
            {otherUnread(channel.id) > 0 && <span className="unread-total" aria-label={`${otherUnread(channel.id)} 条其他未读消息`} title="其他未读消息">{otherUnread(channel.id) > 999 ? '999+' : otherUnread(channel.id)}</span>}
          </span>
        </button>
        );
      })}
      {!rows.length && <p className="rail-empty">{empty}</p>}
    </div>
  );
  const beginUpdate = () => {
    const target = updateValue?.latest_version || '最新版';
    const confirmed = window.confirm(`升级到 ${target}？\n\n升级会重启 Atoll，并暂时中断当前连接和正在进行的工作。频道记录、任务和工作区数据会保留。`);
    if (confirmed) void update.start().catch(() => {});
  };
  return (
    <aside className="channel-rail">
      <header className="rail-header">
        <div className="brand-lockup"><span className="brand-dot" />ATOLL</div>
        <div className={`connection-state state-${wireState}`}><span aria-hidden="true" />{STATE_LABEL[wireState] || wireState}</div>
        {onCloseMobile && <button type="button" className="mobile-rail-close" onClick={onCloseMobile} aria-label="关闭频道列表">×</button>}
      </header>
      <nav aria-label="频道">
        <div className="rail-global-actions" aria-label="全局工具">
          <button type="button" onClick={onSearch} aria-label="全局搜索"><span>⌕</span> 搜索</button>
          <button type="button" onClick={onActivity} aria-label="打开活动中心"><span>◷</span> 活动</button>
        </div>
        <p className="rail-caption">我的频道 <span>{mine.length}</span></p>
        <button type="button" className="rail-create-button" onClick={onCreate} aria-label="新建频道" title="新建频道"><span>＋</span> 新建频道</button>
        {group(mine, '还没有加入频道')}
        <p className="rail-caption space-caption">空间 <span>{space.length}</span></p>
        {group(space, '没有可发现频道')}
      </nav>
      {showUpdate && <div className="node-update-action">
        <button type="button" disabled={updateActive} onClick={beginUpdate} title={updateValue?.detail || `升级到 ${updateValue?.latest_version || '最新版'}`}>
          <span aria-hidden="true">↑</span>{nodeUpdateLabel(updateValue, wireState)}
        </button>
      </div>}
      <footer className="account-card">
        <span className="avatar">{(me.display_name || me.email || me.id || '?').slice(0, 1).toUpperCase()}</span>
        <span><strong>{me.display_name || me.email || '已登录用户'}</strong><small>{me.id || 'principal 未知'}</small></span>
        <span className="account-actions"><button type="button" onClick={onSpaceManage} aria-label="空间管理" title="空间管理">空间管理</button><button type="button" onClick={onLogout} aria-label="退出" title="退出">退出</button></span>
      </footer>
    </aside>
  );
}
