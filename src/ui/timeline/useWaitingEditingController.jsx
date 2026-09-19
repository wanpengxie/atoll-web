import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { argsOf } from '../../protocol/envelope.js';
import { TYPES } from '../../protocol/vocab.js';
import { newId } from '../../util/id.js';

const WAITING_HANDOFF_DURATION_MS = 180;
const AGENT_MESSAGE_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue]);
const WAITING_SUBMISSION_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain']);

function exactHoldPayload(payload, holdId) {
  if (typeof holdId !== 'string' || !holdId) throw new Error('编辑控制缺少 exact hold owner');
  return { ...payload, expected_hold_id: holdId };
}

function supportsLeaseCAS(capability, type) {
  return Boolean(capability?.describe?.types?.get(type)?.inputSchema?.properties?.expected_hold_id);
}

function capabilityWordState(capability, type) {
  if (!capability?.describe) return capability?.error ? 'unavailable' : 'unknown';
  return capability.describe.types?.has?.(type) ? 'supported' : 'unsupported';
}

function supportsEditLeaseCAS(capability) {
  return supportsLeaseCAS(capability, TYPES.agentReplace)
    && supportsLeaseCAS(capability, TYPES.agentUnhold);
}

function editLeaseCapabilityState(capability) {
  if (!capability?.describe) return capability?.error ? 'unavailable' : 'unknown';
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
  const visit = (entry) => {
    if (entry?.kind === 'turn') {
      const turn = entry.turn;
      if (turn.requestId !== editingTargetId && latestStage(turn) === 'queued') turns.push(turn);
    }
    for (const child of entry?.thread || []) visit(child);
  };
  for (const entry of state?.timeline || []) visit(entry);
  return turns;
}

function isWaitingSubmission(row, channelId) {
  return Boolean(row?.messageId
    && (!row.channelId || row.channelId === channelId)
    && WAITING_SUBMISSION_STATES.has(row.state)
    && AGENT_MESSAGE_TYPES.has(row.frame?.msg_type));
}

