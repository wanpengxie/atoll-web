import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { actorNameMap } from '../../model/actor-display.js';
import { attachmentFromFileReference } from '../../model/file-references.js';
import { MarkdownFileReferenceProvider } from '../MarkdownContent.jsx';
import { MessageLayoutProvider } from '../timeline/MessageLayoutState.jsx';
import { ProgressTrailHost } from '../timeline/ProgressTrail.jsx';
import { ReadingContainerHandoff } from '../timeline/ReadingContainerHandoff.jsx';
import {
  EMPTY_CAPABILITY_INDEX,
  EMPTY_CONTROL_STATES,
  SHOW_CHANNEL_NARRATION,
  useTimelineRowRenderer,
} from '../timeline/TimelineRowRenderer.jsx';
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

/**
 * The stable shell-facing conversation port.
 *
 * This component only composes existing owners. `composer` is an opaque slot;
 * no draft, command, reading or history state is mirrored here.
 */
export function ConversationSurface({
  state,
  history = {},
  composer = null,
  viewSessions,
  roster = [],
  waitingRosterAuthority = null,
  selfId = '',
  agentActivity = null,
  onAcknowledgeAgentActivity,
  pending = [],
  approvalStates = {},
  controlStates = EMPTY_CONTROL_STATES,
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
  turnDetail,
  onComposerEditChange,
  onFocusAgentChange,
  className = '',
}) {
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
    presentationEditing,
    resumePin,
    timelineLocalEchoes,
    queuedTurns,
    frozenByActor,
    preemptedSources,
    mergedCounts,
    editNotice,
    startEditing,
    verifyAndSave,
    abandonEditing,
    onEditText,
  } = useWaitingEditingController({
    state,
    history,
    pending,
    selfId,
    access,
    waitingRosterAuthority,
    capabilityIndex,
    roster,
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
    editingReplacementId: presentationEditing?.replacementId || '',
    showNarration: SHOW_CHANNEL_NARRATION,
    incremental: true,
  }), [actorFilter, editingTargetId, presentationEditing?.replacementId, projectionScope, selfId]);
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
    roster,
    names,
    selfId,
    access,
    waitingRosterAuthority,
    capabilityIndex,
    frozenByActor,
    presentationEditing,
    resumePin,
    browsingExpandedSlots,
    effectiveFoldOverrides: foldOverrides,
    approvalStates,
    controlStates,
    mergedCounts,
    preemptedSources,
    turnDetail,
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
    verifyAndSave,
    abandonEditing,
    onEditText,
    toggleFold,
  });
  const openFileReference = useCallback((reference) => {
    onPreviewResource?.(state.channelId, attachmentFromFileReference(reference));
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
  const surfaceClass = ['conversation-surface', className].filter(Boolean).join(' ');

  return <ReadingIntentProvider value={readingIntent}>
    <MessageLayoutProvider store={messageLayoutStore}>
      <MarkdownFileReferenceProvider onOpen={openFileReference}>
        <ProgressTrailHost>
          <div className={surfaceClass}>
            <div className="conversation-reading-slot">
              <section
                id="workspace-panel-dynamic"
                className="timeline timeline-virtualized"
                role="tabpanel"
                aria-labelledby="workspace-tab-dynamic"
                data-viewport-mode={viewport.session.mode}
              >
                {selfId && <div className="timeline-scope-bar">
                  <div className="timeline-scope" role="group" aria-label="动态范围">
                    <button type="button" onClick={toggleScope}>{scope === CONVERSATION_SCOPE.mine ? '与我相关' : '全部'}</button>
                    {actorFilterApplies && filterableAgents.map((actor) => <button
                      type="button"
                      key={actor.id}
                      className={actorFilter.has(actor.id) ? 'is-on' : ''}
                      aria-pressed={actorFilter.has(actor.id)}
                      onClick={() => {
                        if (agentActivity?.agents?.[actor.id]?.state === 'settled') onAcknowledgeAgentActivity?.(actor.id);
                        toggleActorFilter(actor.id);
                      }}
                    >{names.get(actor.id) || actor.id}</button>)}
                    {staleActorFilters.map((actorID) => <button
                      type="button"
                      key={actorID}
                      className="is-on is-stale"
                      onClick={() => removeActorFilter(actorID)}
                    >已失效 · {actorID}</button>)}
                  </div>
                </div>}
                {presentationEmpty && viewport.availability === 'empty-known' && <div className="empty-ledger">
                  <span>#</span><h2>这本账还没有可见条目</h2><p>从下方编辑器开始一段往来。</p>
                </div>}
                {presentationEmpty && ['syncing', 'unknown', 'partial'].includes(viewport.availability) && <div className="timeline-history-status" role="status">正在准备频道内容…</div>}
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
                  frozenByActor={frozenByActor}
                  editing={presentationEditing}
                  onCancel={onCancel}
                  onControl={(turn, actorId, type, payload) => onTaskControl?.({ channelId: state.channelId, turn, actorId, type, payload })}
                  onEdit={startEditing}
                  onEditText={onEditText}
                  onEditSave={verifyAndSave}
                  onEditAbandon={abandonEditing}
                />
              </div>
              <div className="conversation-input-slot">{composer}</div>
            </div>
          </div>
        </ProgressTrailHost>
      </MarkdownFileReferenceProvider>
    </MessageLayoutProvider>
  </ReadingIntentProvider>;
}
