import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actorNameMap } from '../model/actor-display.js';
import { attachmentFromFileReference } from '../model/file-references.js';
import { agentMessageStage, isAgentMessageTurn } from '../model/agent-control.js';
import { TIMELINE_SCOPE, TIMELINE_SCOPE_LABELS } from '../model/timeline-scope.js';
import { MessageLayoutProvider } from './timeline/MessageLayoutState.jsx';
import { ReadingContainerHandoff } from './timeline/ReadingContainerHandoff.jsx';
import { useConversationProjection } from './timeline/useConversationProjection.js';
import { useTimelinePreferences } from './timeline/useTimelinePreferences.js';
import {
  WaitingLayer,
  useWaitingEditingController,
  useWaitingHandoff,
} from './timeline/useWaitingEditingController.jsx';
import { ConversationSurface } from './conversation/ConversationSurface.jsx';
import { ReadingIntentProvider } from './conversation/ReadingIntentContext.jsx';
import { MarkdownFileReferenceProvider } from './MarkdownContent.jsx';
import { ProgressTrailHost } from './timeline/ProgressTrail.jsx';
import {
  EMPTY_CAPABILITY_INDEX,
  EMPTY_CONTROL_STATES,
  SHOW_CHANNEL_NARRATION,
  useTimelineRowRenderer,
} from './timeline/TimelineRowRenderer.jsx';
export function Timeline({ state, history = {}, composer = null, viewSessions, roster, waitingRosterAuthority = null, selfId, agentActivity, onAcknowledgeAgentActivity, pending, approvalStates, controlStates = EMPTY_CONTROL_STATES, capabilityIndex = EMPTY_CAPABILITY_INDEX, access = '', surfaceVisible = false, onTailCaughtUp, onResolve, onCancel, onTaskControl, onDownloadResource, onPreviewResource, onOpenTurn, onCreateTask, onReply, turnDetail, onComposerEditChange, onFocusAgentChange }) {
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
  const [knownSelfId, setKnownSelfId] = useState(() => selfId || '');
	const openFileReference = useCallback((reference) => {
	  onPreviewResource?.(state.channelId, attachmentFromFileReference(reference));
	}, [onPreviewResource, state.channelId]);
  const names = useMemo(() => actorNameMap(roster), [roster]);
  useEffect(() => {
    if (selfId) setKnownSelfId(selfId);
  }, [selfId]);
  const projectionSelfId = selfId || knownSelfId;
  const identityPending = !projectionSelfId;
  const projectionScope = identityPending && scope === TIMELINE_SCOPE.mine
    ? TIMELINE_SCOPE.all
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
    projectionSelfId,
    selfId,
    access,
    waitingRosterAuthority,
    capabilityIndex,
    roster,
    onTaskControl,
    onComposerEditChange,
  });
  const actorFilterApplies = projectionScope === TIMELINE_SCOPE.mine;
  const historyViewSpec = useMemo(() => ({
    scope: projectionScope,
    selfId: projectionSelfId,
    actorFilter,
    editingTargetId,
    editingReplacementId: presentationEditing?.replacementId || '',
    showNarration: SHOW_CHANNEL_NARRATION,
    incremental: true,
  }), [actorFilter, editingTargetId, presentationEditing?.replacementId, projectionScope, projectionSelfId]);
  const messageListKey = `${state.channelId}:${scope}:${actorFilterApplies ? [...actorFilter].sort().join(',') : ''}`;
  const {
    projection,
    viewport,
    rolePresentation,
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
  const filterableAgents = useMemo(() => (roster || []).filter((row) => row.kind === 'agent'), [roster]);
  const currentFilterActorIDs = useMemo(() => new Set(filterableAgents.map((row) => row.id)), [filterableAgents]);
  const staleActorFilters = useMemo(
    () => [...actorFilter].filter((actorID) => !currentFilterActorIDs.has(actorID)).sort(),
    [actorFilter, currentFilterActorIDs],
  );
  const focusAgentId = useMemo(() => {
    if (!actorFilterApplies || actorFilter.size !== 1) return '';
    const [only] = [...actorFilter];
    return filterableAgents.some((row) => row.id === only) ? only : '';
  }, [actorFilterApplies, actorFilter, filterableAgents]);
  useEffect(() => { onFocusAgentChange?.(focusAgentId); }, [focusAgentId, onFocusAgentChange]);
  const messageListRenderKey = state.channelId;
  const withNarration = rolePresentation.rows;
  const waitingHandoff = useWaitingHandoff(state.channelId, queuedTurns, rolePresentation.rows);
  const rowPresentationState = useCallback(
    (row) => waitingHandoff.enteringRequestIDs.has(row.id) ? 'handoff-enter' : '',
    [waitingHandoff.enteringRequestIDs],
  );
  const bottomIntentPresentation = useMemo(() => {
    const intent = viewport.session.bottomIntent;
    const messageIDs = intent?.targetMessageIDs || [];
    if (!intent?.id || !messageIDs.length) return null;
    const destinations = messageIDs.map((messageID) => {
      if (queuedTurns.some((item) => item.requestId === messageID)) {
        return { messageID, destination: 'waiting' };
      }
      const turn = state.turns.get(messageID);
      if (turn && isAgentMessageTurn(turn)) {
        const stage = agentMessageStage(turn);
        if (stage === 'timeline' && projection.presentation.rows.some((row) => (
          row.id === messageID && !row.localState && row.body?.local !== true
        ))) return {
          messageID,
          destination: 'timeline',
          targetListRevision: Number(projection.presentation.revision || 0),
        };
        return null;
      }
      const row = projection.presentation.rows.find((candidate) => candidate.id === messageID);
      return row && !row.localState && row.body?.local !== true
        ? {
          messageID,
          destination: 'timeline',
          targetListRevision: Number(projection.presentation.revision || 0),
        }
        : null;
    });
    return Object.freeze({
      intentID: intent.id,
      activationID: viewport.activationID,
      inputEpoch: viewport.session.inputEpoch,
      presentationRevision: Number(projection.presentation.revision || 0),
      ready: destinations.every(Boolean),
      destinations: Object.freeze(destinations.filter(Boolean)),
    });
  }, [projection.presentation, queuedTurns, state, viewport.activationID, viewport.session]);
  const presentationEmpty = !withNarration.length && !queuedTurns.length;
  const historyStartBoundary = useMemo(() => {
    if (presentationEmpty
      || identityPending
      || viewport.availability !== 'readable'
      || viewport.historyDemand?.phase !== 'idle'
      || viewport.historyBoundary?.kind !== 'exhausted') return null;
    return Object.freeze({
      generation: viewport.historyBoundary.generation,
      label: viewport.historyBoundary.actorFiltered
        ? '已到频道开头，没有更早的符合筛选的往来'
        : '已到频道最早一条动态',
    });
  }, [
    identityPending,
    presentationEmpty,
    viewport.availability,
    viewport.historyBoundary?.actorFiltered,
    viewport.historyBoundary?.generation,
    viewport.historyBoundary?.kind,
    viewport.historyDemand?.phase,
  ]);
  const { rowRenderRevision, renderRow } = useTimelineRowRenderer({
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
  const floatingInput = <>
    {editNotice && <p className="agent-edit-error" role="alert">{editNotice}</p>}
    <WaitingLayer turns={queuedTurns} handoffs={waitingHandoff.exiting} state={state} names={names} selfId={selfId} access={access} targetAuthority={waitingRosterAuthority} capabilityIndex={capabilityIndex} frozenByActor={frozenByActor} editing={presentationEditing} onCancel={onCancel} onControl={(turn, actorId, type, payload) => onTaskControl?.({ channelId: state.channelId, turn, actorId, type, payload })} onEdit={startEditing} onEditText={onEditText} onEditSave={verifyAndSave} onEditAbandon={abandonEditing} />
  </>;
  const acceptedComposerTokensRef = useRef(new WeakSet());
  const readingIntent = useMemo(() => ({
    composerSendStarted(channelID) {
      if (channelID !== state.channelId) return null;
      const before = viewport.captureBottomIntent();
      if (!before || !viewport.requestBottom('composer:send-start', before, {
        afterPresentationRevision: before.presentationRevision,
        baselineTailID: before.baselineTailID,
      })) return null;
      return viewport.captureBottomIntent();
    },
    composerAccepted(channelID, messageIDs, token) {
      if (channelID !== state.channelId
        || !messageIDs?.length
        || !token
        || typeof token.activationID !== 'string'
        || !Number.isSafeInteger(token.inputEpoch)
        || !Number.isSafeInteger(token.intentRevision)
        || !['following', 'browsing'].includes(token.mode)) return false;
      if (acceptedComposerTokensRef.current.has(token)) return false;
      const current = viewport.captureBottomIntent();
      if (!current
        || current.activationID !== token.activationID
        || current.inputEpoch !== token.inputEpoch
        || current.intentRevision !== token.intentRevision) return false;
      acceptedComposerTokensRef.current.add(token);
      if (viewport.bindBottomIntentTargets?.(token, messageIDs) === false) return false;
      return true;
    },
    composerRejected(channelID, token) {
      if (channelID !== state.channelId || !token) return false;
      return viewport.revokeBottomIntent?.(token) === true;
    },
  }), [state.channelId, viewport.bindBottomIntentTargets, viewport.captureBottomIntent, viewport.requestBottom, viewport.revokeBottomIntent]);
  const historyWaitingLabel = viewport.status?.waitingStage === 'cache-read'
    ? '正在读取本地缓存…'
    : viewport.status?.waitingStage === 'network-receipt'
      ? '正在等待历史请求响应…'
      : viewport.status?.waitingStage === 'network-page'
        ? '正在接收历史数据…'
        : '正在确认频道内容…';
  return <ReadingIntentProvider value={readingIntent}><MessageLayoutProvider store={messageLayoutStore}><MarkdownFileReferenceProvider onOpen={openFileReference}><ProgressTrailHost><ConversationSurface input={composer} floating={floatingInput}>
		<section id="workspace-panel-dynamic" className="timeline timeline-virtualized" role="tabpanel" aria-labelledby="workspace-tab-dynamic" data-viewport-mode={viewport.session.mode} data-has-initial-anchor={viewport.session.bookmark ? true : undefined}>
      <div className={state.rows.size ? 'timeline-inner timeline-controls-overlay' : 'timeline-inner'}>
        {projectionSelfId && Boolean(state.rows.size) && <div className="timeline-scope-bar">
          <div className="timeline-scope" role="group" aria-label="动态范围">
            <button
              type="button"
              aria-pressed={scope === TIMELINE_SCOPE.mine}
              title={`切换为${TIMELINE_SCOPE_LABELS[scope === TIMELINE_SCOPE.mine ? TIMELINE_SCOPE.all : TIMELINE_SCOPE.mine]}`}
              onClick={toggleScope}
            >{TIMELINE_SCOPE_LABELS[scope]}</button>
            {actorFilterApplies && (filterableAgents.length > 0 || staleActorFilters.length > 0) && <div className="timeline-actor-filter" role="group" aria-label="按成员过滤">
              {filterableAgents.map((row) => {
                const on = actorFilter.has(row.id);
                const activity = agentActivity?.agents?.[row.id];
                const activityState = activity?.state || '';
                const actorName = names.get(row.id) || row.id;
                return <div className="timeline-actor-filter-item" key={row.id}>
                  <button
                    type="button"
                    className={[on && 'is-on', activityState && `activity-${activityState}`].filter(Boolean).join(' ')}
                    aria-pressed={on}
                    title={on ? `取消只看 ${actorName}` : `只看我与 ${actorName} 的往来`}
                    onClick={() => {
                      if (activityState === 'settled') onAcknowledgeAgentActivity?.(row.id);
                      toggleActorFilter(row.id);
                    }}
                  >{activityState && <i className="agent-activity-dot" aria-hidden="true" />}{actorName}</button>
                </div>;
              })}
              {staleActorFilters.map((actorID) => <button
                key={actorID}
                type="button"
                className="is-on is-stale"
                aria-pressed="true"
                aria-label={`移除已失效成员筛选 ${actorID}`}
                title={`已失效成员：${actorID}；点击移除筛选`}
                onClick={() => removeActorFilter(actorID)}
              >已失效 · {actorID}</button>)}
            </div>}
          </div>
        </div>}
		{presentationEmpty && viewport.availability === 'empty-known' && (
		  viewport.emptyReason === 'channel'
		    ? <div className="empty-ledger"><span>#</span><h2>这本账还没有可见条目</h2><p>从下方编辑器 @ 一位成员开始。</p></div>
		    : <div className="empty-ledger"><span>@</span>{staleActorFilters.length
		      ? <><h2>当前应用了已失效的成员筛选。</h2><p>从上方移除已失效筛选后即可查看当前范围。</p></>
		      : viewport.historyBoundary?.actorFiltered
		        ? <><h2>已扫描到频道开头，没有符合当前成员筛选的往来</h2><p>这不表示频道为空；切回「全部」可查看其他动态。</p></>
		        : <><h2>这个频道里还没有与你相关的往来</h2><p>切回「全部」可以看到频道里其他人的动态。</p></>}</div>
		)}
		{presentationEmpty && viewport.availability === 'partial' && (
		  <div className="empty-ledger" data-scope-state="partial"><span>@</span>{staleActorFilters.length
		    ? <><h2>当前应用了已失效的成员筛选。</h2><p>从上方移除已失效筛选后即可查看当前范围。</p></>
		    : <><h2>正在查找符合筛选的往来…</h2><p>会继续读取更早内容，找到后自动显示。</p></>}</div>
		)}
	  </div>
		  {((presentationEmpty && ['syncing', 'unknown'].includes(viewport.availability)) || viewport.availability === 'materializing') && <div className="timeline-history-status" role="status">{historyWaitingLabel}</div>}
		  {presentationEmpty && viewport.availability === 'partial' && viewport.historyDemand?.phase === 'pending' && <div
		    className="timeline-history-status timeline-history-demand"
		    data-phase="pending"
		    data-revision={viewport.historyDemand.revision}
		    role="status"
		  >{viewport.status?.waitingStage ? historyWaitingLabel : '正在读取更早动态…'}</div>}
		  {presentationEmpty && viewport.availability === 'error' && <div
      className="timeline-history-status timeline-history-demand"
      data-phase="error"
      data-revision={viewport.historyDemand?.revision || 0}
      role="alert"
    ><span>{viewport.availabilityError || '确认频道内容失败'}</span><button type="button" onClick={() => viewport.retryAvailability()}>重试</button></div>}
	  {!presentationEmpty && identityPending && <div className="timeline-history-status" role="status">正在确认你的频道身份，当前显示全部动态。</div>}
	  {!presentationEmpty && viewport.cache?.phase === 'error' && <div
	    className="timeline-history-status timeline-history-demand"
	    data-phase="error"
	    data-error-code={viewport.cache.code || undefined}
	    role="alert"
	  ><span>{viewport.cache.error || '本地缓存初始化失败'}</span><button type="button" onClick={() => viewport.retryAvailability()}>重试</button></div>}
	  {!presentationEmpty && !identityPending && viewport.availability === 'readable'
	    && viewport.freshness?.phase === 'pending' && <div
	      className="timeline-history-status timeline-freshness-status"
	      data-phase="pending"
	      role="status"
	    >正在确认频道最新内容…</div>}
	  {!presentationEmpty && !identityPending && viewport.availability === 'readable'
	    && viewport.freshness?.phase === 'error' && <div
	      className="timeline-history-status timeline-freshness-status"
	      data-phase="error"
	      role="alert"
	    ><span>{viewport.freshness.error || '确认频道最新内容失败'}</span><button type="button" onClick={() => viewport.retryAvailability()}>重试</button></div>}
	  {!presentationEmpty && !identityPending && viewport.availability === 'readable' && viewport.historyDemand?.phase !== 'idle' && <div
      className="timeline-history-status timeline-history-demand"
      data-phase={viewport.historyDemand.phase}
      data-revision={viewport.historyDemand.revision}
      role={viewport.historyDemand.phase === 'error' ? 'alert' : 'status'}
    >{viewport.historyDemand.phase === 'error'
      ? <><span>{viewport.historyDemand.error || '读取更早动态失败'}</span><button type="button" onClick={() => viewport.retryHistoryDemand()}>重试</button></>
      : '正在读取更早动态…'}</div>}
		{/* ReadingSession synchronously owns following/browsing. The adapter only
		  * keeps the outgoing paint while the browsing container materializes the
		  * already-committed bookmark. */}
		<ReadingContainerHandoff
		  key={messageListRenderKey}
		  snapshot={rolePresentation}
		  reading={viewport}
		  surfaceVisible={surfaceVisible}
		  bottomIntentPresentation={bottomIntentPresentation}
		  rowRevision={rowRenderRevision}
			  rowPresentationState={rowPresentationState}
			  livePresentationArrivals={livePresentationArrivals}
			  historyStartBoundary={historyStartBoundary}
			  renderRow={renderRow}
		/>
	  {viewport.unseenNotice > 0 && <button type="button" className="timeline-jump-latest" onClick={viewport.jumpToLatest}>↓ {viewport.unseenNotice} 条新动态</button>}
    </section>
  </ConversationSurface></ProgressTrailHost></MarkdownFileReferenceProvider></MessageLayoutProvider></ReadingIntentProvider>;
}
