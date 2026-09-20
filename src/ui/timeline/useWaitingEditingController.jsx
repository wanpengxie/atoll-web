import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { actorNameFromMap } from '../../model/actor-display.js';
import { argsOf, PROVISIONAL } from '../../protocol/envelope.js';
import { TYPES } from '../../protocol/vocab.js';
import { newId } from '../../util/id.js';

const WAITING_HANDOFF_DURATION_MS = 180;
const WAITING_HANDOFF_LEDGER_LIMIT = 512;
const WAITING_MESSAGE_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue]);
const AGENT_CONTENT_TYPES = new Set([
  TYPES.agentAsk,
  TYPES.agentQueue,
  TYPES.agentCompact,
  TYPES.agentNew,
  TYPES.agentReplace,
  TYPES.agentSteer,
]);
const WAITING_SUBMISSION_STATES = new Set(['queued', 'transmitting', 'accepted', 'delayed', 'uncertain']);
const CORE_CONTROL_WORDS = new Set([
  TYPES.agentReplace,
  TYPES.agentInterrupt,
  TYPES.agentSteer,
  TYPES.agentDismiss,
]);
const DEFAULT_HOLD_DURATION_MS = 30 * 60 * 1000;

function exactHoldPayload(payload, holdId) {
  if (typeof holdId !== 'string' || !holdId) throw new Error('编辑控制缺少 exact hold owner');
  return { ...payload, expected_hold_id: holdId };
}

function supportsLeaseCAS(capability, type) {
  return Boolean(capability?.describe?.types?.get(type)?.inputSchema?.properties?.expected_hold_id);
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

function latestStatusFrame(turn) {
  return [...(turn?.provisional || [])]
    .sort((left, right) => Number(right.seq || 0) - Number(left.seq || 0))
    .map((item) => argsOf(item.envelope))
    .find((payload) => ['queued', 'processing'].includes(payload?.status)) || null;
}

function controlEntries(frame) {
  if (!Array.isArray(frame?.controls)) return [];
  return frame.controls.filter((entry) => entry && typeof entry.word === 'string' && entry.word);
}

function controlsAllowed(access) {
  return access === 'member_active' || access === 'member'
    || (access?.relationship === 'member' && access?.unavailable !== true);
}

function targetCurrentness(turn, authority) {
  const id = actorID(turn);
  if (!id || authority?.current !== true || !(authority.actorIDs instanceof Set)) return 'unknown';
  return authority.actorIDs.has(id) ? 'current' : 'departed';
}

function waitingControlContext(turn, { selfId, access, targetAuthority }) {
  const request = turn?.request;
  const open = Boolean(request && !turn.terminal && !turn.local);
  const writable = controlsAllowed(access);
  const owned = Boolean(selfId && request?.sender?.id === selfId);
  const frame = latestStatusFrame(turn);
  const location = String(frame?.status || '');
  const controls = open ? controlEntries(frame) : [];
  const words = new Set(controls.map((entry) => entry.word));
  const dismissPayload = controlPayload({ controls }, TYPES.agentDismiss);
  const steerPayload = controlPayload({ controls }, TYPES.agentSteer);
  const currentness = targetCurrentness(turn, targetAuthority);
  const callerCancelEligible = open && writable && owned && location === 'queued';
  const targetControlsEligible = open && writable && currentness === 'current';
  return {
    controls,
    targetCurrentness: currentness,
    targetControlsEligible,
    steering: Boolean(frame?.steering),
    canCancel: callerCancelEligible
      || (targetControlsEligible && location === 'queued' && words.has(TYPES.agentDismiss)
        && Boolean(dismissPayload)),
    cancelsAsDismiss: !callerCancelEligible && targetControlsEligible && !owned
      && Boolean(dismissPayload),
    canInsert: targetControlsEligible && words.has(TYPES.agentSteer) && Boolean(steerPayload),
    canEdit: targetControlsEligible && words.has(TYPES.agentReplace),
  };
}

function extraControls(context) {
  if (!context?.targetControlsEligible) return [];
  return context.controls.filter((entry) => !CORE_CONTROL_WORDS.has(entry.word)
    && Boolean(controlPayload(context, entry)));
}

function controlLabel(entry) {
  return entry.label || entry.word.split('.').pop();
}

function controlPayload(context, entryOrWord) {
  const entry = typeof entryOrWord === 'string'
    ? context?.controls?.find((candidate) => candidate.word === entryOrWord)
    : entryOrWord;
  return entry?.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload)
    ? { ...entry.payload }
    : null;
}