function pendingWaitingTurns(state, pending, editingTargetId) {
  const turns = [];
  for (const row of pending || []) {
    if (!isWaitingSubmission(row, state?.channelId)
      || row.messageId === editingTargetId
      || state?._envelopesById?.has?.(row.messageId)) continue;
    const frame = row.frame || {};
    const body = Object.prototype.hasOwnProperty.call(frame.payload || {}, 'body')
      ? frame.payload
      : { body: frame.payload || { text: row.text || '' } };
    const request = {
      id: row.messageId,
      type: frame.msg_type,
      kind: frame.kind || 'request',
      payload: body,
      audience: frame.audience || [],
      parent_id: frame.parent_id || '',
      visibility: frame.visibility || 'public',
      ts: row.createdAt || Date.now(),
      sender: { id: '', kind: 'human' },
      local_submission_state: row.state,
    };
    turns.push({
      requestId: request.id,
      request,
      requestSeq: 0,
      lastSeq: 0,
      provisional: [],
      terminal: null,
      terminalSeq: 0,
      status: 'local',
      local: true,
      waitingPresentation: row.state === 'transmitting'
        ? 'transmitting'
        : ['accepted', 'uncertain'].includes(row.state) ? 'confirming' : 'stored-local',
    });
  }
  return turns;
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
  const controlsAllowed = access === 'member_active' || access === 'member'
    || (access?.relationship === 'member' && access?.unavailable !== true);
  const targetCurrentness = (id) => targetAuthority?.current !== true
    || !(targetAuthority.actorIDs instanceof Set)
    ? 'unknown'
    : targetAuthority.actorIDs.has(id) ? 'current' : 'departed';
  return <div className={`agent-wait-dock${collapsed ? ' is-collapsed' : ''}`}>
    <section className={`agent-wait-layer${collapsed ? ' is-collapsed' : ''}`} aria-label="等待区">
      <header className="agent-wait-header">
        <strong>{turns.length} 条等待消息</strong>
        <button type="button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? '展开' : '收起'}</button>
      </header>
      {!collapsed && groups.map((group) => <section className="agent-wait-group" key={group.actorId || 'unknown'} data-agent-id={group.actorId}>
        {groups.length > 1 && <header><strong>{actorNameFromMap(group.actorId, names)}</strong></header>}
        <ol>{group.items.map(({ turn, exiting }) => {
          const capability = capabilityIndex.get(group.actorId);
          const capabilityState = editLeaseCapabilityState(capability);
          const steerState = capabilityWordState(capability, TYPES.agentSteer);
          const currentness = targetCurrentness(group.actorId);
          const localStateLabel = turn.waitingPresentation === 'stored-local'
            ? '已保存在本机'
            : turn.waitingPresentation === 'transmitting'
              ? '正在发送'
              : turn.waitingPresentation === 'confirming' ? '等待账本确认' : '';
          const canControl = !exiting && !turn.local && controlsAllowed && currentness === 'current';
          return <li
            key={turn.requestId}
            className={`agent-wait-item${editing?.targetId === turn.requestId ? ' is-editing' : ''}${exiting ? ' is-handoff-exiting' : ''}`}
            data-request-id={turn.requestId}
            aria-hidden={exiting ? 'true' : undefined}
          >
            <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{messageText(turn)}</strong></div>
            {!exiting && <div className="agent-wait-actions">
              {localStateLabel && <span className="agent-wait-local-state">{localStateLabel}</span>}
              {!turn.local && currentness === 'unknown' && <span className="agent-wait-paused">正在核验收件人</span>}
              {!turn.local && currentness === 'departed' && <span className="agent-wait-paused">收件人已离席</span>}
              {canControl && steerState === 'supported' && <button type="button" onClick={() => onControl(turn, group.actorId, TYPES.agentSteer, { target: turn.requestId })}>插入到此处</button>}
              {canControl && steerState === 'unknown' && <span className="agent-wait-paused">正在确认插入能力</span>}
              {canControl && ['unsupported', 'unavailable'].includes(steerState) && <span className="agent-wait-paused">Agent 不支持插入</span>}
              {canControl && capabilityState === 'supported' && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, group.actorId)}>编辑</button>}
              {canControl && capabilityState === 'unknown' && <span className="agent-wait-paused">正在确认编辑能力</span>}
              {canControl && ['unsupported', 'unavailable'].includes(capabilityState) && <span className="agent-wait-paused">Agent 不支持安全编辑</span>}
              {canControl && <button type="button" onClick={() => onCancel(state.channelId, turn.requestId, turn.request?.sender?.id !== selfId)}>取消</button>}
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
  capabilityIndex,
  onRequestCapability,
  onTaskControl,
  onComposerEditChange,
}) {
  const [editing, setEditing] = useState(null);
  const editingRef = useRef(null);
  const sessionOwnersRef = useRef(new Map());
  const releasePendingRef = useRef(new Set());
  const releaseAcceptedRef = useRef(new Set());
  const releaseInFlightRef = useRef(new Map());
  const [editNotice, setEditNotice] = useState('');
  const [resumePin, setResumePin] = useState('');
  const editingTargetId = editing?.targetId || '';
  const editingReplacementId = editing?.replacementId || resumePin;
  const waitingEditingTargetId = editing?.holdId ? editing.targetId : '';
  const controlVersion = Number(state?._timelineControlVersion || state?._timelineRevision || 0);
  const queuedTurns = useMemo(() => [
    ...queuedTurnsOf(state, waitingEditingTargetId),
    ...pendingWaitingTurns(state, pending, waitingEditingTargetId),
  ].sort((left, right) => Number(left.requestSeq || left.request?.ts || 0)
    - Number(right.requestSeq || right.request?.ts || 0)), [controlVersion, pending, state, waitingEditingTargetId]);
  const timelineLocalEchoes = useMemo(
    () => (pending || []).filter((row) => !isWaitingSubmission(row, state?.channelId)),
    [pending, state?.channelId],
  );

  useLayoutEffect(() => { editingRef.current = editing; }, [editing]);
  useLayoutEffect(() => {
    if (!editing || editing.channelId === state.channelId) return;
    editingRef.current = null;
    setEditing(null);
    void release(editing).catch(() => {});
  }, [editing?.channelId, state.channelId]);
  useEffect(() => { setEditNotice(''); }, [state.channelId]);
  useEffect(() => {
    if (typeof onRequestCapability !== 'function') throw new TypeError('Waiting 能力 owner 未连接');
    for (const turn of queuedTurns) {
      const id = actorID(turn);
      if (id && editLeaseCapabilityState(capabilityIndex.get(id)) === 'unknown') {
        onRequestCapability(id, state.channelId);
      }
    }
  }, [capabilityIndex, onRequestCapability, queuedTurns, state.channelId]);

  function release(session, targetTurn = null) {
    if (!session) return Promise.resolve(false);
    if (releaseAcceptedRef.current.has(session.sessionId)) return Promise.resolve(true);
    const active = releaseInFlightRef.current.get(session.sessionId);
    if (active) return active;
    if (!session.holdId) {
      releasePendingRef.current.add(session.sessionId);
      return Promise.resolve(false);
    }
    const owner = sessionOwnersRef.current.get(session.sessionId);
    if (!owner || typeof owner.onTaskControl !== 'function') {
      return Promise.reject(new Error('编辑锁释放 owner 已失效'));
    }
    releasePendingRef.current.delete(session.sessionId);
    const operation = Promise.resolve(owner.onTaskControl({
      channelId: session.channelId,
      turn: timelineTurn(owner.state, session.targetId) || targetTurn,
      actorId: session.actorId,
      type: TYPES.agentUnhold,
      messageId: session.releaseMessageId,
      payload: exactHoldPayload({}, session.holdId),
    })).then((releaseId) => {
      if (!releaseId) throw new Error('解除编辑锁请求未进入发送队列');
      releaseAcceptedRef.current.add(session.sessionId);
      sessionOwnersRef.current.delete(session.sessionId);
      return true;
    }).finally(() => {
      if (releaseInFlightRef.current.get(session.sessionId) === operation) {
        releaseInFlightRef.current.delete(session.sessionId);
      }
    });
    releaseInFlightRef.current.set(session.sessionId, operation);
    return operation;
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
    const owner = { state, onTaskControl };
    sessionOwnersRef.current.set(draft.sessionId, owner);
    editingRef.current = draft;
    setEditing(draft);
    try {
      if (typeof owner.onTaskControl !== 'function') throw new Error('编辑控制 owner 未连接');
      const holdId = await owner.onTaskControl({
        channelId: state.channelId,
        turn,
        actorId: id,
        type: TYPES.agentHold,
        payload: { target: turn.requestId },
      });
      if (!holdId) throw new Error('无法锁定这条任务');
      const locked = { ...draft, holdId, phase: 'editing' };
      if (releasePendingRef.current.has(draft.sessionId)
        || editingRef.current?.sessionId !== draft.sessionId) {
        await release(locked, turn);
        return;
      }
      editingRef.current = locked;
      setEditing((current) => current?.sessionId === draft.sessionId ? locked : current);
    } catch (error) {
      sessionOwnersRef.current.delete(draft.sessionId);
      if (editingRef.current?.sessionId !== draft.sessionId) return;
      editingRef.current = null;
      setEditing((current) => current?.sessionId === draft.sessionId ? null : current);
      setEditNotice(error?.message || String(error));
    }
  }

  async function verifyAndSave(nextText) {
    const session = editingRef.current;
    if (!session || session.phase !== 'editing' || !session.holdId) return false;
    const text = typeof nextText === 'string' ? nextText : session.text;
    const saving = { ...session, text, phase: 'saving', error: '' };
    editingRef.current = saving;
    setEditing((current) => current?.sessionId === session.sessionId ? saving : current);
    try {
      const owner = sessionOwnersRef.current.get(session.sessionId);
      if (typeof owner?.onTaskControl !== 'function') throw new Error('编辑控制 owner 已失效');
      const replacementId = await owner.onTaskControl({
        channelId: session.channelId,
        turn: timelineTurn(owner.state, session.targetId),
        actorId: session.actorId,
        type: TYPES.agentReplace,
        payload: exactHoldPayload({
          target: session.targetId,
          old_text: session.oldText,
          new_text: text,
          ...(session.attachments.length ? { attachments: session.attachments } : {}),
        }, session.holdId),
      });
      if (!replacementId) throw new Error('修改请求未进入发送队列');
      const releasing = { ...saving, replacementId: String(replacementId), phase: 'releasing' };
      editingRef.current = releasing;
      setEditing((current) => current?.sessionId === session.sessionId ? releasing : current);
      await release(releasing);
      setResumePin(releasing.replacementId);
      editingRef.current = null;
      setEditing((current) => current?.sessionId === session.sessionId ? null : current);
      return true;
    } catch (error) {
      const current = editingRef.current;
      if (current?.sessionId !== session.sessionId) return false;
      const failed = {
        ...current,
        phase: current.replacementId ? 'releasing' : 'editing',
        error: error?.message || String(error),
      };
      editingRef.current = failed;
      setEditing((value) => value?.sessionId === session.sessionId ? failed : value);
      return false;
    }
  }

  async function abandonEditing() {
    const session = editingRef.current;
    if (!session) return;
    const releasing = { ...session, phase: 'releasing', error: '' };
    editingRef.current = releasing;
    setEditing((current) => current?.sessionId === session.sessionId ? releasing : current);
    try {
      const released = await release(releasing);
      if (!released) return;
      if (releasing.replacementId) setResumePin(releasing.replacementId);
      editingRef.current = null;
      setEditing((current) => current?.sessionId === session.sessionId ? null : current);
    } catch (error) {
      const failed = { ...releasing, error: error?.message || String(error) };
      editingRef.current = failed;
      setEditing((current) => current?.sessionId === session.sessionId ? failed : current);
    }
  }

  useEffect(() => {
    if (!resumePin) return;
    const turn = timelineTurn(state, resumePin);
    if (!turn || turn.terminal || latestStage(turn) === 'timeline') setResumePin('');
  }, [controlVersion, resumePin, state]);
  useLayoutEffect(() => {
    onComposerEditChange(editing?.holdId
      ? { session: editing, onSave: verifyAndSave, onAbandon: abandonEditing }
      : null);
  }, [editing?.targetId, editing?.phase, editing?.error, onComposerEditChange]);
  useEffect(() => () => {
    const session = editingRef.current;
    editingRef.current = null;
    if (session) void release(session).catch(() => {});
    onComposerEditChange(null);
  }, [onComposerEditChange, state.channelId]);

  return {
    editingTargetId,
    editingReplacementId,
    presentationEditing: editing,
    timelineLocalEchoes,
    queuedTurns,
    editNotice,
    startEditing,
  };
}
