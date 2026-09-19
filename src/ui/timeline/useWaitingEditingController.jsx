import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { terminalRetainedValue } from '../../model/terminal-result.js';
import { argsOf } from '../../protocol/envelope.js';
import { TYPES } from '../../protocol/vocab.js';
import { newId } from '../../util/id.js';

const WAITING_HANDOFF_DURATION_MS = 180;
const AGENT_MESSAGE_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue]);
export const EMPTY_FROZEN_STATES = new Map();

export function exactHoldPayload(payload, holdId) {
  if (typeof holdId !== 'string' || !holdId) throw new Error('编辑控制缺少 exact hold owner');
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

function messageText(turn) {
  const body = argsOf(turn?.request);
  return String(body.text ?? body.body ?? body.title ?? body.detail ?? turn?.request?.type ?? '');
}

function actorID(turn) {
  return String(turn?.request?.audience?.[0] || '');
}

function latestStage(turn) {
  if (turn?.terminal) return 'timeline';
  const status = [...(turn?.provisional || [])]
    .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
    .map((item) => String(argsOf(item.envelope)?.status || ''))
    .filter(Boolean).at(-1);
  if (status === 'processing') return 'processing';
  if (['received', 'queued', 'deferred'].includes(status)) return 'queued';
  return AGENT_MESSAGE_TYPES.has(turn?.request?.type) ? 'queued' : '';
}

function timelineTurn(state, requestId) {
  if (!requestId) return null;
  for (const entry of state?.timeline || []) {
    if (entry?.turn?.requestId === requestId) return entry.turn;
    const child = entry?.thread?.find((item) => item?.turn?.requestId === requestId);
    if (child) return child.turn;
  }
  return null;
}

function queuedTurnsOf(state, editingTargetId) {
  const turns = [];
  for (const entry of state?.timeline || []) {
    if (entry?.kind !== 'turn') continue;
    const turn = entry.turn;
    if (turn.requestId === editingTargetId || latestStage(turn) !== 'queued') continue;
    turns.push(turn);
  }
  return turns.sort((left, right) => Number(left.requestSeq || 0) - Number(right.requestSeq || 0));
}

export function useWaitingHandoff(channelId, queuedTurns, presentationRows) {
  const previousRef = useRef({ channelId, turns: new Map() });
  const timersRef = useRef(new Map());
  const [settling, setSettling] = useState(() => new Map());
  const currentTurns = useMemo(
    () => new Map(queuedTurns.map((turn, order) => [turn.requestId, { turn, order }])),
    [queuedTurns],
  );
  const presentedIDs = useMemo(() => new Set(presentationRows.map((row) => row.id)), [presentationRows]);
  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { channelId, turns: currentTurns };
    if (previous.channelId !== channelId) {
      for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
      timersRef.current.clear();
      setSettling(new Map());
      return;
    }
    const exiting = [...previous.turns].filter(([id]) => !currentTurns.has(id) && presentedIDs.has(id));
    if (!exiting.length) return;
    setSettling((current) => {
      const next = new Map(current);
      for (const [id, entry] of exiting) next.set(id, entry);
      return next;
    });
    for (const [id] of exiting) {
      globalThis.clearTimeout(timersRef.current.get(id));
      timersRef.current.set(id, globalThis.setTimeout(() => {
        timersRef.current.delete(id);
        setSettling((current) => {
          if (!current.has(id)) return current;
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }, WAITING_HANDOFF_DURATION_MS));
    }
  }, [channelId, currentTurns, presentedIDs]);
  useEffect(() => () => {
    for (const timer of timersRef.current.values()) globalThis.clearTimeout(timer);
  }, []);
  return useMemo(() => ({
    exiting: [...settling].map(([requestId, entry]) => ({ requestId, ...entry })),
    enteringRequestIDs: new Set(settling.keys()),
  }), [settling]);
}

export function WaitingLayer({
  turns,
  handoffs = [],
  state,
  names,
  selfId,
  access,
  targetAuthority,
  capabilityIndex,
  editing,
  onCancel,
  onControl,
  onEdit,
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!turns.length && !handoffs.length) return null;
  const items = [
    ...turns.map((turn, order) => ({ turn, order, exiting: false })),
    ...handoffs.map((entry) => ({ turn: entry.turn, order: entry.order, exiting: true })),
  ].sort((left, right) => left.order - right.order);
  const groups = [];
  const index = new Map();
  for (const item of items) {
    const id = actorID(item.turn);
    if (!index.has(id)) {
      const group = { actorId: id, items: [] };
      index.set(id, group);
      groups.push(group);
    }
    index.get(id).items.push(item);
  }
  const controlsAllowed = access === 'member_active';
  const targetCurrent = (id) => targetAuthority?.current !== true
    || !(targetAuthority.actorIDs instanceof Set)
    || targetAuthority.actorIDs.has(id);
  return <div className={`agent-wait-dock${collapsed ? ' is-collapsed' : ''}`}>
    <section className={`agent-wait-layer${collapsed ? ' is-collapsed' : ''}`} aria-label="等待区">
      <header className="agent-wait-header">
        <strong>{turns.length} 条等待消息</strong>
        <button type="button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? '展开' : '收起'}</button>
      </header>
      {!collapsed && groups.map((group) => <section className="agent-wait-group" key={group.actorId || 'unknown'} data-agent-id={group.actorId}>
        {groups.length > 1 && <header><strong>{actorNameFromMap(group.actorId, names)}</strong></header>}
        <ol>{group.items.map(({ turn, exiting }) => {
          const capabilityState = editLeaseCapabilityState(capabilityIndex.get(group.actorId));
          const canControl = !exiting && controlsAllowed && targetCurrent(group.actorId);
          return <li
            key={turn.requestId}
            className={`agent-wait-item${editing?.targetId === turn.requestId ? ' is-editing' : ''}${exiting ? ' is-handoff-exiting' : ''}`}
            data-request-id={turn.requestId}
            aria-hidden={exiting ? 'true' : undefined}
          >
            <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{messageText(turn)}</strong></div>
            {!exiting && <div className="agent-wait-actions">
              {!targetCurrent(group.actorId) && <span className="agent-wait-paused">收件人已离席</span>}
              {canControl && <button type="button" onClick={() => onControl?.(turn, group.actorId, TYPES.agentSteer, { target: turn.requestId })}>插入</button>}
              {canControl && capabilityState === 'supported' && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit?.(turn, group.actorId)}>编辑</button>}
              {canControl && capabilityState === 'unknown' && <span className="agent-wait-paused">正在确认编辑能力</span>}
              {canControl && <button type="button" onClick={() => onCancel?.(state.channelId, turn.requestId, turn.request?.sender?.id !== selfId)}>取消</button>}
            </div>}
          </li>;
        })}</ol>
      </section>)}
    </section>
  </div>;
}