function allTimelineTurns(state) {
  const turns = [];
  const visit = (entry) => {
    if (entry?.kind === 'turn' && entry.turn) turns.push(entry.turn);
    for (const child of entry?.thread || []) visit(child);
  };
  for (const entry of state?.timeline || []) visit(entry);
  return turns;
}

function timelineMaxSeq(state) {
  let max = 0;
  const observe = (value) => {
    const seq = Number(value);
    if (Number.isFinite(seq)) max = Math.max(max, seq);
  };
  for (const turn of allTimelineTurns(state)) {
    observe(turn.requestSeq);
    observe(turn.terminalSeq);
  }
  return max;
}

function contextTargetKey(turn) {
  if (!turn) return '';
  const frame = latestStatusFrame(turn);
  const terminal = argsOf(turn.terminal);
  const controls = Array.isArray(frame?.controls)
    ? frame.controls.map((entry) => String(entry?.word || '')).filter(Boolean).join(',')
    : '';
  return [
    String(turn.requestId || turn.request?.id || ''),
    String(turn.request?.type || ''),
    String(turn.requestSeq || ''),
    String(turn.terminalSeq || ''),
    String(turn.status || ''),
    String(turn.latestStatus || ''),
    String(frame?.seq || ''),
    String(frame?.status || ''),
    controls,
    String(turn.terminal?.id || ''),
    String(terminal?.status || ''),
    String(terminal?.error_code || ''),
    String(terminal?.replaced_by || ''),
    messageText(turn),
  ].join('\u001f');
}

function terminalCompleted(turn) {
  // A compact terminal closure retains status/identity only.  Its business
  // result is intentionally unavailable, so it cannot authoritatively prove
  // that a control operation completed (notably unhold released=true).
  return turn?.terminalClosureOnly !== true
    && argsOf(turn?.terminal)?.status === 'completed';
}

