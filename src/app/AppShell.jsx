import React from 'react';
import { canWriteChannel, CHANNEL_ACCESS, isMemberAccess } from '../model/channel-access.js';
import { ChannelList } from '../ui/ChannelList.jsx';
import { Composer } from '../ui/Composer.jsx';
import { Timeline } from '../ui/Timeline.jsx';
import { RightPanelHost } from './RightPanelHost.jsx';

const ACCESS_MESSAGE = {
  member_stale: '连接已中断，当前显示本地缓存；恢复连接前不能发送。',
  member_unavailable: '频道暂不可用，历史记录仍可查看。',
  observer_active: '正在只读旁观此频道。',
  observer_stale: '旁观连接已中断，当前显示本地缓存。',
  discoverable: '这是空间中的可发现频道，你当前没有成员访问关系。',
  access_denied: '你的频道访问权限已被撤销，历史缓存仅供本地查看。',
  loading: '正在确认频道访问状态。',
};

export function AppShell({ session, navigation, workspace, notices, panel }) {
  const writeDisabled = session.wireState !== 'open' || !canWriteChannel(workspace.access);
  const disabledReason = session.wireState !== 'open'
    ? '等待连接…'
    : workspace.access === CHANNEL_ACCESS.discoverable || workspace.access === CHANNEL_ACCESS.accessDenied
      ? '加入频道后才能发送消息'
      : workspace.access === CHANNEL_ACCESS.memberUnavailable
        ? '频道暂不可用'
        : '当前频道不可写';

  return <div className="shell">
    <ChannelList channels={navigation.channels} activeChannelId={navigation.activeChannelId} unread={navigation.unread} wireState={session.wireState} me={session.me} onSelect={navigation.onSelect} onCreate={navigation.onCreate} onSpaceManage={navigation.onSpaceManage} onLogout={session.onLogout} />
    <main className="workspace">
      <header className="channel-header">
        <div><p className="eyebrow">频道账本</p><h1>{workspace.channel?.qualified_name || workspace.channel?.name || navigation.activeChannelId || '选择频道'}</h1></div>
        <div className="channel-header-actions">
          <span className="seq-label">SEQ {workspace.state.lastSeq}</span>
          <button type="button" className={panel.value === 'resources' ? 'manage-button active' : 'manage-button'} disabled={!workspace.channel} onClick={() => panel.toggle('resources')}>资源</button>
          <button type="button" className={panel.value === 'automation' ? 'manage-button active' : 'manage-button'} disabled={!workspace.channel} onClick={() => panel.toggle('automation')}>定时动作</button>
          <button type="button" className={panel.value === 'governance' ? 'manage-button active' : 'manage-button'} disabled={!workspace.channel} onClick={() => panel.toggle('governance')}>管理频道</button>
        </div>
      </header>
      <div className="status-stack">
        {notices.error && <div className="top-error" role="alert"><span>{notices.error}</span><button type="button" onClick={notices.dismissError} aria-label="关闭错误">×</button></div>}
        {notices.channel && <div className="channel-notice" role="status"><span>{notices.channel}</span><button type="button" onClick={notices.dismissChannel} aria-label="关闭频道提示">×</button></div>}
        {ACCESS_MESSAGE[workspace.access] && <div className={`access-banner access-${workspace.access}`} role="status">{ACCESS_MESSAGE[workspace.access]}{isMemberAccess(workspace.access) && !workspace.selfId && <span> 当前频道中的“我”仍在确认，首次发送入账后会自动识别。</span>}</div>}
      </div>
      <Timeline state={workspace.state} roster={workspace.roster} selfId={workspace.selfId} pending={workspace.pending} approvalStates={workspace.approvalStates} controlStates={workspace.controlStates} capabilityIndex={workspace.capabilityIndex} access={workspace.access} onResolve={workspace.onResolve} onRetry={workspace.onRetry} onCancel={workspace.onCancel} onTaskControl={workspace.onTaskControl} onDownloadResource={workspace.onDownloadResource} />
      <Composer channelId={navigation.activeChannelId} roster={workspace.roster} selfId={workspace.selfId} disabled={writeDisabled} disabledReason={disabledReason} onSend={workspace.onSend} attachments={workspace.attachments} onRemoveAttachment={workspace.onRemoveAttachment} onClearAttachments={workspace.onClearAttachments} />
    </main>
    <RightPanelHost {...panel.host} />
  </div>;
}