export function useWaitingEditingController({
  state,
  pending,
  selfId,
  access,
  waitingRosterAuthority,
  capabilityIndex,
  roster,
  onRequestCapability,
  onTaskControl,
  onComposerEditChange,
}) {
  const [editing, setEditing] = useState(null);
  const editingRef = useRef(null);
  const [editNotice, setEditNotice] = useState('');
  const [resumePin, setResumePin] = useState('');
  const editingTargetId = editing?.targetId || resumePin;
  const controlVersion = Number(state?._timelineControlVersion || state?._timelineRevision || 0);
  const queuedTurns = useMemo(
    () => queuedTurnsOf(state, editingTargetId),
    [controlVersion, editingTargetId, state],
  );
  const timelineLocalEchoes = useMemo(() => pending || [], [pending]);
  const timelineControl = useMemo(() => {
    const preempted = new Map();
    const merged = new Map();
    for (const entry of state?.timeline || []) {
      if (entry?.kind !== 'turn') continue;
      const turn = entry.turn;
      const preemptedBy = String(terminalRetainedValue(turn, 'preempted_by') || '');
      const mergedInto = String(terminalRetainedValue(turn, 'merged_into') || '');
      if (preemptedBy) preempted.set(preemptedBy, [...(preempted.get(preemptedBy) || []), turn]);
      if (mergedInto) merged.set(mergedInto, (merged.get(mergedInto) || 0) + 1);
    }
    return { preempted, merged };
  }, [controlVersion, state]);

  useLayoutEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => { setEditNotice(''); }, [state.channelId]);
  useEffect(() => {
    if (!onRequestCapability) return;
    for (const turn of queuedTurns) {
      const id = actorID(turn);
      if (id && editLeaseCapabilityState(capabilityIndex.get(id)) === 'unknown') {
        onRequestCapability(id, state.channelId);
      }
    }
  }, [capabilityIndex, onRequestCapability, queuedTurns, state.channelId]);

  async function release(session) {
    if (!session?.holdId) return false;
    await onTaskControl?.({
      channelId: session.channelId,
      turn: timelineTurn(state, session.targetId),
      actorId: session.actorId,
      type: TYPES.agentUnhold,
      messageId: session.releaseMessageId,
      payload: exactHoldPayload({}, session.holdId),
    });
    return true;
  }

  async function startEditing(turn, id) {
    if (editing) return;
    const capabilityState = editLeaseCapabilityState(capabilityIndex.get(id));
    if (capabilityState !== 'supported') {
      setEditNotice(capabilityState === 'unknown' ? '正在确认 Agent 编辑能力，请稍候' : '当前 Agent 不支持安全编辑');
      return;
    }
    const draft = {
      sessionId: newId(),
      releaseMessageId: newId(),
      channelId: state.channelId,
      targetId: turn.requestId,
      actorId: id,
      holdId: '',
      location: latestStage(turn),
      oldText: messageText(turn),
      text: messageText(turn),
      attachments: argsOf(turn.request).attachments || [],
      phase: 'requesting_lock',
      error: '',
    };
    setEditing(draft);
    try {
      const holdId = await onTaskControl?.({
        channelId: state.channelId,
        turn,
        actorId: id,
        type: TYPES.agentHold,
        payload: { target: turn.requestId },
      });
      if (!holdId) throw new Error('无法锁定这条任务');
      setEditing((current) => current?.sessionId === draft.sessionId
        ? { ...current, holdId, phase: 'editing' }
        : current);
    } catch (error) {
      setEditing((current) => current?.sessionId === draft.sessionId
        ? { ...current, phase: 'editing', error: error?.message || String(error) }
        : current);
    }
  }

  async function verifyAndSave(nextText) {
    const session = editingRef.current;
    if (!session || session.phase !== 'editing' || !session.holdId) return false;
    const text = typeof nextText === 'string' ? nextText : session.text;
    setEditing((current) => current?.sessionId === session.sessionId
      ? { ...current, text, phase: 'saving', error: '' }
      : current);
    try {
      const replacementId = await onTaskControl?.({
        channelId: session.channelId,
        turn: timelineTurn(state, session.targetId),
        actorId: session.actorId,
        type: TYPES.agentReplace,
        payload: exactHoldPayload({
          target: session.targetId,
          old_text: session.oldText,
          new_text: text,
          ...(session.attachments.length ? { attachments: session.attachments } : {}),
        }, session.holdId),
      });
      await release(session);
      setResumePin(String(replacementId || ''));
      setEditing(null);
      return true;
    } catch (error) {
      setEditing((current) => current?.sessionId === session.sessionId
        ? { ...current, phase: 'editing', error: error?.message || String(error) }
        : current);
      return false;
    }
  }

  async function abandonEditing() {
    const session = editingRef.current;
    if (!session) return;
    setEditing(null);
    try { await release(session); }
    catch (error) { setEditNotice(error?.message || String(error)); }
  }

  useEffect(() => {
    if (!resumePin) return;
    const turn = timelineTurn(state, resumePin);
    if (!turn || turn.terminal || latestStage(turn) === 'timeline') setResumePin('');
  }, [controlVersion, resumePin, state]);
  useLayoutEffect(() => {
    onComposerEditChange?.(editing
      ? { session: editing, onSave: verifyAndSave, onAbandon: abandonEditing }
      : null);
  }, [editing?.targetId, editing?.phase, editing?.error, onComposerEditChange]);
  useEffect(() => () => {
    const session = editingRef.current;
    if (session?.holdId) void release(session);
    onComposerEditChange?.(null);
  }, [onComposerEditChange, state.channelId]);

  return {
    editingTargetId,
    presentationEditing: editing,
    resumePin,
    timelineLocalEchoes,
    queuedTurns,
    frozenByActor: EMPTY_FROZEN_STATES,
    preemptedSources: timelineControl.preempted,
    mergedCounts: timelineControl.merged,
    editNotice,
    startEditing,
    verifyAndSave,
    abandonEditing,
    onEditText(text) {
      setEditing((current) => current ? { ...current, text, error: '' } : current);
    },
  };
}