function requestTimestamp(request) {
  const numeric = Number(request?.ts);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(request?.ts || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function holdDeadline(turn) {
  const requested = Number(argsOf(turn?.request)?.duration_ms);
  const duration = Number.isSafeInteger(requested) && requested >= 1 && requested <= DEFAULT_HOLD_DURATION_MS
    ? requested
    : DEFAULT_HOLD_DURATION_MS;
  return requestTimestamp(turn?.request) + duration;
}

function resumedQueuedForHold(turn, holdId) {
  const expected = String(holdId || '');
  if (!expected) return false;
  return [...(turn?.provisional || [])]
    .sort((left, right) => Number(right.seq || 0) - Number(left.seq || 0))
    .some((item) => {
      const body = argsOf(item.envelope);
      return body?.status === 'queued'
        && body.resumed === true
        && String(body.held_by || '') === expected;
    });
}

function holdAdmissionReady(turn, holdId, location) {
  return location !== 'processing' || resumedQueuedForHold(turn, holdId);
}

// Waiting no longer receives a second frozen-state store. Rebuild the visual
// pause fact from this channel replica's own control turns and progress seqs.
function heldActors(state, now = Date.now()) {
  const operations = [];
  const holdOwners = new Map();
  for (const turn of allTimelineTurns(state)) {
    const id = actorID(turn);
    if (!id) continue;
    const type = turn.request?.type;
    if (terminalCompleted(turn) && type === TYPES.agentHold) {
      operations.push({ actorId: id, seq: Number(turn.requestSeq || 0), kind: 'freeze', source: 'hold', turn });
      holdOwners.set(turn.requestId, id);
    } else if (terminalCompleted(turn) && type === TYPES.agentUnhold
      && argsOf(turn.terminal)?.released !== false) {
      operations.push({ actorId: id, seq: Number(turn.requestSeq || 0), kind: 'release' });
    } else if (terminalCompleted(turn) && type === TYPES.agentInterrupt) {
      operations.push({ actorId: id, seq: Number(turn.requestSeq || 0), kind: 'freeze', source: 'interrupt', turn });
    }
    if (!AGENT_CONTENT_TYPES.has(type)) continue;
    const enteredBuffer = (turn.provisional || []).some((item) => {
      const body = argsOf(item.envelope);
      return body?.status === 'queued' && body.resumed !== true;
    });
    const capacityFailure = argsOf(turn.terminal)?.status === 'failed'
      && argsOf(turn.terminal)?.error_code === 'base_capacity';
    if (type !== TYPES.agentReplace && (enteredBuffer || capacityFailure)) {
      operations.push({ actorId: id, seq: Number(turn.requestSeq || 0), kind: 'new-content' });
    }
    // A processing progress row is not automatically queue advancement.  A
    // normalized row may carry the explicit `core` marker, while public
    // timeline rows often expose only the status body, so infer core only when
    // that marker is absent.  This preserves a core status transition
    // (queued -> processing) while ignoring business progress such as
    // tool.started between two processing rows.
    let coreStatus = '';
    const provisional = [...(turn.provisional || [])]
      .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0));
    for (const item of provisional) {
      const body = argsOf(item.envelope);
      const status = item.status || body?.status;
      const isCore = item.core === true
        || (item.core == null && PROVISIONAL.has(status));
      if (!isCore) continue;
      if (status === 'processing' && coreStatus !== 'processing') {
        operations.push({ actorId: id, seq: Number(item.seq || 0), kind: 'advanced' });
      }
      coreStatus = status;
    }
    if (argsOf(turn.terminal)?.merged_into) {
      operations.push({ actorId: id, seq: Number(turn.terminalSeq || 0), kind: 'advanced' });
    }
  }
  if (holdOwners.size && state?.rows?.entries) {
    for (const [seq, envelope] of state.rows.entries()) {
      if (envelope?.kind !== 'event' || envelope.type !== TYPES.agentHoldExpired) continue;
      const holdId = String(argsOf(envelope)?.hold_id || '');
      const actorId = holdOwners.get(holdId);
      if (actorId) operations.push({ actorId, seq: Number(seq || 0), kind: 'expire', holdId });
    }
  }
  operations.sort((left, right) => left.seq - right.seq);
  const frozen = new Map();
  for (const operation of operations) {
    const current = frozen.get(operation.actorId);
    if (operation.kind === 'freeze') {
      const restore = operation.source === 'hold'
        ? (current?.source === 'interrupt' ? current : current?.restore || null)
        : null;
      frozen.set(operation.actorId, {
        holdId: operation.turn.requestId,
        until: operation.source === 'interrupt' ? Number.POSITIVE_INFINITY : holdDeadline(operation.turn),
        source: operation.source,
        restore,
        seq: operation.seq,
      });
    } else if (operation.kind === 'release') {
      if (current?.source === 'hold') {
        if (current.restore) frozen.set(operation.actorId, current.restore);
        else frozen.delete(operation.actorId);
      }
    } else if (operation.kind === 'advanced' || operation.kind === 'new-content') {
      if (current && operation.seq > current.seq) frozen.delete(operation.actorId);
    } else if (operation.kind === 'expire'
      && current?.source === 'hold'
      && current.holdId === operation.holdId) {
      if (current.restore) frozen.set(operation.actorId, current.restore);
      else frozen.delete(operation.actorId);
    }
  }
  for (const [id, hold] of frozen) {
    if (!(Number(now) < hold.until)) {
      if (hold.source === 'hold' && hold.restore) frozen.set(id, hold.restore);
      else frozen.delete(id);
    }
  }
  return frozen;
}

function latestStage(turn) {
  if (turn?.terminal) return 'timeline';
  const status = [...(turn?.provisional || [])]
    .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
    .map((item) => String(argsOf(item.envelope)?.status || ''))
    .filter(Boolean).at(-1);
  if (status === 'processing') return 'processing';
  if (['received', 'queued', 'deferred'].includes(status)) return 'queued';
  // A request type names the protocol operation, not its lifecycle position.
  // Waiting is admitted only by an explicit non-terminal position fact; a
  // canonical request with no provisional status must stay out until Replica
  // receives that fact. Local durable submissions use pendingWaitingTurns and
  // therefore do not rely on this canonical-lifecycle guard.
  return '';
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
    && WAITING_MESSAGE_TYPES.has(row.frame?.msg_type));
}

