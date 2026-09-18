import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { canViewChannelContent, canWriteChannel, CHANNEL_ACCESS, isMemberAccess } from '../model/channel-access.js';
import { ChannelList } from '../ui/ChannelList.jsx';
import { Timeline } from '../ui/Timeline.jsx';
import { activeAgentTurn } from '../model/agent-control.js';
import { adjacentChannelId, channelShortcutDirection, channelShortcutIndex } from '../model/channel-navigation.js';
import { PaneResizer } from '../ui/primitives/PaneResizer.jsx';
import { readPaneWidth, writePaneWidth } from '../model/pane-sizes.js';
import { createViewSessionStore } from '../model/view-session.js';
import { SurfaceShell, useSurfaceTopology } from './SurfaceShell.jsx';
import { ConversationSurface } from '../ui/conversation/ConversationSurface.jsx';

// 首屏可读内容只需要频道与消息。输入框、文件管理、终端、任务和右侧详情以前虽
// 不可见，仍全部进入入口 chunk；移动端要先下载/解析完才会执行 session 请求。
// 这些边界都有明确的用户动作，正好作为按需加载点。
const ArtifactsView = lazy(() => import('../ui/ArtifactsView.jsx').then((module) => ({ default: module.ArtifactsView })));
const Composer = lazy(() => import('../ui/Composer.jsx').then((module) => ({ default: module.Composer })));
const TerminalView = lazy(() => import('../ui/TerminalView.jsx').then((module) => ({ default: module.TerminalView })));
const TasksView = lazy(() => import('../ui/TasksView.jsx').then((module) => ({ default: module.TasksView })));
const RightPanelHost = lazy(() => import('./RightPanelHost.jsx').then((module) => ({ default: module.RightPanelHost })));

// 主视图 tab 只剩两个。文件在桌面是与动态并排的工作面，在窄屏是互斥的完整
// Surface；artifacts 仍是合法路由，因此 URL、ui.navigate 和按频道记忆不变。
const WORKSPACE_TABS = ['dynamic', 'tasks'];

const ACCESS_MESSAGE = {
  member_stale: '正在同步频道状态。',
  member_unavailable: '频道暂不可用，历史记录仍可查看。',
  observer_active: '正在只读旁观此频道。',
  observer_stale: '旁观连接已中断，当前显示本地缓存。',
  discoverable: '这是空间中的可发现频道，你当前没有成员访问关系。',
  access_denied: '你的频道访问权限已被撤销，缓存内容已隐藏。重新获得访问权限后才能查看。',
  loading: '正在确认频道访问状态。',
};

