import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PaneResizer } from '../ui/primitives/PaneResizer.jsx';
import { readPaneWidth, writePaneWidth } from '../model/pane-sizes.js';
import { canWriteChannel, isMemberAccess } from '../model/channel-access.js';
import { createChannelState } from '../model/fold.js';
import { ChannelGovernance } from '../ui/ChannelGovernance.jsx';
import { Roster } from '../ui/Roster.jsx';
import { SpaceAdministration } from '../ui/SpaceAdministration.jsx';
import { ArtifactContext } from '../ui/context/ArtifactContext.jsx';
import { WorkItemContext } from '../ui/context/WorkItemContext.jsx';
import { ChannelAutomation } from '../ui/ChannelAutomation.jsx';
import { ActivityCenter } from '../ui/ActivityCenter.jsx';
import { ChannelResources } from '../ui/ChannelResources.jsx';
import { MarkdownFileReferenceProvider } from '../ui/MarkdownContent.jsx';
import { RecentFilesContext } from '../ui/context/RecentFilesContext.jsx';

function ContextHost({ type, focusKey, onClose, children }) {
  const hostRef = useRef(null);
  const openerRef = useRef(null);
  // 右侧面板的宽度，文件预览和其他面板分开记：预览要宽，成员/治理不需要。
  const kind = type === 'artifact' ? 'artifact' : 'context';
  const [widths, setWidths] = useState(() => ({ context: readPaneWidth('context'), artifact: readPaneWidth('artifact') }));
  const width = widths[kind];
  const setWidth = useCallback((value) => setWidths((current) => (current[kind] === value ? current : { ...current, [kind]: value })), [kind]);
  const commitWidth = useCallback((value) => { setWidth(value); writePaneWidth(kind, value); }, [kind, setWidth]);
  const resetWidth = useCallback(() => { setWidth(null); writePaneWidth(kind, null); }, [kind, setWidth]);
  useLayoutEffect(() => {
    openerRef.current = document.activeElement;
    hostRef.current?.querySelector('.context-pane button[aria-label^="关闭"]')?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected && !opener.disabled) opener.focus();
    };
  }, []);
  return <div ref={hostRef} className="context-host" data-context-type={type || 'transitional'} data-context-key={focusKey || ''} style={width ? { '--context-width': `${width}px` } : undefined}>
    <button type="button" className="context-backdrop" aria-label="关闭上下文" tabIndex={-1} onClick={onClose} />
    <div className="context-pane">
      <PaneResizer kind={kind} grows="left" width={width} measure={() => hostRef.current?.querySelector('.context-pane')?.getBoundingClientRect().width} onResize={setWidth} onCommit={commitWidth} onReset={resetWidth} label="调整右侧面板宽度" />
      {children}
    </div>
  </div>;
}

export function RightPanelHost({ panel, active, directory, governance, roster, artifacts, workItems, activity }) {
  const close = panel.close;
  let content = null;
  if (panel.value === 'governance' && active.channel) {
    content = <ChannelGovernance channel={active.channel} channels={directory.channels} roster={active.roster} state={active.state} principals={governance.principals} declarations={governance.declarations} selfId={active.selfId} identityPending={isMemberAccess(active.access) && !active.selfId} disabled={!canWriteChannel(active.access)} onSubmit={governance.onSubmit} onRefresh={governance.onRefresh} onSelectActor={roster.onSelectActor} onClose={close} />;
  }
  else if (panel.value === 'space' && active.channel) {
    content = <SpaceAdministration channel={active.channel} channels={directory.channels} roster={active.roster} registrarRoster={governance.registrarRoster} state={active.state} rootState={governance.rootState || createChannelState('c0')} version={governance.version} daemons={governance.daemons} channelDevices={governance.channelDevices} disabled={active.wireState !== 'open'} onSubmit={governance.onSubmit} onRefresh={governance.onRefresh} onClose={close} />;
  }
  else if (panel.value === 'roster-focus' && active.channel) {
    content = <Roster rows={active.roster} selfId={active.selfId} identityPending={isMemberAccess(active.access) && !active.selfId} busy={roster.busy} focused onClosePanel={close} onRefresh={roster.onRefresh} selectedActor={roster.selectedActor} capability={roster.capability} disabled={!canWriteChannel(active.access)} onSelectActor={roster.onSelectActor} onCloseActor={roster.onCloseActor} onDescribe={roster.onDescribe} onInvoke={roster.onInvoke} />;
  }
  else if (panel.value === 'artifact-focus' && artifacts.selected) {
    content = <ArtifactContext key={`${artifacts.selected.channelId}:${artifacts.selected.resourceId}:${artifacts.selected.line || 0}`} artifact={artifacts.selected} authorName={artifacts.authorName} onResource={artifacts.onResource} onFileOperation={artifacts.onFileOperation} onDownload={artifacts.onDownload} onAttach={artifacts.onAttach} onSource={artifacts.onSource} canGoBack={artifacts.canGoBack} onBack={artifacts.onBack} onClose={artifacts.onClose || close} />;
  }
  else if (panel.value === 'work-item-focus' && workItems.selected) {
    content = <WorkItemContext item={workItems.selected} roster={workItems.roster} onSource={workItems.onSource} onResolve={workItems.onResolve} onOpenTurn={workItems.onOpenTurn} onRetry={workItems.onRetry} onCancelAutomation={workItems.onCancelAutomation} onClose={close} />;
  }
  else if (panel.value === 'automation' && active.channel) {
    content = <ChannelAutomation channel={active.channel} records={active.automation.records} disabled={active.automation.disabled} onAfter={active.automation.onAfter} onCancel={active.automation.onCancel} onClose={close} />;
  }
  else if (panel.value === 'resources' && active.channel) {
    content = <ChannelResources channel={active.channel} devices={governance.channelDevices} disabled={active.wireState !== 'open' || !canWriteChannel(active.access)} attachDisabled={artifacts.attachDisabled} attachDisabledReason={artifacts.attachDisabledReason} onResource={artifacts.onResource} onFileOperation={artifacts.onFileOperation} onAttach={artifacts.onAttach} onClose={close} />;
  }
  else if (panel.value === 'activity') {
    content = <ActivityCenter activities={activity.activities} operations={activity.operations} onOpen={activity.onOpen} onClose={close} />;
  }
  else if (panel.value === 'reading-history') {
    content = <RecentFilesContext files={artifacts.recentFiles} onOpen={artifacts.onPreview} onClose={close} />;
  }
  if (!content) return null;
  const contextType = panel.value === 'artifact-focus' ? 'artifact' : panel.focus?.type;
  // 面板里的正文和消息区读的是同一种 Markdown,里面的绝对路径链接也该是同一种东西:
  // 在 Atoll 里打开那个文件。少了这一层,MarkdownContent 找不到 provider,就退回成
  // 普通 <a target="_blank">——点下去浏览器会拿当前站点去访问 /home/... 这条路径,
  // 跳到一个本站根本不提供的地址。预览里的链接"点不开"就是这么来的。
  return <ContextHost type={contextType} focusKey={panel.focus?.key} onClose={close}>
    <MarkdownFileReferenceProvider onOpen={artifacts.onFileReference}>{content}</MarkdownFileReferenceProvider>
  </ContextHost>;
}
