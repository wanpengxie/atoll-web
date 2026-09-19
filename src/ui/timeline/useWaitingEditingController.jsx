import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { messagePresentation } from '../../model/message-presentation.js';
import { controlLabel, controlPayload, extraControls, taskControlContext } from '../../model/task-controls.js';
import { agentFrozenStates, agentMessageStage, editAdmission, editableText, lockFromContext, mergedInto, preemptedBy } from '../../model/agent-control.js';
import { diagnostic } from '../../model/diagnostics.js';
import { terminalResultPayload, terminalResultState, terminalRetainedValue } from '../../model/terminal-result.js';
import { selectLocalWaitingTurns, selectWaitingPresentation } from '../../model/waiting-presentation.js';
import { argsOf } from '../../protocol/envelope.js';
import { TYPES } from '../../protocol/vocab.js';
import { newId } from '../../util/id.js';
const WAITING_HANDOFF_DURATION_MS = 180;
const WAITING_HANDOFF_LEDGER_LIMIT = 512;
export const EMPTY_FROZEN_STATES = new Map();
export function exactHoldPayload(payload, holdId) {
  if (typeof holdId !== 'string' || !holdId) {
    throw new Error('编辑控制缺少 exact hold owner');
  }
  return { ...payload, expected_hold_id: holdId };
}
export function supportsLeaseCAS(capability, type) {
  return Boolean(capability?.describe?.types?.get(type)?.inputSchema?.properties?.expected_hold_id);
}
export function supportsEditLeaseCAS(capability) {
  return supportsLeaseCAS(capability, TYPES.agentReplace)
    && supportsLeaseCAS(capability, TYPES.agentUnhold);
}
export function editLeaseCapabilityState(capability) {
  if (!capability?.describe) return 'unknown';
  return supportsEditLeaseCAS(capability) ? 'supported' : 'unsupported';
}
function nameOf(id, names) {
  return actorNameFromMap(id, names);
}
function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setReduced(query.matches === true);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}
export function useWaitingHandoff(channelId, queuedTurns, presentationRows) {
  const reducedMotion = useReducedMotionPreference();
  const previousRef = useRef({ channelId, turns: new Map() });
  const completedRef = useRef(new Map());
  const timersRef = useRef(new Map());
  const [settling, setSettling] = useState(() => new Map());
  const currentTurns = useMemo(
    () => new Map(queuedTurns.map((turn, order) => [turn.requestId, { turn, order }])),
    [queuedTurns],
  );
  const rowIDs = useMemo(
    () => new Set(presentationRows.map((row) => row.id)),
    [presentationRows],
  );
  const sameChannel = previousRef.current.channelId === channelId;
  const fresh = sameChannel ? [...previousRef.current.turns].flatMap(([requestId, entry]) => (
    !currentTurns.has(requestId)
    && rowIDs.has(requestId)
    && !completedRef.current.has(requestId)
      ? [[requestId, entry]]
      : []
  )) : [];
  let visibleHandoffs = settling;
  if (!sameChannel || reducedMotion) visibleHandoffs = new Map();
  else if (fresh.length) {
    visibleHandoffs = new Map(settling);
    for (const [requestId, entry] of fresh) visibleHandoffs.set(requestId, entry);
  }
  useLayoutEffect(() => {
    if (previousRef.current.channelId !== channelId) {
      for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
      timersRef.current.clear();
      completedRef.current.clear();
      previousRef.current = { channelId, turns: currentTurns };
      setSettling((current) => current.size ? new Map() : current);
      return;
    }
    previousRef.current = { channelId, turns: currentTurns };
    if (!fresh.length) return;
    for (const [requestId] of fresh) completedRef.current.set(requestId, true);
    while (completedRef.current.size > WAITING_HANDOFF_LEDGER_LIMIT) {
      completedRef.current.delete(completedRef.current.keys().next().value);
    }
    if (reducedMotion) return;
    setSettling((current) => {
      const next = new Map(current);
      for (const [requestId, entry] of fresh) next.set(requestId, entry);
      return next;
    });
    for (const [requestId] of fresh) {
      const timer = globalThis.setTimeout(() => {
        timersRef.current.delete(requestId);
        setSettling((current) => {
          if (!current.has(requestId)) return current;
          const next = new Map(current);
          next.delete(requestId);
          return next;
        });
      }, WAITING_HANDOFF_DURATION_MS);
      timersRef.current.set(requestId, timer);
    }
  }, [channelId, currentTurns, fresh, reducedMotion]);
  useLayoutEffect(() => {
    if (!reducedMotion || !settling.size) return;
    for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
    timersRef.current.clear();
    setSettling(new Map());
  }, [reducedMotion, settling.size]);
  useEffect(() => () => {
    for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
    timersRef.current.clear();
  }, [channelId]);
  const exiting = useMemo(
    () => [...visibleHandoffs].map(([requestId, entry]) => ({ requestId, ...entry })),
    [visibleHandoffs],
  );
  const enteringRequestIDs = useMemo(() => new Set(visibleHandoffs.keys()), [visibleHandoffs]);
  return { exiting, enteringRequestIDs };
}
export function WaitingLayer({ turns, handoffs = [], state, names, selfId, access, targetAuthority, capabilityIndex, frozenByActor, editing, onCancel, onControl, onEdit, onEditText, onEditSave, onEditAbandon }) {
  const [bulk, setBulk] = useState({ actorId: '', error: '' });
  const [collapsed, setCollapsed] = useState(false);
  if (!turns.length && !handoffs.length) return null;
  const presented = [
    ...turns.map((turn, order) => ({ turn, order, exiting: false })),
    ...handoffs.map((entry) => ({ turn: entry.turn, order: entry.order, exiting: true })),
  ].sort((left, right) => left.order - right.order);
  const groups = [];
  const byActor = new Map();
  for (const item of presented) {
    const { turn } = item;
    const actorId = turn.request.audience?.[0] || '';
    if (!byActor.has(actorId)) {
      const group = { actorId, turns: [], items: [] };
      byActor.set(actorId, group);
      groups.push(group);
    }
    const group = byActor.get(actorId);
    group.items.push(item);
    if (!item.exiting) group.turns.push(turn);
  }
  async function cancelAll(group) {
    if (bulk.actorId) return;
    const capability = capabilityIndex.get(group.actorId);
    const cancellable = group.turns.filter((turn) => {
      const context = taskControlContext(turn, { selfId, access, targetAuthority });
      return context.targetControlsEligible
        && context.canCancel
        && supportsLeaseCAS(capability, TYPES.agentUnhold);
    });
    if (!cancellable.length) return;
    setBulk({ actorId: group.actorId, error: '' });
    let held = false;
    let holdId = '';
    const failures = [];
    try {
      holdId = await onControl(cancellable[0], group.actorId, TYPES.agentHold, {});
      if (!holdId) throw new Error('暂停等待区失败');
      held = true;
      for (const turn of cancellable) {
        try {
          await onCancel?.(state.channelId, turn.requestId, taskControlContext(turn, { selfId, access, targetAuthority }).cancelsAsDismiss);
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }
    } catch (error) {
      failures.push(error?.message || String(error));
    } finally {
      if (held) {
        try {
          await onControl(cancellable[0], group.actorId, TYPES.agentUnhold, exactHoldPayload({}, holdId));
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }
      setBulk({ actorId: '', error: failures[0] || '' });
    }
  }
  const soleGroup = groups.length === 1 ? groups[0] : null;
  const hasQueuedEditor = turns.some((turn) => turn.requestId === editing?.targetId);
  const renderedGroups = groups;
  const handoffOnly = turns.length === 0;
  return <div className={`agent-wait-dock${collapsed ? ' is-collapsed' : ''}${handoffOnly ? ' is-handoff-only' : ''}`}>
    <section className={`agent-wait-layer${collapsed ? ' is-collapsed' : ''}${hasQueuedEditor ? ' is-editing' : ''}${handoffOnly ? ' is-handoff-only' : ''}`} aria-label={handoffOnly ? undefined : '等待区'} aria-hidden={handoffOnly ? 'true' : undefined} inert={handoffOnly ? true : undefined}>
      {collapsed && <div className="agent-wait-collapsed"><span aria-hidden="true">↳</span><strong>{turns.length || handoffs.length} 条等待消息</strong>{!handoffOnly && <button type="button" aria-expanded="false" onClick={() => setCollapsed(false)}>展开</button>}</div>}
      {!collapsed && <header className="agent-wait-header" aria-label="等待区操作">
        {!handoffOnly && <div>
          {renderedGroups.map((group) => {
            const firstContext = taskControlContext(group.turns[0], { selfId, access, targetAuthority });
            const canInsertAll = group.turns.some((turn) => taskControlContext(turn, { selfId, access, targetAuthority }).canInsert);
            return canInsertAll && <button type="button" className="agent-wait-insert-all" key={`insert-${group.actorId}`} onClick={() => onControl(group.turns[0], group.actorId, TYPES.agentSteer, controlPayload(firstContext, TYPES.agentSteer, { all: true }))}>{soleGroup ? '全部插入' : `插入 ${nameOf(group.actorId, names)} 全部`}</button>;
          })}
          {renderedGroups.map((group) => {
            const capability = capabilityIndex.get(group.actorId);
            const canCancelAll = group.turns.some((turn) => {
              const context = taskControlContext(turn, { selfId, access, targetAuthority });
              return context.targetControlsEligible
                && context.canCancel
                && supportsLeaseCAS(capability, TYPES.agentUnhold);
            });
            return canCancelAll && <button type="button" className="agent-wait-cancel-all" key={group.actorId} disabled={Boolean(bulk.actorId)} onClick={() => cancelAll(group)}>{bulk.actorId === group.actorId ? '正在取消…' : soleGroup ? '全部取消' : `取消 ${nameOf(group.actorId, names)} 全部`}</button>;
          })}
          <button type="button" onClick={() => setCollapsed(true)}>收起</button>
        </div>}
      </header>}
      {!collapsed && renderedGroups.map((group) => {
      const paused = frozenByActor.get(group.actorId)?.source === TYPES.agentHold;
      return <section className="agent-wait-group" key={group.actorId} data-agent-id={group.actorId}>
        {!hasQueuedEditor && !soleGroup && <header><strong>{nameOf(group.actorId, names)}{paused ? '（已暂停）' : ''}</strong></header>}
        <ol>{group.items.map(({ turn, exiting }) => {
          const context = taskControlContext(turn, { selfId, access, targetAuthority });
          const capability = capabilityIndex.get(group.actorId);
          const view = messagePresentation(turn.request);
          const session = editing?.targetId === turn.requestId ? editing : null;
          const localStateLabel = turn.waitingPresentation === 'stored-local'
            ? '已保存在本机'
            : turn.waitingPresentation === 'transmitting'
              ? '正在发送'
              : turn.waitingPresentation === 'confirming'
                ? '等待账本确认'
                : '';
          return <li key={turn.requestId} className={`agent-wait-item${session ? ' is-editing' : ''}${exiting ? ' is-handoff-exiting' : ''}`} data-request-id={turn.requestId} data-handoff-state={exiting ? 'exit' : undefined} aria-hidden={exiting ? 'true' : undefined} inert={exiting ? true : undefined}>
            {exiting
              ? <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div>
              : session
              ? <><div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div><span className="agent-wait-editing-label">正在编辑</span></>
              : <>
                <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{view.text}</strong></div>
                <div className="agent-wait-actions">
                  {localStateLabel && <span className="agent-wait-local-state">{localStateLabel}</span>}
                  {paused && <span className="agent-wait-paused">已暂停</span>}
                  {context.steering && <span className="agent-wait-paused">正在并入…</span>}
                  {context.targetCurrentness === 'unknown' && <span className="agent-wait-paused">正在核验收件人</span>}
                  {context.targetCurrentness === 'departed' && <span className="agent-wait-paused">收件人已离席，等待账本关闭</span>}
                  {context.canEdit && editLeaseCapabilityState(capability) === 'unknown' && <span className="agent-wait-paused">正在确认 Agent 编辑能力</span>}
                  {context.canEdit && editLeaseCapabilityState(capability) === 'unsupported' && <span className="agent-wait-paused">Agent 版本不支持安全编辑</span>}
                  {context.canInsert && <button type="button" onClick={() => onControl(turn, group.actorId, TYPES.agentSteer, controlPayload(context, TYPES.agentSteer, { target: turn.requestId }))}>插入</button>}
                  {context.canEdit && editLeaseCapabilityState(capability) === 'supported' && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, group.actorId)}>编辑</button>}
                  {context.canCancel && <button type="button" title={context.cancelsAsDismiss ? '这条不是你发的，将请对方放弃它' : '撤回你自己发出的这条请求'} onClick={() => onCancel?.(state.channelId, turn.requestId, context.cancelsAsDismiss)}>取消</button>}
                  {extraControls(context).map((entry) => <button key={entry.word} type="button" onClick={() => onControl(turn, group.actorId, entry.word, controlPayload(context, entry.word, { target: turn.requestId }))}>{controlLabel(entry)}</button>)}
                </div>
              </>}
          </li>;
        })}</ol>
      </section>;
      })}
      {!collapsed && bulk.error && <p className="agent-wait-error" role="alert">{bulk.error}</p>}
    </section>
  </div>;
}
export function useWaitingEditingController({
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
}) {
  const [editing, setEditing] = useState(null);
  const editSessionSerialRef = useRef(0);
  const editingRef = useRef(null);
  const editReleasePendingRef = useRef(new Set());
  const editReleaseAcceptedRef = useRef(new Set());
  const editReleaseInFlightRef = useRef(new Map());
  const editRuntimeRef = useRef(null);
  const editSessionOwnersRef = useRef(new Map());
  const [editNotice, setEditNotice] = useState('');
  const [resumePin, setResumePin] = useState('');
  const [presentationNow, setPresentationNow] = useState(() => Date.now());
	const waitingContinuityRef = useRef({ channelId: '', ids: new Set() });
	const previousAccess = useRef(access);
  const controlVersion = state._timelineControlVersion ?? state.lastSeq;
  const declaredReplacementId = editing
    ? String(
      argsOf(state.turns.get(editing.targetId)?.terminal)?.replaced_by
      ?? argsOf(state.turns.get(editing.targetId)?.terminal)?.value?.replaced_by
      ?? '',
    )
    : '';
  const declaredReplacement = declaredReplacementId
    ? state.turns.get(declaredReplacementId)
    : null;
  const committedReplacementId = declaredReplacement?.request?.type === TYPES.agentReplace
    && String(argsOf(declaredReplacement.request)?.target || '') === editing?.targetId
    ? declaredReplacementId
    : '';
  const presentationEditing = committedReplacementId ? null : editing;
  const presentationResumePin = committedReplacementId || resumePin;
  const editingTargetId = presentationEditing?.location === 'processing'
    ? presentationEditing.targetId
    : presentationResumePin;
  const localWaitingTurns = useMemo(
    () => selectLocalWaitingTurns(pending || [], projectionSelfId),
    [pending, projectionSelfId],
  );
  const localWaitingIDs = useMemo(
    () => new Set(localWaitingTurns.map((turn) => turn.requestId)),
    [localWaitingTurns],
  );
  const timelineLocalEchoes = useMemo(
    () => (pending || []).filter((submission) => !localWaitingIDs.has(submission.messageId)),
    [localWaitingIDs, pending],
  );
  const timelineControl = useMemo(() => {
    const actorIds = new Set();
    const preempted = new Map();
    const merged = new Map();
    let hasFreezeOperations = false;
    for (const turn of state.turns.values()) {
      const actorId = turn.request?.audience?.length === 1 ? turn.request.audience[0] : '';
      if (actorId) actorIds.add(actorId);
      const replacement = preemptedBy(turn);
      if (replacement) preempted.set(replacement, [...(preempted.get(replacement) || []), turn]);
      const owner = mergedInto(turn);
      if (owner) merged.set(owner, (merged.get(owner) || 0) + 1);
      if (argsOf(turn.terminal)?.status === 'completed'
        && (turn.request?.type === TYPES.agentHold || turn.request?.type === TYPES.agentInterrupt)) {
        hasFreezeOperations = true;
      }
    }
    return { actorIds, preempted, merged, hasFreezeOperations };
  }, [state, controlVersion]);
  const schedulerStatus = history.status || null;
  const controlCurrent = schedulerStatus ? schedulerStatus.controlCurrent === true : true;
  const continuityIDs = waitingContinuityRef.current.channelId === state.channelId
    ? waitingContinuityRef.current.ids
    : new Set();
  const queuedTurns = useMemo(() => selectWaitingPresentation(state, {
    controlCurrent,
    editingTargetId,
    localTurns: localWaitingTurns,
    continuityIDs,
  }), [continuityIDs, controlCurrent, controlVersion, editingTargetId, localWaitingTurns, state]);
  useLayoutEffect(() => {
    const next = new Set(localWaitingIDs);
    for (const requestId of continuityIDs) {
      const turn = state.turns.get(requestId);
      if (turn && !turn.terminal && agentMessageStage(turn) === '') next.add(requestId);
    }
    waitingContinuityRef.current = { channelId: state.channelId, ids: next };
  }, [continuityIDs, controlVersion, localWaitingIDs, state]);
  const frozenByActor = useMemo(
    () => timelineControl.hasFreezeOperations
      ? agentFrozenStates(state, timelineControl.actorIds, presentationNow)
      : EMPTY_FROZEN_STATES,
    [state, controlVersion, timelineControl.actorIds, timelineControl.hasFreezeOperations, presentationNow],
  );
  useLayoutEffect(() => {
    const runtime = Object.freeze({
      channelId: state.channelId,
      state,
      frozenByActor,
      capabilityIndex,
      onTaskControl,
    });
    editingRef.current = editing;
    editRuntimeRef.current = runtime;
    if (editing?.sessionId
      && editing.channelId === state.channelId
      && !editSessionOwnersRef.current.has(editing.sessionId)) {
      editSessionOwnersRef.current.set(editing.sessionId, runtime);
    }
  }, [capabilityIndex, editing, frozenByActor, onTaskControl, state]);
  function editSessionRuntimes(session) {
    const current = editRuntimeRef.current;
    const owner = editSessionOwnersRef.current.get(session?.sessionId)
      || (current?.channelId === session?.channelId ? current : null);
    const authority = current?.channelId === session?.channelId ? current : owner;
    return { owner, authority };
  }
  function releaseEditSession(session, targetTurn = null, ownerRuntime = null) {
    if (!session) return Promise.resolve(false);
    if (editReleaseAcceptedRef.current.has(session.sessionId)) return Promise.resolve(true);
    const inFlight = editReleaseInFlightRef.current.get(session.sessionId);
    if (inFlight) return inFlight;
    if (!session.holdId) {
      editReleasePendingRef.current.add(session.sessionId);
      return Promise.resolve(false);
    }
    editReleasePendingRef.current.delete(session.sessionId);
    const resolved = editSessionRuntimes(session);
    const runtime = ownerRuntime || resolved.owner;
    const authorityRuntime = resolved.authority || runtime;
    const observed = authorityRuntime?.frozenByActor?.get(session.actorId);
    if (!runtime) return Promise.reject(new Error('编辑锁释放 owner 已失效'));
    if (observed && (observed.source !== TYPES.agentHold || observed.held_by !== session.holdId)) {
      editSessionOwnersRef.current.delete(session.sessionId);
      return Promise.resolve(true);
    }
    const turn = authorityRuntime?.state?.turns?.get(session.targetId) || targetTurn;
    const release = Promise.resolve(runtime?.onTaskControl?.({
      channelId: session.channelId,
      turn,
      actorId: session.actorId,
      type: TYPES.agentUnhold,
      messageId: session.releaseMessageId,
      payload: exactHoldPayload({}, session.holdId),
    })).then((releaseId) => {
      if (!releaseId) throw new Error('解除编辑锁请求未进入发送队列');
      editReleaseAcceptedRef.current.add(session.sessionId);
      editSessionOwnersRef.current.delete(session.sessionId);
      return true;
    }).finally(() => {
      if (editReleaseInFlightRef.current.get(session.sessionId) === release) {
        editReleaseInFlightRef.current.delete(session.sessionId);
      }
    });
    editReleaseInFlightRef.current.set(session.sessionId, release);
    return release;
  }
  useEffect(() => {
    const liveSessionId = editing?.sessionId;
    for (const sessionId of editReleaseAcceptedRef.current) {
      if (sessionId !== liveSessionId) editReleaseAcceptedRef.current.delete(sessionId);
    }
  }, [editing?.sessionId]);
  const nextFreezeDeadline = Math.min(...[...frozenByActor.values()].filter(Boolean).map((value) => value.until));
	const preemptedSources = timelineControl.preempted;
	const mergedCounts = timelineControl.merged;
  useEffect(() => { setEditNotice(''); }, [state.channelId]);
  useEffect(() => setPresentationNow(Date.now()), [controlVersion]);
  useEffect(() => {
    if (!Number.isFinite(nextFreezeDeadline)) return undefined;
    const timer = window.setTimeout(() => setPresentationNow(Date.now()), Math.max(1, nextFreezeDeadline - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [nextFreezeDeadline]);
  useEffect(() => {
    if (!editing) return;
    const activeEditSessionId = editing.sessionId;
    const targetTurn = state.turns.get(editing.targetId);
    const replacedBy = terminalRetainedValue(targetTurn, 'replaced_by');
    const replacementTurn = replacedBy ? state.turns.get(String(replacedBy)) : null;
    const replacementLanded = replacementTurn?.request?.type === TYPES.agentReplace
      && String(argsOf(replacementTurn.request)?.target || '') === editing.targetId;
    const frozen = frozenByActor.get(editing.actorId);
    const ownsLiveHold = Boolean(editing.holdId
      && frozen?.source === TYPES.agentHold
      && frozen.held_by === editing.holdId);
    const lockMustBeLive = ['editing', 'checking', 'submitting', 'saving'].includes(editing.phase);
    const replacementDeclared = Boolean(replacedBy);
    const targetClosed = Boolean(targetTurn?.terminal && !replacementDeclared);
    const lockLost = !replacementDeclared && lockMustBeLive && editing.holdId && !ownsLiveHold;
    const actorGone = roster.length > 0 && !roster.some((row) => row.id === editing.actorId);
    if (replacementLanded || targetClosed || lockLost || actorGone) {
      const session = editing;
      if (replacementLanded && session.location === 'processing') setResumePin(replacedBy);
      setEditing((current) => current?.sessionId === session.sessionId ? null : current);
      if (!replacementLanded) setEditNotice(targetClosed ? '原消息已经停止或取消，已退出编辑' : actorGone ? 'Agent 已重启或离开，已退出编辑' : '编辑已被另一项控制终止');
      if (actorGone) {
        editSessionOwnersRef.current.delete(session.sessionId);
      }
      else void releaseEditSession(session, targetTurn).catch((error) => {
        diagnostic('warn', 'timeline.edit_release_failed', {
          channelId: session.channelId,
          targetId: session.targetId,
          holdId: session.holdId,
          error,
        });
      });
      return;
    }
    if (editing.phase === 'locking') {
      const admission = editAdmission(state, editing);
      if (admission.error) {
        editSessionOwnersRef.current.delete(activeEditSessionId);
        setEditing(null);
        setEditNotice(admission.error);
      }
      else if (admission.ready) setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'editing', error: '' }) : current);
      return;
    }
    if (editing.phase === 'checking') {
      const contextTurn = state.turns.get(editing.contextId);
      if (!contextTurn?.terminal) return;
      const contextResult = terminalResultPayload(contextTurn);
      if (!contextResult) {
        setEditing((current) => current?.sessionId === activeEditSessionId
          ? ({ ...current, phase: 'editing', error: terminalResultState(contextTurn).error })
          : current);
        return;
      }
      if (contextResult.status !== 'completed') {
        setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'editing', error: contextResult.detail || '编辑锁已失效' }) : current);
        return;
      }
      const lock = lockFromContext(contextResult, editing.holdId);
      if (!lock.valid) {
        setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'editing', error: lock.error }) : current);
        return;
      }
      setEditing((current) => current?.sessionId === activeEditSessionId ? ({ ...current, phase: 'submitting', error: '' }) : current);
      const sessionId = editing.sessionId;
      const runtime = editSessionRuntimes(editing);
      const replacementPayload = exactHoldPayload({ target: editing.targetId, old_text: editing.oldText, new_text: editing.text, ...(editing.attachments.length ? { attachments: editing.attachments } : {}) }, editing.holdId);
      Promise.resolve(runtime.owner?.onTaskControl?.({ channelId: editing.channelId, turn: runtime.authority?.state?.turns?.get(editing.targetId) || targetTurn, actorId: editing.actorId, type: TYPES.agentReplace, payload: replacementPayload }))
        .then((replacementId) => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'saving', replacementId: replacementId || '', error: replacementId ? '' : '修改请求未发出' }) : current))
        .catch((failure) => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure.message || String(failure) }) : current));
      return;
    }
    if (editing.phase === 'saving' && editing.replacementId) {
      const replacement = state.turns.get(editing.replacementId);
      const replacementResult = terminalResultPayload(replacement);
      if (replacementResult?.status === 'failed') {
        const sessionId = editing.sessionId;
        setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: replacementResult.detail || replacementResult.error_code || '修改失败' }) : current);
      } else if (replacement?.terminalClosureOnly) {
        const sessionId = editing.sessionId;
        setEditing((current) => current?.sessionId === sessionId
          ? ({ ...current, phase: 'editing', error: terminalResultState(replacement).error })
          : current);
      }
    }
  }, [controlVersion, editing?.sessionId, editing?.phase, editing?.contextId, editing?.replacementId, editing?.holdId, frozenByActor, roster]);
  useEffect(() => {
    if (!resumePin) return;
    const turn = state.turns.get(resumePin);
    if (!turn || turn.terminal || agentMessageStage(turn) === 'timeline') setResumePin('');
  }, [controlVersion, resumePin]);
  useEffect(() => {
    const reconnected = previousAccess.current !== 'member_active' && access === 'member_active';
    previousAccess.current = access;
    if (!reconnected || !editing || editing.phase !== 'editing') return;
    const sessionId = editing.sessionId;
    const runtime = editSessionRuntimes(editing);
    const targetTurn = runtime.authority?.state?.turns?.get(editing.targetId) || state.turns.get(editing.targetId);
    setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'checking', error: '' }) : current);
    Promise.resolve(runtime.owner?.onTaskControl?.({ channelId: editing.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} }))
      .then((contextId) => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' }) : current))
      .catch(() => setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: '编辑锁已失效' }) : current));
  }, [access]);
  async function startEditing(turn, actorId) {
    if (editing) return;
    setEditNotice('');
    const editCapability = editLeaseCapabilityState(capabilityIndex.get(actorId));
    if (editCapability === 'unknown') {
      setEditNotice('正在确认 Agent 编辑能力，请稍候');
      return;
    }
    if (editCapability === 'unsupported') {
      setEditNotice('当前 Agent 不支持安全编辑，请刷新能力或升级 Agent');
      return;
    }
    const location = taskControlContext(turn, { selfId, access, targetAuthority: waitingRosterAuthority }).location;
    const sessionId = ++editSessionSerialRef.current;
    const draft = { sessionId, releaseMessageId: newId(), channelId: state.channelId, targetId: turn.requestId, actorId, holdId: '', location, oldText: editableText(turn), text: editableText(turn), attachments: argsOf(turn.request).attachments || [], phase: 'requesting_lock', error: '' };
    const ownerRuntime = editRuntimeRef.current;
    if (ownerRuntime?.channelId === draft.channelId) {
      editSessionOwnersRef.current.set(sessionId, ownerRuntime);
    }
    setEditing(draft);
    try {
      const holdId = await ownerRuntime?.onTaskControl?.({ channelId: draft.channelId, turn, actorId, type: TYPES.agentHold, payload: { target: turn.requestId } });
      if (!holdId) {
        editSessionOwnersRef.current.delete(sessionId);
        setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: '无法锁定这条任务' }) : current);
        return;
      }
      if (editReleasePendingRef.current.has(sessionId)) {
        void releaseEditSession({ ...draft, holdId }, turn, ownerRuntime).catch((error) => {
          diagnostic('warn', 'timeline.edit_release_failed', {
            channelId: draft.channelId,
            targetId: draft.targetId,
            holdId,
            error,
          });
        });
        return;
      }
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, holdId, phase: 'locking', error: '' }) : current);
    } catch (failure) {
      editSessionOwnersRef.current.delete(sessionId);
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure?.message || String(failure) || '无法锁定这条任务' }) : current);
    }
  }
  async function verifyAndSave(nextText) {
    if (!editing || editing.phase !== 'editing') return;
    const sessionId = editing.sessionId;
    const runtime = editSessionRuntimes(editing);
    const targetTurn = runtime.authority?.state?.turns?.get(editing.targetId) || state.turns.get(editing.targetId);
    const text = typeof nextText === 'string' ? nextText : editing.text;
    setEditing((current) => current?.sessionId === sessionId ? ({ ...current, text, phase: 'checking', error: '' }) : current);
    try {
      const contextId = await runtime.owner?.onTaskControl?.({ channelId: editing.channelId, turn: targetTurn, actorId: editing.actorId, type: TYPES.agentContext, payload: {} });
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, contextId: contextId || '', error: contextId ? '' : '编辑锁已失效' }) : current);
    } catch (failure) {
      setEditing((current) => current?.sessionId === sessionId ? ({ ...current, phase: 'editing', error: failure?.message || String(failure) || '无法确认编辑锁' }) : current);
    }
  }
  async function abandonEditing() {
    if (!editing || editing.phase === 'releasing') return;
    const sessionId = editing.sessionId;
    if (!editing.holdId) {
      editReleasePendingRef.current.add(sessionId);
      setEditing((current) => current?.sessionId === sessionId ? null : current);
      return;
    }
    const targetTurn = state.turns.get(editing.targetId);
    if (editing.location === 'processing') setResumePin(editing.targetId);
    setEditing((current) => current?.sessionId === sessionId
      ? ({ ...current, phase: 'releasing', error: '' })
      : current);
    try {
      const released = await releaseEditSession(editing, targetTurn);
      if (!released) throw new Error('正在等待编辑锁编号，稍后会自动解除');
      setEditing((current) => current?.sessionId === sessionId ? null : current);
    } catch (failure) {
      setEditing((current) => current?.sessionId === sessionId ? ({
        ...current,
        phase: 'editing',
        error: failure?.message || String(failure) || '解除编辑锁失败，请重试',
      }) : current);
    }
  }
  useLayoutEffect(() => {
    if (!onComposerEditChange) return;
    onComposerEditChange(presentationEditing ? { session: presentationEditing, onSave: verifyAndSave, onAbandon: abandonEditing } : null);
  }, [onComposerEditChange, presentationEditing?.targetId, presentationEditing?.phase, presentationEditing?.error]);
  useEffect(() => () => {
    const session = editingRef.current;
    if (session) void releaseEditSession(session).catch((error) => {
      diagnostic('warn', 'timeline.edit_release_failed', {
        channelId: session.channelId,
        targetId: session.targetId,
        holdId: session.holdId,
        error,
      });
    });
    onComposerEditChange?.(null);
  }, [onComposerEditChange, state.channelId]);
  return {
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
    onEditText(text) {
      setEditing((current) => current && ({ ...current, text, error: '' }));
    },
  };
}
