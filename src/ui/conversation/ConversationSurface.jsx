import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { actorNameMap } from '../../model/actor-display.js';
import { MarkdownFileReferenceProvider } from '../MarkdownContent.jsx';
import { MessageLayoutProvider } from '../timeline/MessageLayoutState.jsx';
import { ReadingContainerHandoff } from '../timeline/ReadingContainerHandoff.jsx';
import { useTimelineRowRenderer } from '../timeline/TimelineRowRenderer.jsx';
import { useConversationProjection } from '../timeline/useConversationProjection.js';
import {
  CONVERSATION_SCOPE,
  useTimelinePreferences,
} from '../timeline/useTimelinePreferences.js';
import {
  WaitingLayer,
  useWaitingEditingController,
  useWaitingHandoff,
} from '../timeline/useWaitingEditingController.jsx';
import { ReadingIntentProvider } from './ReadingIntentContext.jsx';

const EMPTY_CAPABILITY_INDEX = new Map();
const SHOW_CHANNEL_NARRATION = true;

/**
 * The stable shell-facing conversation port.
 *
 * This component only composes existing owners. `composer` is an opaque slot;
 * no draft, command, reading or history state is mirrored here.
 */
export function ConversationSurface({
  state,
  history = {},
  composer,
  viewSessions,
  roster = [],
  waitingRosterAuthority = null,
  selfId = '',
  agentActivity = null,
  onAcknowledgeAgentActivity,
  pending = [],
  approvalStates = {},
  capabilityIndex = EMPTY_CAPABILITY_INDEX,
  onRequestCapability,
  access = '',
  surfaceVisible = false,
  onTailCaughtUp,
  onResolve,
  onCancel,
  onTaskControl,
  onDownloadResource,
  onPreviewResource,
  onOpenTurn,
  onCreateTask,
  onReply,
  onComposerEditChange,
  onFocusAgentChange,
  className = '',
}) {
  if (composer == null) throw new TypeError('ConversationSurface 缺少 Composer slot');
  if (typeof onComposerEditChange !== 'function') throw new TypeError('ConversationSurface 缺少编辑交接 port');
  if (typeof onTaskControl !== 'function') throw new TypeError('ConversationSurface 缺少 Agent 控制 port');
  if (typeof onRequestCapability !== 'function') throw new TypeError('ConversationSurface 缺少能力查询 port');
  if (typeof onCancel !== 'function') throw new TypeError('ConversationSurface 缺少取消命令 port');
  const {
    scope,
    actorFilter,
    foldOverrides,
    messageLayoutStore,
    toggleScope,
    toggleActorFilter,
    removeActorFilter,
    toggleFold,
  } = useTimelinePreferences({ channelId: state.channelId, viewSessions });
  const names = useMemo(() => actorNameMap(roster), [roster]);
  const identityPending = !selfId;
  const projectionScope = identityPending && scope === CONVERSATION_SCOPE.mine
    ? CONVERSATION_SCOPE.all
    : scope;
  const {
    editingTargetId,
    editingReplacementId,
    presentationEditing,
    timelineLocalEchoes,
    queuedTurns,
    editNotice,
    startEditing,
  } = useWaitingEditingController({
    state,
    pending,
    capabilityIndex,
    onRequestCapability,
    onTaskControl,
    onComposerEditChange,
  });
  const actorFilterApplies = projectionScope === CONVERSATION_SCOPE.mine;
  const historyViewSpec = useMemo(() => ({
    scope: projectionScope,
    selfId,
    actorFilter,
    editingTargetId,
    editingReplacementId,
    showNarration: SHOW_CHANNEL_NARRATION,
    incremental: true,
  }), [actorFilter, editingReplacementId, editingTargetId, projectionScope, selfId]);
  const messageListKey = `${state.channelId}:${scope}:${actorFilterApplies ? [...actorFilter].sort().join(',') : ''}`;
  const {
    projection,
    viewport,
    latestRowID,
    browsingExpandedSlots,
    livePresentationArrivals,
  } = useConversationProjection({
    state,
    history,
    viewSessions,
    historyViewSpec,
    messageListKey,
    timelineLocalEchoes,
    identityPending,
    surfaceVisible,
    onTailCaughtUp,
  });
  const filterableAgents = useMemo(() => roster.filter((row) => row.kind === 'agent'), [roster]);
  const rosterActorIDs = useMemo(() => new Set(filterableAgents.map((row) => row.id)), [filterableAgents]);
  const staleActorFilters = useMemo(
    () => [...actorFilter].filter((actorID) => !rosterActorIDs.has(actorID)).sort(),
    [actorFilter, rosterActorIDs],
  );
  const focusAgentId = useMemo(() => {
    if (!actorFilterApplies || actorFilter.size !== 1) return '';
    const [only] = [...actorFilter];
    return rosterActorIDs.has(only) ? only : '';
  }, [actorFilter, actorFilterApplies, rosterActorIDs]);
  useEffect(() => { onFocusAgentChange?.(focusAgentId); }, [focusAgentId, onFocusAgentChange]);

  const waitingHandoff = useWaitingHandoff(
    state.channelId,
    queuedTurns,
    projection.presentation.rows,
  );
  const rowPresentationState = useCallback(
    (row) => waitingHandoff.enteringRequestIDs.has(row.id) ? 'handoff-enter' : '',
    [waitingHandoff.enteringRequestIDs],
  );
  const historyStartBoundary = useMemo(() => {
    if (identityPending
      || viewport.availability !== 'readable'
      || viewport.historyDemand?.phase !== 'idle'
      || viewport.historyBoundary?.kind !== 'exhausted') return null;
    return Object.freeze({
      generation: viewport.historyBoundary.generation,
      label: viewport.historyBoundary.actorFiltered
        ? '已到频道开头，没有更早的符合筛选的往来'
        : '已到频道最早一条动态',
    });
  }, [identityPending, viewport.availability, viewport.historyBoundary, viewport.historyDemand?.phase]);
  const {
    rowRenderRevision,
    renderRow,
  } = useTimelineRowRenderer({
    state,
    names,
    selfId,
    access,
    targetAuthority: waitingRosterAuthority,
    presentationEditing,
    browsingExpandedSlots,
    effectiveFoldOverrides: foldOverrides,
    approvalStates,
    latestRowID,
    onResolve,
    onCancel,
    onTaskControl,
    onDownloadResource,
    onPreviewResource,
    onOpenTurn,
    onCreateTask,
    onReply,
    startEditing,
    toggleFold,
  });
  const openFileReference = useCallback((reference) => {
    onPreviewResource?.(state.channelId, reference);
  }, [onPreviewResource, state.channelId]);
  const acceptedComposerTokensRef = useRef(new WeakSet());
  const readingIntent = useMemo(() => ({
    composerSendStarted(channelID) {
      if (channelID !== state.channelId) return null;
      const token = viewport.captureBottomIntent();
      if (!token || !viewport.requestBottom('composer:send-start', token, {
        afterPresentationRevision: token.presentationRevision,
        baselineTailID: token.baselineTailID,
      })) return null;
      return viewport.captureBottomIntent();
    },
    composerAccepted(channelID, messageIDs, token) {
      if (channelID !== state.channelId || !messageIDs?.length || !token
        || acceptedComposerTokensRef.current.has(token)) return false;
      const current = viewport.captureBottomIntent();
      if (!current
        || current.activationID !== token.activationID
        || current.inputEpoch !== token.inputEpoch
        || current.intentRevision !== token.intentRevision) return false;
      acceptedComposerTokensRef.current.add(token);
      return viewport.bindBottomIntentTargets(token, messageIDs) !== false;
    },
    composerRejected(channelID, token) {
      return channelID === state.channelId && viewport.revokeBottomIntent(token) === true;
    },
  }), [state.channelId, viewport]);
  const presentationEmpty = projection.presentation.rows.length === 0 && queuedTurns.length === 0;
  const filteredEntries = projection.filtered || [];
  const channelEntries = projection.allEntries || filteredEntries;
  const localEchoEntries = projection.localEchoes || [];
  const conversationEmpty = filteredEntries.length === 0
    && localEchoEntries.length === 0
    && queuedTurns.length === 0;
  const hasChannelNarration = Boolean(state.narration?.length);
  const emptyFeedbackKind = !conversationEmpty
    ? ''
    : channelEntries.length === 0
      ? hasChannelNarration ? '' : 'channel'
      : actorFilterApplies && actorFilter.size > 0
        ? 'actor-filter'
        : projectionScope === CONVERSATION_SCOPE.mine ? 'mine' : '';
  const emptyFeedbackSettled = viewport.availability === 'empty-known'
    || viewport.historyBoundary?.kind === 'exhausted';
  const surfaceClass = ['conversation-surface', className].filter(Boolean).join(' ');

  return <ReadingIntentProvider value={readingIntent}>
    <MessageLayoutProvider store={messageLayoutStore}>
      <MarkdownFileReferenceProvider onOpen={openFileReference}>
          <div className={surfaceClass}>
            <div className="conversation-reading-slot">
              <section
                id="workspace-panel-dynamic"
                className="timeline timeline-virtualized"
                role="tabpanel"
                aria-labelledby="workspace-tab-dynamic"
                data-viewport-mode={viewport.session.mode}
              >
                <div className={`timeline-inner${emptyFeedbackKind ? '' : ' timeline-controls-overlay'}`}>
                  {selfId && channelEntries.length > 0 && <div className="timeline-scope-bar">
                    <div className="timeline-scope" role="group" aria-label="动态范围">
                      <button
                        type="button"
                        aria-pressed={scope === CONVERSATION_SCOPE.mine}
                        title={scope === CONVERSATION_SCOPE.mine ? '切换为全部动态' : '切换为与我相关'}
                        onClick={toggleScope}
                      >{scope === CONVERSATION_SCOPE.mine ? '与我相关' : '全部'}</button>
                      {actorFilterApplies && (filterableAgents.length > 0 || staleActorFilters.length > 0) && <div
                        className="timeline-actor-filter"
                        role="group"
                        aria-label="按成员过滤"
                      >
                        {filterableAgents.map((actor) => {
                          const on = actorFilter.has(actor.id);
                          const activityState = agentActivity?.agents?.[actor.id]?.state || '';
                          const actorName = names.get(actor.id) || actor.id;
                          return <button
                            type="button"
                            key={actor.id}
                            className={[on && 'is-on', activityState && `activity-${activityState}`].filter(Boolean).join(' ')}
                            aria-pressed={on}
                            title={activityState === 'active'
                              ? `${actorName} 正在运行`
                              : activityState === 'settled'
                                ? `${actorName} 已完成，点击确认`
                                : on ? `取消只看 ${actorName}` : `只看我与 ${actorName} 的往来`}
                            onClick={() => {
                              if (activityState === 'settled') onAcknowledgeAgentActivity?.(actor.id);
                              toggleActorFilter(actor.id);
                            }}
                          >{activityState && <i className="agent-activity-dot" aria-hidden="true" />}{actorName}</button>;
                        })}
                        {staleActorFilters.map((actorID) => <button
                          type="button"
                          key={actorID}
                          className="is-on is-stale"
                          aria-pressed="true"
                          onClick={() => removeActorFilter(actorID)}
                        >已失效 · {actorID}</button>)}
                      </div>}
                    </div>
                  </div>}
                  {emptyFeedbackKind && emptyFeedbackSettled && <div className="empty-ledger">
                    <span>{emptyFeedbackKind === 'channel' ? '#' : '@'}</span>
                    {emptyFeedbackKind === 'channel'
                      ? <><h2>这本账还没有可见条目</h2><p>从下方编辑器开始一段往来。</p></>
                      : emptyFeedbackKind === 'actor-filter'
                        ? <><h2>已扫描到频道开头，没有符合当前成员筛选的往来</h2><p>这不表示频道为空；移除成员筛选可查看当前范围。</p></>
                        : <><h2>这个频道里还没有与你相关的往来</h2><p>切回「全部」可以看到频道里其他人的动态。</p></>}
                  </div>}
                  {emptyFeedbackKind && emptyFeedbackKind !== 'channel' && !emptyFeedbackSettled && <div
                    className="empty-ledger"
                    data-scope-state="partial"
                  ><span>@</span><h2>正在查找符合筛选的往来…</h2><p>会继续读取更早内容，找到后自动显示。</p></div>}
                  {emptyFeedbackKind === 'channel' && !emptyFeedbackSettled && <div className="timeline-history-status" role="status">正在准备频道内容…</div>}
                  {viewport.availability === 'error' && <div className="timeline-history-status timeline-history-demand" role="alert">
                    <span>{viewport.availabilityError || '确认频道内容失败'}</span>
                    <button type="button" onClick={viewport.retryAvailability}>重试</button>
                  </div>}
                  {viewport.historyDemand?.phase !== 'idle' && !presentationEmpty && <div
                    className="timeline-history-status timeline-history-demand"
                    data-phase={viewport.historyDemand.phase}
                    role={viewport.historyDemand.phase === 'error' ? 'alert' : 'status'}
                  >{viewport.historyDemand.phase === 'error'
                      ? <><span>{viewport.historyDemand.error || '读取更早动态失败'}</span><button type="button" onClick={viewport.retryHistoryDemand}>重试</button></>
                      : '正在读取更早动态…'}</div>}
                </div>
                <ReadingContainerHandoff
                  key={state.channelId}
                  snapshot={projection.presentation}
                  reading={viewport}
                  surfaceVisible={surfaceVisible}
                  rowRevision={rowRenderRevision}
                  rowPresentationState={rowPresentationState}
                  livePresentationArrivals={livePresentationArrivals}
                  historyStartBoundary={historyStartBoundary}
                  renderRow={renderRow}
                />
                {viewport.unseenNotice > 0 && <button
                  type="button"
                  className="timeline-jump-latest"
                  onClick={viewport.jumpToLatest}
                >↓ {viewport.unseenNotice} 条新动态</button>}
              </section>
            </div>
            <div className="conversation-bottom-stack">
              <div className="conversation-floating-slot">
                {editNotice && <p className="agent-edit-error" role="alert">{editNotice}</p>}
                <WaitingLayer
                  turns={queuedTurns}
                  handoffs={waitingHandoff.exiting}
                  state={state}
                  names={names}
                  selfId={selfId}
                  access={access}
                  targetAuthority={waitingRosterAuthority}
                  capabilityIndex={capabilityIndex}
                  editing={presentationEditing}
                  onCancel={onCancel}
                  onControl={(turn, actorId, type, payload) => onTaskControl({ channelId: state.channelId, turn, actorId, type, payload })}
                  onEdit={startEditing}
                />
              </div>
              <div className="conversation-input-slot">{composer}</div>
            </div>
          </div>
      </MarkdownFileReferenceProvider>
    </MessageLayoutProvider>
  </ReadingIntentProvider>;
}