function pendingWaitingTurns(state, pending, editingTargetId) {
  const turns = [];
  for (const row of pending || []) {
    if (!isWaitingSubmission(row, state?.channelId) || row.messageId === editingTargetId) continue;
    const canonical = timelineTurn(state, row.messageId);
    // A local submission may be visible in Replica before its first lifecycle
    // provisional arrives. Keep that same canonical request visible through
    // the landing edge; only an explicit queued/received/deferred or terminal
    // fact may replace/release the local Waiting continuity. The pending
    // identity is the authority for this bridge, so an unrelated remote open
    // request still stays excluded by latestStage/queuedTurnsOf.
    if (canonical
      && !canonical.terminal
      && (!canonical.provisional || canonical.provisional.length === 0)
      && latestStage(canonical) === '') {
      turns.push({
        ...canonical,
        waitingPresentation: row.state === 'transmitting'
          ? 'transmitting'
          : ['accepted', 'uncertain'].includes(row.state) ? 'confirming' : 'stored-local',
      });
      continue;
    }
    if (state?._envelopesById?.has?.(row.messageId)) continue;
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
  const reducedMotion = useReducedMotionPreference();
  const previousRef = useRef({ channelId, turns: new Map() });
  const completedRef = useRef(new Map());
  const timersRef = useRef(new Map());
  const [settling, setSettling] = useState(() => new Map());
  const currentTurns = useMemo(
    () => new Map(queuedTurns.map((turn, order) => [turn.requestId, { turn, order }])),
    [queuedTurns],
  );
  const presentedIDs = useMemo(() => new Set(presentationRows.map((row) => row.id)), [presentationRows]);
  const sameChannel = previousRef.current.channelId === channelId;
  const fresh = sameChannel ? [...previousRef.current.turns].flatMap(([requestId, entry]) => (
    !currentTurns.has(requestId)
    && presentedIDs.has(requestId)
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
      for (const [id, entry] of fresh) next.set(id, entry);
      return next;
    });
    for (const [id] of fresh) {
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
  return useMemo(() => ({
    exiting: [...visibleHandoffs].map(([requestId, entry]) => ({ requestId, ...entry })),
    enteringRequestIDs: new Set(visibleHandoffs.keys()),
  }), [visibleHandoffs]);
}

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
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
  const [bulk, setBulk] = useState({ actorId: '', error: '' });
  const [collapsed, setCollapsed] = useState(false);
  const channelRef = useRef(state.channelId);
  useLayoutEffect(() => {
    if (channelRef.current === state.channelId) return;
    channelRef.current = state.channelId;
    setBulk({ actorId: '', error: '' });
    setCollapsed(false);
  }, [state.channelId]);
  if (!turns.length && !handoffs.length) return null;
  // A false control-tail authority means these queued rows are cache-only.
  // Do not resurrect their actions or waiting chrome until the committed tail
  // is current again; null/unknown authority still renders its safe read-only
  // verification state below.
  if (targetAuthority?.current === false) return null;
  const presented = [
    ...turns.map((turn, order) => ({ turn, order, exiting: false })),
    ...handoffs.map((entry) => ({ turn: entry.turn, order: entry.order, exiting: true })),
  ].sort((left, right) => left.order - right.order);
  const groups = [];
  const byActor = new Map();
  for (const item of presented) {
    const id = actorID(item.turn);
    if (!byActor.has(id)) {
      const group = { actorId: id, turns: [], items: [] };
      byActor.set(id, group);
      groups.push(group);
    }
    const group = byActor.get(id);
    group.items.push(item);
    if (!item.exiting) group.turns.push(item.turn);
  }
  const frozenByActor = heldActors(state);

  async function cancelTurn(turn, group, context) {
    if (context.cancelsAsDismiss) {
      const payload = controlPayload(context, TYPES.agentDismiss);
      if (!payload) return undefined;
      return onControl(turn, group.actorId, TYPES.agentDismiss, payload);
    }
    return onCancel(state.channelId, turn.requestId, false);
  }

  async function cancelAll(group) {
    if (bulk.actorId) return;
    const ownerChannel = state.channelId;
    const cancellable = group.turns.map((turn) => ({
      turn,
      context: waitingControlContext(turn, { selfId, access, targetAuthority }),
    })).filter(({ context }) => context.canCancel);
    if (!cancellable.length) return;
    setBulk({ actorId: group.actorId, error: '' });
    let holdId = '';
    const failures = [];
    try {
      holdId = await onControl(cancellable[0].turn, group.actorId, TYPES.agentHold, {});
      if (!holdId) throw new Error('暂停等待区失败');
      for (const { turn, context } of cancellable) {
        try {
          await cancelTurn(turn, group, context);
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }
    } catch (error) {
      failures.push(error?.message || String(error));
    } finally {
      if (holdId) {
        try {
          await onControl(
            cancellable[0].turn,
            group.actorId,
            TYPES.agentUnhold,
            exactHoldPayload({}, String(holdId)),
          );
        } catch (error) {
          failures.push(error?.message || String(error));
        }
      }
      if (channelRef.current === ownerChannel) {
        setBulk({ actorId: '', error: failures[0] || '' });
      }
    }
  }

  const soleGroup = groups.length === 1 ? groups[0] : null;
  const hasQueuedEditor = turns.some((turn) => turn.requestId === editing?.targetId);
  const handoffOnly = turns.length === 0;
  return <div className={`agent-wait-dock${collapsed ? ' is-collapsed' : ''}${handoffOnly ? ' is-handoff-only' : ''}`}>
    <section
      className={`agent-wait-layer${collapsed ? ' is-collapsed' : ''}${hasQueuedEditor ? ' is-editing' : ''}${handoffOnly ? ' is-handoff-only' : ''}`}
      aria-label={handoffOnly ? undefined : '等待区'}
      aria-hidden={handoffOnly ? 'true' : undefined}
      inert={handoffOnly ? true : undefined}
    >
      {collapsed && <div className="agent-wait-collapsed"><span aria-hidden="true">↳</span><strong>{turns.length || handoffs.length} 条等待消息</strong>{!handoffOnly && <button type="button" aria-expanded="false" onClick={() => setCollapsed(false)}>展开</button>}</div>}
      {!collapsed && <header className="agent-wait-header" aria-label="等待区操作">
        {!handoffOnly && <div>
          {groups.map((group) => {
            const canInsertAll = group.turns.some((turn) => waitingControlContext(
              turn,
              { selfId, access, targetAuthority },
            ).canInsert);
            return canInsertAll && <button type="button" className="agent-wait-insert-all" key={`insert-${group.actorId}`} onClick={() => onControl(group.turns[0], group.actorId, TYPES.agentSteer, { all: true })}>{soleGroup ? '全部插入' : `插入 ${actorNameFromMap(group.actorId, names)} 全部`}</button>;
          })}
          {groups.map((group) => {
            const canCancelAll = group.turns.some((turn) => waitingControlContext(
              turn,
              { selfId, access, targetAuthority },
            ).canCancel);
            return canCancelAll && <button type="button" className="agent-wait-cancel-all" key={`cancel-${group.actorId}`} disabled={Boolean(bulk.actorId)} onClick={() => cancelAll(group)}>{bulk.actorId === group.actorId ? '正在取消…' : soleGroup ? '全部取消' : `取消 ${actorNameFromMap(group.actorId, names)} 全部`}</button>;
          })}
          <button type="button" onClick={() => setCollapsed(true)}>收起</button>
        </div>}
      </header>}
      {!collapsed && groups.map((group) => {
        const paused = frozenByActor.has(group.actorId);
        return <section className="agent-wait-group" key={group.actorId || 'unknown'} data-agent-id={group.actorId}>
        {!hasQueuedEditor && !soleGroup && <header><strong>{actorNameFromMap(group.actorId, names)}{paused ? '（已暂停）' : ''}</strong></header>}
        <ol>{group.items.map(({ turn, exiting }) => {
          const capability = capabilityIndex.get(group.actorId);
          const capabilityState = editLeaseCapabilityState(capability);
          const context = waitingControlContext(turn, { selfId, access, targetAuthority });
          const session = editing?.targetId === turn.requestId ? editing : null;
          const localStateLabel = turn.waitingPresentation === 'stored-local'
            ? '已保存在本机'
            : turn.waitingPresentation === 'transmitting'
              ? '正在发送'
              : turn.waitingPresentation === 'confirming' ? '等待账本确认' : '';
          return <li
            key={turn.requestId}
            className={`agent-wait-item${session ? ' is-editing' : ''}${exiting ? ' is-handoff-exiting' : ''}`}
            data-request-id={turn.requestId}
            data-handoff-state={exiting ? 'exit' : undefined}
            aria-hidden={exiting ? 'true' : undefined}
            inert={exiting ? true : undefined}
          >
            {exiting
              ? <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{messageText(turn)}</strong></div>
              : session
                ? <><div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{messageText(turn)}</strong></div><span className="agent-wait-editing-label">正在编辑</span></>
                : <>
                  <div className="agent-wait-summary"><span className="agent-wait-position" aria-hidden="true">↳</span><strong>{messageText(turn)}</strong></div>
                  <div className="agent-wait-actions">
                    {localStateLabel && <span className="agent-wait-local-state">{localStateLabel}</span>}
                    {paused && <span className="agent-wait-paused">已暂停</span>}
                    {context.steering && <span className="agent-wait-paused">正在并入…</span>}
                    {!turn.local && context.targetCurrentness === 'unknown' && <span className="agent-wait-paused">正在核验收件人</span>}
                    {!turn.local && context.targetCurrentness === 'departed' && <span className="agent-wait-paused">收件人已离席，等待账本关闭</span>}
                    {context.canInsert && <button type="button" onClick={() => {
                      const payload = controlPayload(context, TYPES.agentSteer);
                      if (payload) onControl(turn, group.actorId, TYPES.agentSteer, payload);
                    }}>插入</button>}
                    {context.canEdit && capabilityState === 'supported' && <button type="button" disabled={Boolean(editing)} onClick={() => onEdit(turn, group.actorId)}>编辑</button>}
                    {context.canEdit && capabilityState === 'unknown' && <span className="agent-wait-paused">正在确认编辑能力</span>}
                    {context.canEdit && ['unsupported', 'unavailable'].includes(capabilityState) && <span className="agent-wait-paused">Agent 不支持安全编辑</span>}
                    {context.canCancel && <button type="button" title={context.cancelsAsDismiss ? '这条不是你发的，将请对方放弃它' : '撤回你自己发出的这条请求'} onClick={() => cancelTurn(turn, group, context)}>取消</button>}
                    {extraControls(context).map((entry) => {
                      const payload = controlPayload(context, entry);
                      return <button key={entry.word} type="button" onClick={() => {
                        if (payload) onControl(turn, group.actorId, entry.word, payload);
                      }}>{controlLabel(entry)}</button>;
                    })}
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
  pending,
  capabilityIndex,
  onRequestCapability,
  onTaskControl,
  onComposerEditChange,
}) {
  const [editing, setEditing] = useState(null);
  const editingRef = useRef(null);
  const sessionOwnersRef = useRef(new Map());
  const sessionLatestOwnersRef = useRef(new Map());
  const sessionStartSeqRef = useRef(new Map());
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
  useLayoutEffect(() => {
    const session = editingRef.current;
    if (!session?.sessionId) return;
    const previous = sessionLatestOwnersRef.current.get(session.sessionId);
    const latestTurn = timelineTurn(state, session.targetId);
    const latest = {
      state,
      onTaskControl,
      contextOwner: previous?.contextOwner || onTaskControl,
      contextTargetKey: previous?.contextTargetKey || contextTargetKey(latestTurn),
    };
    sessionLatestOwnersRef.current.set(session.sessionId, latest);
    if (!session.holdId || session.phase !== 'editing' || !latestTurn) return;
    const committed = sessionOwnersRef.current.get(session.sessionId);
    if (typeof committed?.onTaskControl !== 'function') return;
    const targetKey = contextTargetKey(latestTurn);
    const reconnect = latest.contextOwner !== onTaskControl
      || latest.contextTargetKey !== targetKey;
    if (!reconnect) return;
    latest.contextOwner = onTaskControl;
    latest.contextTargetKey = targetKey;
    // A reconnect may replace the render callback, but it must not replace the
    // callback that acquired the hold.  Context is read-only; its target is
    // always the latest committed turn and its request goes through that
    // original owner.  Mark the handoff before invoking the port so a render
    // caused by the callback cannot issue a duplicate context probe.
    void Promise.resolve().then(() => committed.onTaskControl({
      channelId: session.channelId,
      turn: latestTurn,
      actorId: session.actorId,
      type: TYPES.agentContext,
    })).catch(() => {});
  }, [editing?.holdId, editing?.phase, editing?.sessionId, onTaskControl, state]);
  useEffect(() => {
    const session = editingRef.current;
    if (!session || session.phase !== 'waiting_for_resume' || !session.holdId) return;
    const target = timelineTurn(state, session.targetId);
    if (!holdAdmissionReady(target, session.holdId, session.location)) return;
    const admitted = { ...session, location: 'queued', phase: 'editing' };
    editingRef.current = admitted;
    setEditing((current) => current?.sessionId === session.sessionId ? admitted : current);
  }, [controlVersion, editing?.holdId, editing?.location, editing?.phase, editing?.sessionId, state]);
  useEffect(() => {
    const session = editingRef.current;
    if (!session?.holdId) return;
    const target = timelineTurn(state, session.targetId);
    const terminal = argsOf(target?.terminal);
    const cancelled = target?.terminalClosureOnly !== true
      && terminal?.status === 'failed'
      && (terminal.error_code === 'cancelled' || terminal.cancelled === true);
    if (!cancelled) return;
    // Cancellation is an authoritative target terminal: close the Composer
    // session first, then release only this session's exact hold. The release
    // owner remains the callback captured when the hold was admitted.
    editingRef.current = null;
    setEditing((current) => current?.sessionId === session.sessionId ? null : current);
    setEditNotice('已退出编辑');
    void release(session, target).catch((error) => {
      setEditNotice(`已退出编辑：${error?.message || String(error)}`);
    });
  }, [controlVersion, editing?.holdId, editing?.sessionId, state]);
  useEffect(() => {
    const session = editingRef.current;
    if (!session?.holdId) return;
    const startSeq = sessionStartSeqRef.current.get(session.sessionId) || 0;
    const superseded = allTimelineTurns(state).some((turn) => (
      actorID(turn) === session.actorId
      && terminalCompleted(turn)
      && turn.request?.type === TYPES.agentInterrupt
      && Number(turn.requestSeq || 0) > startSeq
    ));
    if (!superseded) return;
    // Interrupt is a stronger control fact and owns the freeze now. Close the
    // Composer without sending a stale unhold that would fight that control.
    editingRef.current = null;
    sessionOwnersRef.current.delete(session.sessionId);
    sessionLatestOwnersRef.current.delete(session.sessionId);
    sessionStartSeqRef.current.delete(session.sessionId);
    setEditing((current) => current?.sessionId === session.sessionId ? null : current);
    setEditNotice('另一项控制已接管编辑');
  }, [controlVersion, editing?.holdId, editing?.sessionId, state]);
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
    const latest = sessionLatestOwnersRef.current.get(session.sessionId);
    const latestTurn = latest ? timelineTurn(latest.state, session.targetId) : null;
    const operation = Promise.resolve(owner.onTaskControl({
      channelId: session.channelId,
      turn: latestTurn || timelineTurn(owner.state, session.targetId) || targetTurn,
      actorId: session.actorId,
      type: TYPES.agentUnhold,
      messageId: session.releaseMessageId,
      payload: exactHoldPayload({}, session.holdId),
    })).then((releaseId) => {
      if (!releaseId) throw new Error('解除编辑锁请求未进入发送队列');
      releaseAcceptedRef.current.add(session.sessionId);
      sessionOwnersRef.current.delete(session.sessionId);
      sessionLatestOwnersRef.current.delete(session.sessionId);
      sessionStartSeqRef.current.delete(session.sessionId);
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
    sessionLatestOwnersRef.current.set(draft.sessionId, {
      ...owner,
      contextOwner: onTaskControl,
      contextTargetKey: contextTargetKey(timelineTurn(state, draft.targetId) || turn),
    });
    sessionStartSeqRef.current.set(draft.sessionId, timelineMaxSeq(state));
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
      const target = timelineTurn(state, draft.targetId) || turn;
      const locked = {
        ...draft,
        holdId,
        phase: holdAdmissionReady(target, holdId, draft.location) ? 'editing' : 'waiting_for_resume',
      };
      if (releasePendingRef.current.has(draft.sessionId)
        || editingRef.current?.sessionId !== draft.sessionId) {
        await release(locked, turn);
        return;
      }
      editingRef.current = locked;
      setEditing((current) => current?.sessionId === draft.sessionId ? locked : current);
    } catch (error) {
      sessionOwnersRef.current.delete(draft.sessionId);
      sessionLatestOwnersRef.current.delete(draft.sessionId);
      sessionStartSeqRef.current.delete(draft.sessionId);
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
      const owner = sessionLatestOwnersRef.current.get(session.sessionId)
        || sessionOwnersRef.current.get(session.sessionId);
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
    onComposerEditChange(editing?.holdId && editing.phase !== 'waiting_for_resume'
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