export function AppShell({ session, navigation, workspace, notices, panel }) {
  const shellTopology = useSurfaceTopology();
  const mobileShell = shellTopology === 'mobile';
  const singleSurfaceShell = shellTopology !== 'desktop';
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false);
  const [pendingChannelSelection, setPendingChannelSelection] = useState(null);
  const [composerEdit, setComposerEdit] = useState(null);
  const [replyTargets, setReplyTargets] = useState({});
  const viewSessionsRef = useRef(null);
  const viewSessionPrincipal = String(session.me?.id || '');
  if (!viewSessionsRef.current || viewSessionsRef.current.principal !== viewSessionPrincipal) {
    viewSessionsRef.current = {
      principal: viewSessionPrincipal,
      store: createViewSessionStore({ principalID: viewSessionPrincipal }),
    };
  }
  // Feed renders replace the workspace's inline callbacks, but only a
  // committed channel/principal may become the target of the already-painted
  // Composer DOM. A ref shared by every channel used to leak callbacks from a
  // suspended/aborted B render into the still-committed A editor. Give each
  // owner a distinct stable port; its targets are published below in layout
  // commit, never while React is merely evaluating a candidate render.
  const composerOwnerKey = `${String(session.me?.id || '')}\u0000${String(navigation.activeChannelId || '')}\u0000${String(workspace.view || '')}`;
  const composerPort = useMemo(() => {
    const targetsRef = { current: Object.freeze({ ownerKey: '' }) };
    const call = (name) => (...args) => {
      const targets = targetsRef.current;
      if (targets.ownerKey !== composerOwnerKey) return undefined;
      return targets[name]?.(...args);
    };
    return {
      ownerKey: composerOwnerKey,
      targetsRef,
      actions: Object.freeze({
      onDraftChange: call('onDraftChange'),
      onSend: call('onSend'),
      onRetry: call('onRetry'),
      onPreviewAttachment: call('onPreviewAttachment'),
      onRemoveAttachment: call('onRemoveAttachment'),
      onClearAttachments: call('onClearAttachments'),
      onUploadAttachments: call('onUploadAttachments'),
      onOpenChannelFiles: call('onOpenChannelFiles'),
      onCancelReply: call('onCancelReply'),
      onReplySent: call('onReplySent'),
      }),
    };
  }, [composerOwnerKey]);
  const composerActions = composerPort.actions;
  const channelMenuRef = useRef(null);
  const channelMenuButtonRef = useRef(null);
  const channelHeadingRef = useRef(null);
  const channelSelectionSerialRef = useRef(0);
  const filesButtonRef = useRef(null);
  const terminalButtonRef = useRef(null);
  const viewTabRefs = useRef([]);
  // 终端工作面是**按频道**记的：键在 = 这个频道开过终端，值 = 此刻是否展开。
  //
  // 恒不为没用过终端的人起 shell（没开过的频道不在这张表里），开过之后就恒不
  // 卸载——收起分屏只是隐藏，切走频道也只是隐藏。上一版用的是一个布尔加一个
  // 单槽 ref，切频道时被清空：于是切走就把 TerminalView 卸了（回来是黑屏，
  // 因为实时流恒不回放），布局也恒不保留。两个频道各开一个终端时最明显——
  // 单槽装不下两个，来回切等于把两边轮流拆掉。
  const [terminalSplits, setTerminalSplits] = useState({});
  const terminalOpen = Boolean(terminalSplits[navigation.activeChannelId]);
  // 键在 = 这个频道开过：收起工作面恒只是隐藏（恒不断线），切走频道才卸载。
  const terminalEverOpened = navigation.activeChannelId in terminalSplits;
  // 文件区跟终端同形，但开合态**不另立一份**：它就是路由的 artifacts 视图。
  // 这样它免费拿到三件已经建好的事——URL 里带得走、刷新后还在、按频道记住
  // （App 的 workspaceViewsRef），以及 agent 的 ui.navigate 恒不用改。
  // 以前 artifacts 是整屏替换动态区的一个 tab，人去查个文件就看不见对话了。
  // 左侧频道栏的宽度：读者拖过就记住（localStorage），没拖过用 CSS 默认。
  const [railWidth, setRailWidth] = useState(() => readPaneWidth('rail'));
  const railRef = useRef(null);
  const commitRailWidth = useCallback((value) => { setRailWidth(value); writePaneWidth('rail', value); }, []);
  const resetRailWidth = useCallback(() => { setRailWidth(null); writePaneWidth('rail', null); }, []);
  const filesOpen = workspace.view === 'artifacts';
  const dynamicVisible = workspace.view === 'dynamic' || filesOpen;
  const [filesEverOpened, setFilesEverOpened] = useState(() => (filesOpen ? { [navigation.activeChannelId]: true } : {}));
  useEffect(() => {
    if (!filesOpen) return;
    setFilesEverOpened((current) => (current[navigation.activeChannelId] ? current : { ...current, [navigation.activeChannelId]: true }));
  }, [filesOpen, navigation.activeChannelId]);
  // 上次停在哪一台设备的哪个目录，按频道记。放在 AppShell 是因为它必须活得比
  // ArtifactsView 长——那棵树按频道 key 重挂，一换频道就没了。
  const fileLocationsRef = useRef(new Map());
  const rememberFileLocation = useCallback((location) => {
    fileLocationsRef.current.set(navigation.activeChannelId, location);
  }, [navigation.activeChannelId]);
  // 文件工作面开着没开着，也按频道记一份。路由只有一个 view 字段，去了「任务」就把
  // 「动态 + 文件」这件事挤掉了——不记的话，从任务点回动态就没了，
  // 而人并没有关过它。
  const filesOpenRef = useRef(new Map());
  useEffect(() => {
    if (!dynamicVisible) return;
    filesOpenRef.current.set(navigation.activeChannelId, filesOpen);
  }, [dynamicVisible, filesOpen, navigation.activeChannelId]);
  const dynamicTabView = () => (filesOpenRef.current.get(navigation.activeChannelId) ? 'artifacts' : 'dynamic');
  const writeDisabled = session.wireState !== 'open' || !canWriteChannel(workspace.access);
  // Draft ownership is a local authorization fact, not a transport fact. A
  // previously confirmed member may keep editing and atomically hand text to
  // the durable outbox while disconnected; reconnect is only permission to
  // transmit. Unknown identities, observers and revoked members never cross
  // the durable-accept seam.
  const knownDraftOwner = Boolean(session.me?.id && workspace.channel && isMemberAccess(workspace.access));
  const canEditDraft = knownDraftOwner;
  const canDurablyAccept = knownDraftOwner;
  const canTransmit = knownDraftOwner && session.wireState === 'open' && canWriteChannel(workspace.access);
  const contentVisible = canViewChannelContent(workspace.access);
  const messageSurfaceVisible = contentVisible
    && dynamicVisible
    && !(singleSurfaceShell && (filesOpen || terminalOpen));
  // Within one commit the old button and toggleTerminal already used the same
  // access condition. The gap is between commits: a channel click can return
  // while the old DOM and its handler still identify the previous channel.
  // Publish that handoff locally so the next input cannot be consumed by the
  // previous channel before the parent workspace commits the target identity.
  const terminalChannelReady = Boolean(
    workspace.channel
    && workspace.channel.id === navigation.activeChannelId,
  );
  const terminalContentReady = terminalChannelReady && contentVisible;
  // An already-open split must remain closable if access disappears. Pending
  // channel handoff still wins: neither open nor close may mutate the channel
  // whose old DOM happens to remain committed for that brief interval.
  const terminalActionReady = !pendingChannelSelection
    && terminalChannelReady
    && (terminalOpen || terminalContentReady);
  const selectShellChannel = useCallback((channelId) => {
    // Always replace the pending fact, including a rapid selection back to the
    // currently committed channel. That reverse selection is itself the latest
    // intent and must supersede an older target still waiting to commit.
    setPendingChannelSelection({
      id: channelSelectionSerialRef.current += 1,
      target: channelId,
      origin: navigation.activeChannelId,
      focusOrigin: document.activeElement,
    });
    navigation.onSelect(channelId);
  }, [navigation.activeChannelId, navigation.onSelect]);
  useEffect(() => {
    if (!pendingChannelSelection) return;
    const { target, origin, focusOrigin, departedOrigin = false } = pendingChannelSelection;
    if (navigation.activeChannelId !== origin && !departedOrigin) {
      // The directory publishes a requested id before it can discover that the
      // target is gone and fall back. Remember that committed departure so a
      // later return to origin is distinguishable from a parent that simply has
      // not committed the request yet.
      setPendingChannelSelection((current) => (
        current === pendingChannelSelection ? { ...current, departedOrigin: true } : current
      ));
    }
    if (workspace.channel?.id !== navigation.activeChannelId) return;
    // Still on the commit from which this selection was issued: wait. A target
    // commit completes normally; a third committed identity means browser
    // navigation, directory fallback, or another owner superseded the target.
    if (
      navigation.activeChannelId === origin
      && navigation.activeChannelId !== target
      && !departedOrigin
    ) return;
    const selectedCommit = navigation.activeChannelId === target;
    const rejectedTargetFallback = navigation.activeChannelId === origin
      && target !== origin
      && departedOrigin;
    // Focus belongs to the latest user navigation, not to feed/access rerenders.
    // If the reader has deliberately moved focus since clicking the channel,
    // their newer input wins. preventScroll keeps the restored reading position.
    if (selectedCommit || rejectedTargetFallback) {
      const activeElement = document.activeElement;
      if (!activeElement || activeElement === document.body || activeElement === focusOrigin) {
        channelHeadingRef.current?.focus({ preventScroll: true });
      }
    }
    // Access may still be loading after the identity commit. Clearing the
    // transition here is safe because terminalContentReady independently owns
    // the authorization/readability gate for opening and mounting content.
    setPendingChannelSelection(null);
  }, [pendingChannelSelection, navigation.activeChannelId, workspace.channel?.id]);
  // AppShell 会跟随每批 live feed 重渲。activeAgentTurn 原先每次都复制、过滤、
  // 排序整个 turns Map；同一 processing 阶段追加正文并不会改变“当前运行任务”。
  const runningAgentTurn = useMemo(
    () => activeAgentTurn(workspace.state, workspace.roster, workspace.selfId),
    [workspace.state, workspace.state?._timelineControlVersion, workspace.roster, workspace.selfId],
  );
  const disabledReason = !session.me?.id
    ? '当前身份尚未建立'
    : workspace.access === CHANNEL_ACCESS.discoverable || workspace.access === CHANNEL_ACCESS.accessDenied
      ? '加入频道后才能发送消息'
      : [CHANNEL_ACCESS.observerActive, CHANNEL_ACCESS.observerStale].includes(workspace.access)
        ? '当前频道为只读旁观'
        : workspace.access === CHANNEL_ACCESS.loading
          ? '正在确认频道访问状态'
        : '当前频道不可写';

  useEffect(() => {
    if (!channelMenuOpen) return undefined;
    const close = (event) => { if (!channelMenuRef.current?.contains(event.target)) setChannelMenuOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setChannelMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [channelMenuOpen]);

  useEffect(() => {
    if (!mobileChannelsOpen) return undefined;
    const focusFrame = requestAnimationFrame(() => document.querySelector('.mobile-rail-close')?.focus());
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileChannelsOpen(false);
        requestAnimationFrame(() => document.querySelector('.mobile-channel-toggle')?.focus());
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', escape);
    };
  }, [mobileChannelsOpen]);

  useEffect(() => {
    const switchByKey = (event) => {
      const memberChannels = navigation.channels.filter((channel) => isMemberAccess(channel.access));
      const directIndex = channelShortcutIndex(event);
      const direction = channelShortcutDirection(event);
      if (directIndex < 0 && !direction) return;
      const channelId = directIndex >= 0
        ? memberChannels[directIndex]?.id
        : adjacentChannelId(memberChannels, navigation.activeChannelId, direction);
      if (!channelId) return;
      event.preventDefault();
      selectShellChannel(channelId);
    };
    document.addEventListener('keydown', switchByKey);
    return () => document.removeEventListener('keydown', switchByKey);
  }, [navigation.activeChannelId, navigation.channels, selectShellChannel]);

  // 破窗恢复。它会打断频道里正在跑的一切,所以先问一句;确认后就是一条普通控制
  // 请求,结果落在时间线上,这里只负责别让人连点两次。
  const [restarting, setRestarting] = useState(false);
  async function restartChannel() {
    if (!workspace.channel || restarting) return;
    const name = workspace.channel.qualified_name || workspace.channel.name || workspace.channel.id;
    if (!window.confirm(`重启频道「${name}」内的全部 agent 与 tool?\n\n正在进行的工作会被打断。频道、账本、成员和文件都不会被删除。`)) return;
    setRestarting(true);
    try {
      await workspace.onRestartChannel?.();
    } finally {
      setRestarting(false);
    }
  }

  function toggleFiles() {
    if (!workspace.channel || !contentVisible) return;
    if (!filesOpen && singleSurfaceShell && terminalOpen) {
      const channelId = navigation.activeChannelId;
      setTerminalSplits((current) => ({ ...current, [channelId]: false }));
    }
    workspace.onViewChange(filesOpen ? 'dynamic' : 'artifacts');
    if (filesOpen) requestAnimationFrame(() => (mobileShell ? channelMenuButtonRef.current : filesButtonRef.current)?.focus());
  }

  function toggleTerminal() {
    if (!terminalActionReady) return;
    if (!terminalOpen && !terminalContentReady) return;
    const channelId = navigation.activeChannelId;
    // 从任务那一格开终端，要先回到动态——终端是挂在动态那块布局里的。但
    // 桌面 artifacts 已经**就是**动态布局（动态 + 文件），把它也当成"不在动态"
    // 会顺手把文件关掉。窄屏则是互斥 Surface，打开终端必须显式切回动态。
    if (!terminalSplits[channelId] && (!dynamicVisible || (singleSurfaceShell && filesOpen))) workspace.onViewChange('dynamic');
    setTerminalSplits((current) => ({ ...current, [channelId]: !current[channelId] }));
    if (terminalSplits[channelId]) requestAnimationFrame(() => (mobileShell ? channelMenuButtonRef.current : terminalButtonRef.current)?.focus());
  }

  // Resizing a desktop two-pane workspace into a narrow topology must also
  // normalize the interaction state, not merely hide one pane with CSS. The
  // terminal is the most recently explicit working surface in this ambiguous
  // topology, so keep it and close the files route.
  useEffect(() => {
    if (singleSurfaceShell && filesOpen && terminalOpen) workspace.onViewChange('dynamic');
  }, [singleSurfaceShell, filesOpen, terminalOpen, workspace.onViewChange]);

  useEffect(() => {
    const toggleByKey = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== 'F12') return;
      if (!terminalActionReady) return;
      event.preventDefault();
      toggleTerminal();
    };
    // Capture before xterm's own keyboard handler: after opening, focus moves
    // into its textarea and xterm legitimately stops many function keys.
    document.addEventListener('keydown', toggleByKey, true);
    return () => document.removeEventListener('keydown', toggleByKey, true);
  }, [workspace.channel, workspace.view, dynamicVisible, terminalActionReady, navigation.activeChannelId]);

  useEffect(() => setComposerEdit(null), [navigation.activeChannelId]);
  useLayoutEffect(() => {
    workspace.onComposerEditChange?.(composerEdit);
    return () => workspace.onComposerEditChange?.(null);
  }, [composerEdit, workspace.onComposerEditChange]);
  useEffect(() => {
    if (!composerEdit || !navigation.activeChannelId) return;
    setReplyTargets((current) => ({ ...current, [navigation.activeChannelId]: null }));
  }, [Boolean(composerEdit), navigation.activeChannelId]);

  const replyTarget = Object.prototype.hasOwnProperty.call(replyTargets, navigation.activeChannelId)
    ? replyTargets[navigation.activeChannelId]
    : workspace.draft?.replyTarget || null;
  function beginReply(target) {
    if (!target || composerEdit || !navigation.activeChannelId) return;
    setReplyTargets((current) => ({ ...current, [navigation.activeChannelId]: target }));
  }
  function clearReply() {
    if (!navigation.activeChannelId) return;
    setReplyTargets((current) => ({ ...current, [navigation.activeChannelId]: null }));
  }

  const composerActionTargets = {
    onDraftChange: workspace.onDraftChange,
    onSend: workspace.onSend,
    onRetry: workspace.onRetry,
    onPreviewAttachment: workspace.onPreviewAttachment,
    onRemoveAttachment: workspace.onRemoveAttachment,
    onClearAttachments: workspace.onClearAttachments,
    onUploadAttachments: (files) => (composerEdit
      ? Promise.reject(new TypeError('编辑已有消息时不能上传普通草稿附件；请先完成或取消编辑'))
      : workspace.onUploadAttachments?.(files)),
    onOpenChannelFiles: () => workspace.onOpenChannelFiles?.({ editing: Boolean(composerEdit) }),
    onCancelReply: clearReply,
    onReplySent: clearReply,
  };
  const fileAttachDisabled = writeDisabled || Boolean(composerEdit);
  const fileAttachDisabledReason = composerEdit
    ? '编辑已有消息时不能附加频道文件；请先完成或取消编辑'
    : disabledReason;
  const attachFileToDraft = (attachment, channelId = navigation.activeChannelId) => {
    if (composerEdit) return Promise.reject(new TypeError(fileAttachDisabledReason));
    return workspace.resources.onAttach?.(attachment, channelId);
  };
  useLayoutEffect(() => {
    const committed = Object.freeze({ ownerKey: composerPort.ownerKey, ...composerActionTargets });
    composerPort.targetsRef.current = committed;
    return () => {
      // A late idle callback from an unmounted Composer is a no-op. It must
      // neither write its former owner nor fall through to the next channel's
      // targets.
      if (composerPort.targetsRef.current === committed) {
        composerPort.targetsRef.current = Object.freeze({ ownerKey: '' });
      }
    };
  });

  function moveViewTab(event, index) {
    const views = WORKSPACE_TABS;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + views.length) % views.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;
    event.preventDefault();
    workspace.onViewChange(views[next] === 'dynamic' ? dynamicTabView() : views[next]);
    requestAnimationFrame(() => document.getElementById(`workspace-tab-${views[next]}`)?.focus());
  }

  function closeMobileChannels() {
    setMobileChannelsOpen(false);
    requestAnimationFrame(() => document.querySelector('.mobile-channel-toggle')?.focus());
  }

  function onChannelMenuKeyDown(event) {
    const items = [...(channelMenuRef.current?.querySelectorAll('[role="menuitem"]') || [])].filter((item) => item.offsetParent !== null);
    if (event.key === 'Escape') {
      event.preventDefault();
      setChannelMenuOpen(false);
      channelMenuButtonRef.current?.focus();
    } else if (items.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1 + items.length) % items.length : (current - 1 + items.length) % items.length;
      items[next].focus();
    }
  }

  const shellClass = ['shell', panel.value && 'has-context', mobileChannelsOpen && 'mobile-channels-open'].filter(Boolean).join(' ');
  const composer = <Suspense fallback={<section className="composer-wrap composer-loading" role="status"><div className="composer-surface">正在加载输入框…</div></section>}><Composer key={navigation.activeChannelId} channelId={navigation.activeChannelId} roster={workspace.roster} selfId={workspace.selfId} pending={workspace.pending} draft={workspace.draft} draftRevision={workspace.draftRevision} onDraftChange={composerActions.onDraftChange} disabled={!canEditDraft} disabledReason={disabledReason} canEditDraft={canEditDraft} canDurablyAccept={canDurablyAccept} canTransmit={canTransmit} onSend={composerActions.onSend} onRetry={composerActions.onRetry} attachments={workspace.attachments} onPreviewAttachment={composerActions.onPreviewAttachment} onRemoveAttachment={composerActions.onRemoveAttachment} onClearAttachments={composerActions.onClearAttachments} onUploadAttachments={composerActions.onUploadAttachments} onOpenChannelFiles={composerActions.onOpenChannelFiles} agentSelection={workspace.agentSelection} editMode={composerEdit} replyTarget={replyTarget} onCancelReply={composerActions.onCancelReply} onReplySent={composerActions.onReplySent} /></Suspense>;
  return <SurfaceShell topology={shellTopology} ref={railRef} className={shellClass} data-workspace-view={workspace.view} style={railWidth ? { '--rail-width': `${railWidth}px` } : undefined}>
    <ChannelList channels={navigation.channels} activeChannelId={navigation.activeChannelId} unread={navigation.unread} agentActivity={navigation.agentActivity} wireState={session.wireState} me={session.me} update={session.update} onSelect={(channelId) => { selectShellChannel(channelId); setMobileChannelsOpen(false); }} onCreate={() => { setMobileChannelsOpen(false); navigation.onCreate(); }} onSearch={() => { setMobileChannelsOpen(false); navigation.onSearch(); }} onActivity={() => { setMobileChannelsOpen(false); navigation.onActivity(); }} onSpaceManage={() => { setMobileChannelsOpen(false); navigation.onSpaceManage(); }} onLogout={session.onLogout} onCloseMobile={mobileChannelsOpen ? closeMobileChannels : undefined} />
    {shellTopology === 'desktop' && <PaneResizer kind="rail" grows="right" width={railWidth} measure={() => railRef.current?.querySelector('.channel-rail')?.getBoundingClientRect().width} onResize={setRailWidth} onCommit={commitRailWidth} onReset={resetRailWidth} label="调整频道栏宽度" />}
    <main className="workspace">
      <header className="channel-header">
        <div className="channel-identity"><button type="button" className="mobile-channel-toggle" onClick={() => setMobileChannelsOpen(true)} aria-label="打开频道列表">‹</button><div><p className="eyebrow">频道</p><h1 ref={channelHeadingRef} tabIndex={-1}>{workspace.channel?.qualified_name || workspace.channel?.name || navigation.activeChannelId || '选择频道'}</h1></div></div>
        <div className="channel-header-actions">
          <span className="seq-label">SEQ {workspace.state.lastSeq}</span>
          {workspace.mockAdvance?.available && <button type="button" className="header-action mock-advance-action" disabled={workspace.mockAdvance.busy || !runningAgentTurn} onClick={workspace.mockAdvance.onAdvance} title={runningAgentTurn ? '追加下一条 Mock 计算事实' : '当前没有正在计算的任务'}>{workspace.mockAdvance.busy ? '推进中…' : '推进计算'}</button>}
          <button type="button" className={panel.value === 'governance' ? 'header-action active' : 'header-action'} disabled={!workspace.channel} onClick={() => panel.open('governance', { type: 'channel', key: workspace.channel.id })} aria-label="成员">成员</button>
          <div className="channel-menu" ref={channelMenuRef}>
            <button ref={channelMenuButtonRef} type="button" className={panel.value === 'governance' ? 'header-action active' : 'header-action'} disabled={!workspace.channel} aria-label="频道操作" aria-haspopup="menu" aria-expanded={channelMenuOpen} onClick={() => setChannelMenuOpen((value) => !value)}>•••</button>
            {channelMenuOpen && <div className="channel-menu-popover" role="menu" aria-label="频道操作菜单" onKeyDown={onChannelMenuKeyDown}>
              <button type="button" role="menuitem" onClick={() => { setChannelMenuOpen(false); panel.open('governance', { type: 'channel', key: workspace.channel.id }); }}>频道详情</button>
              <button type="button" role="menuitem" onClick={() => { setChannelMenuOpen(false); panel.open('resources', { type: 'channel_resources', key: workspace.channel.id }); }}>高级资源工具</button>
              <button type="button" role="menuitem" onClick={() => { setChannelMenuOpen(false); navigation.onCreate(); }}>新建子频道</button>
              <button type="button" role="menuitem" className="mobile-channel-menu-action" disabled={!workspace.channel || !contentVisible} onClick={() => { setChannelMenuOpen(false); toggleFiles(); }}>{filesOpen ? '关闭文件' : '打开文件'}</button>
              <button type="button" role="menuitem" className="mobile-channel-menu-action" disabled={!terminalActionReady} onClick={() => { setChannelMenuOpen(false); toggleTerminal(); }}>{terminalOpen ? '关闭终端' : '打开终端'}</button>
              <button type="button" role="menuitem" className="mobile-channel-menu-action" disabled={!workspace.channel || writeDisabled || restarting} onClick={() => { setChannelMenuOpen(false); restartChannel(); }}>{restarting ? '重启中…' : '重启频道'}</button>
            </div>}
          </div>
        </div>
      </header>
      <nav className="channel-view-tabs" aria-label="频道主视图" role="tablist">
        {WORKSPACE_TABS.map((view, index) => {
          // 文件不再是一个 tab，但它仍是一个路由视图（桌面为动态 + 文件，窄屏为文件 Surface）。
          // 所以在动态那一格上，文件开着时也算选中——否则地址栏在 artifacts、
          // 屏幕上却没有任何一个 tab 是亮的。
          const selected = workspace.view === view || (view === 'dynamic' && filesOpen);
          return <button key={view} ref={(node) => { viewTabRefs.current[index] = node; }} type="button" role="tab" id={`workspace-tab-${view}`} aria-controls={`workspace-panel-${view}`} aria-selected={selected} tabIndex={selected ? 0 : -1} className={selected ? 'active' : ''} onKeyDown={(event) => moveViewTab(event, index)} onClick={() => workspace.onViewChange(view === 'dynamic' ? dynamicTabView() : view)}>{view === 'dynamic' ? '动态' : '任务'}</button>;
        })}
      </nav>
      <div className="workspace-quick-actions">
        <button id="workspace-channel-restart" type="button" className="channel-restart-action" disabled={!workspace.channel || writeDisabled || restarting} title="重启本频道内全部成员(agent 与 tool);不会删除频道、账本或文件" onClick={restartChannel}><span aria-hidden="true">⟳</span>{restarting ? '重启中…' : '重启频道'}</button>
        <button ref={filesButtonRef} id="workspace-files-toggle" type="button" className={`terminal-split-toggle${filesOpen ? ' active' : ''}`} aria-pressed={filesOpen} aria-controls="workspace-panel-artifacts" disabled={!workspace.channel || !contentVisible} title={singleSurfaceShell ? '打开或关闭文件' : '切换文件分屏'} onClick={toggleFiles}><span aria-hidden="true">▤</span>文件</button>
        <button ref={terminalButtonRef} id="workspace-terminal-toggle" type="button" className={`terminal-split-toggle${terminalOpen ? ' active' : ''}`} aria-pressed={terminalOpen} aria-controls="workspace-panel-terminal" disabled={!terminalActionReady} title={singleSurfaceShell ? '打开或关闭终端（Ctrl+F12）' : '切换终端分屏（Ctrl+F12）'} onClick={toggleTerminal}><span aria-hidden="true">▥</span>终端<kbd>Ctrl F12</kbd></button>
      </div>
      <div className="status-stack">
        {notices.error && <div className="top-error" role="alert"><span>{notices.error}</span><button type="button" onClick={notices.dismissError} aria-label="关闭错误">×</button></div>}
        {notices.channel && <div className="channel-notice" role="status"><span>{notices.channel}</span><button type="button" onClick={notices.dismissChannel} aria-label="关闭频道提示">×</button></div>}
        {ACCESS_MESSAGE[workspace.access] && <div className={`access-banner access-${workspace.access}`} role="status">{ACCESS_MESSAGE[workspace.access]}{isMemberAccess(workspace.access) && !workspace.selfId && <span> 当前频道中的“我”仍在确认，首次发送入账后会自动识别。</span>}</div>}
      </div>
      {dynamicVisible && <div className={`dynamic-workspace${terminalOpen ? ' terminal-split-open' : ''}${filesOpen ? ' files-split-open' : ''}`}>
        {/* 频道是阅读会话和虚拟高度缓存的边界。按频道 key 重挂物理列表，再由
            ViewSession 用语义 row anchor 恢复；绝不把上一频道的 DOM 测量解释成
            当前频道的几何。Composer 同样按频道隔离草稿编辑器。 */}
        <div className="dynamic-message-pane">
          {contentVisible ? <Timeline key={`timeline-${navigation.activeChannelId}`} composer={composer} viewSessions={viewSessionsRef.current.store} state={workspace.state} history={workspace.history} roster={workspace.roster} waitingRosterAuthority={workspace.waitingRosterAuthority} selfId={workspace.selfId} agentActivity={workspace.agentActivity} onAcknowledgeAgentActivity={workspace.onAcknowledgeAgentActivity} pending={workspace.pending} approvalStates={workspace.approvalStates} controlStates={workspace.controlStates} capabilityIndex={workspace.capabilityIndex} access={workspace.access} surfaceVisible={messageSurfaceVisible} onTailCaughtUp={workspace.onTailCaughtUp} onResolve={workspace.onResolve} onCancel={workspace.onCancel} onTaskControl={workspace.onTaskControl} onDownloadResource={workspace.onDownloadResource} onPreviewResource={workspace.onPreviewResource} onOpenTurn={workspace.onOpenTurn} onCreateTask={workspace.onCreateTask} onReply={composerEdit ? null : beginReply} turnDetail={workspace.turnDetail} onComposerEditChange={setComposerEdit} onFocusAgentChange={workspace.onFocusAgentChange} /> : <ConversationSurface input={composer}><section id="workspace-panel-dynamic" className="channel-private-empty dynamic-private-empty" role="tabpanel" aria-labelledby="workspace-tab-dynamic"><strong>频道内容不可访问</strong><p>当前页面不会展示或搜索此前缓存的消息、产物、任务和成员。</p></section></ConversationSurface>}
        </div>
        {/* 文件工作面。跟终端一样：开过就恒不卸载，收起只是 hidden——目录、滚动和
            选中都在这棵树里，卸一次人就得从根目录重新点回来。按频道 key 重挂，
            所以换频道时位置从 fileLocationsRef 里恢复，而不是靠这棵树活着。 */}
        {filesEverOpened[navigation.activeChannelId] && workspace.channel && contentVisible
          && <Suspense fallback={<section className="split-loading" role="status">正在加载文件…</section>}><ArtifactsView key={`files-${navigation.activeChannelId}`} channel={workspace.channel} devices={workspace.resources.devices} disabled={workspace.resources.disabled} attachDisabled={fileAttachDisabled} attachDisabledReason={fileAttachDisabledReason} onResource={workspace.resources.onResource} onFileOperation={workspace.resources.onFileOperation} onAttach={attachFileToDraft} onPreview={workspace.resources.onPreview} recentFiles={workspace.resources.recentFiles} visible={filesOpen} initialLocation={fileLocationsRef.current.get(navigation.activeChannelId) || null} onLocationChange={rememberFileLocation} onClose={toggleFiles} autoFocusOnOpen={singleSurfaceShell} /></Suspense>}
        {/* 恒只挂当前频道这一块。切走就卸载——**这是安全的**，因为终端的真相
            恒在服务端：shell 由宽限期保住，屏幕由会话的回放环保住，attach 时
            先回放再转直播。上一版为了不黑屏把 N 块常驻在 DOM 里，那是把真相
            放在浏览器里的补丁，回放做掉之后它恒无必要。 */}
        {terminalEverOpened && terminalContentReady
          && <Suspense fallback={<section id="workspace-panel-terminal" className="terminal-view split-loading" role="status" hidden={!terminalOpen}>正在加载终端…</section>}><TerminalView channelId={navigation.activeChannelId} devices={workspace.resources.devices || []} canWrite={!writeDisabled} visible={terminalOpen} onClose={toggleTerminal} /></Suspense>}
      </div>}
      {workspace.view === 'tasks' && workspace.channel && (contentVisible ? <Suspense fallback={<section className="split-loading" role="status">正在加载任务…</section>}><TasksView items={workspace.tasks.items} roster={workspace.roster} selfId={workspace.selfId} providers={workspace.tasks.providers} canWrite={workspace.tasks.canWrite} onNewTask={workspace.tasks.onNewTask} onOpen={workspace.tasks.onOpen} onNewAutomation={workspace.tasks.onNewAutomation} /></Suspense> : <section id="workspace-panel-tasks" className="channel-private-empty" role="tabpanel" aria-labelledby="workspace-tab-tasks"><strong>任务不可访问</strong><p>恢复频道访问后才能查看任务。</p></section>)}
    </main>
    {workspace.channel && contentVisible && <button type="button" className={`reading-history-edge-tab${panel.value === 'reading-history' ? ' active' : ''}`} aria-label="打开最近阅读" title="最近阅读" onClick={() => panel.open('reading-history')}>最近</button>}
    {panel.value && <Suspense fallback={null}><RightPanelHost {...panel.host} artifacts={{ ...panel.host.artifacts, onAttach: attachFileToDraft, attachDisabled: fileAttachDisabled, attachDisabledReason: fileAttachDisabledReason }} /></Suspense>}
  </SurfaceShell>;
}
