import { useCallback, useEffect, useRef, useState } from 'react';
import { argsOf } from '../../protocol/envelope.js';
import { terminalResultPayload, terminalResultState } from '../../model/terminal-result.js';
import { resolveComposerAgentSelection } from '../../ui/composer/composer-model.js';
import {
  acceptAgentProbe,
  advanceAgentProbeGeneration,
  beginAgentProbe,
  clearProbeSlots,
  createAgentProbeLifecycle,
  failAgentProbe,
  observeAgentProbe,
  PROBE_TIMEOUT_MS,
  releaseAgentProbe,
  reserveProbeSlot,
} from '../../model/agent-probe-lifecycle.js';
import { TYPES } from '../../protocol/vocab.js';

function parseDocument(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function describeOf(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload.value && typeof payload.value === 'object' ? payload.value : payload;
  if (!source.words || typeof source.words !== 'object') return null;
  return {
    className: String(source.class || ''),
    interfaces: Array.isArray(source.interfaces) ? source.interfaces : [],
    capabilities: source.capabilities && typeof source.capabilities === 'object' ? source.capabilities : {},
    types: new Map(Object.entries(source.words).map(([type, raw]) => [type, {
      type,
      description: String(raw?.description || ''),
      inputSchema: parseDocument(raw?.input_schema),
      outputSchema: parseDocument(raw?.output_schema),
      raw: raw || {},
    }])),
    raw: source,
  };
}

// ChannelReplica owns the ledger. Probe state is a read-only projection over
// its public timeline plus the submission owner's explicit pending rows; it
// must not recreate the retired mutable turn index.
function turnIndex(state, requestIds) {
  const wanted = new Set([...requestIds].filter(Boolean));
  const result = new Map();
  const visit = (entry) => {
    if (!entry || !wanted.size) return;
    if (entry.kind === 'turn') {
      const turn = entry.turn;
      if (turn?.requestId && wanted.has(turn.requestId)) {
        result.set(turn.requestId, turn);
        wanted.delete(turn.requestId);
      }
    }
    for (const child of entry.thread || []) visit(child);
  };
  for (const entry of state?.timeline || []) visit(entry);
  return result;
}

function pendingIndex(pending, requestIds) {
  const wanted = new Set(requestIds);
  return new Map((pending || [])
    .filter((row) => wanted.has(row?.messageId))
    .map((row) => [row.messageId, row]));
}

function pendingError(row, fallbackCode) {
  if (row?.state !== 'rejected') return null;
  const error = row.error && typeof row.error === 'object' ? row.error : {};
  return {
    code: String(error.code || fallbackCode),
    detail: String(error.detail || error.message || ''),
  };
}

function operationError(error, fallbackCode, fallbackDetail) {
  const value = error && typeof error === 'object' ? error : {};
  return {
    code: String(value.code || fallbackCode),
    detail: String(value.detail || value.message || fallbackDetail),
  };
}

function probeFact(turns, pendingRows, requestId, expectedType) {
  const turn = turns.get(requestId);
  const submission = pendingRows.get(requestId);
  const matchingSubmission = submission?.frame?.msg_type === expectedType ? submission : null;
  if (turn?.request?.id === requestId && turn.request.type === expectedType) {
    const terminal = turn.terminal?.parent_id === requestId && turn.terminal.type === expectedType
      ? turn.terminal
      : null;
    return { request: turn.request, turn: { ...turn, terminal }, pending: matchingSubmission };
  }
  if (!matchingSubmission) return null;
  return {
    request: {
      id: requestId,
      type: expectedType,
      audience: matchingSubmission.frame.audience,
      ts: matchingSubmission.createdAt,
    },
    turn: null,
    pending: matchingSubmission,
  };
}

function probeFailed(state, pending, requestId, expectedType) {
  if (!requestId) return false;
  const turns = turnIndex(state, [requestId]);
  const pendingRows = pendingIndex(pending, [requestId]);
  const fact = probeFact(turns, pendingRows, requestId, expectedType);
  if (!fact) return false;
  const terminal = argsOf(fact.turn?.terminal);
  if (terminal?.status) return terminal.status === 'failed';
  return Boolean(pendingError(fact.pending, `${expectedType}_failed`));
}

function capabilityIndex(state, liveRequestIds, pending) {
  const result = new Map();
  const requestIds = [...liveRequestIds];
  const turns = turnIndex(state, requestIds);
  const pendingRows = pendingIndex(pending, requestIds);
  const facts = requestIds.map((requestId, order) => {
    const fact = probeFact(turns, pendingRows, requestId, TYPES.describe);
    return fact ? { ...fact, requestId, order } : null;
  }).filter(Boolean).sort((left, right) => {
    const leftAt = Number(left.request?.ts || left.turn?.requestSeq || left.pending?.createdAt || 0);
    const rightAt = Number(right.request?.ts || right.turn?.requestSeq || right.pending?.createdAt || 0);
    return leftAt - rightAt || left.order - right.order;
  });
  for (const fact of facts) {
    const { requestId, request, turn, pending: pendingRow } = fact;
    const actorId = request?.audience?.[0];
    if (!actorId) continue;
    const entry = result.get(actorId) || { actorId, describe: null, loading: false, error: null, requestId: '', seq: 0 };
    entry.requestId = requestId;
    entry.seq = Number(turn?.lastSeq || 0);
    entry.loading = Boolean(turn ? !turn.terminal : pendingRow?.state !== 'rejected');
    if (turn?.terminal) {
      const terminal = terminalResultPayload(turn);
      const outcome = terminalResultState(turn);
      if (terminal?.status === 'completed') {
        const describe = describeOf(terminal);
        if (describe) {
          entry.describe = entry.describe
            ? { ...describe, types: new Map([...entry.describe.types, ...describe.types]) }
            : describe;
          entry.error = null;
        } else entry.error = { code: 'invalid_describe', detail: 'Actor 返回的能力结构无法识别' };
      } else entry.error = { code: terminal?.error_code || terminal?.reason || 'describe_failed', detail: outcome.error || terminal?.detail || '' };
      entry.loading = false;
    } else {
      const rejected = pendingError(pendingRow, 'describe_failed');
      if (rejected) {
        entry.error = rejected;
        entry.loading = false;
      }
    }
    result.set(actorId, entry);
  }
  return result;
}

function latestAgentInteraction(state, selfId, agentIds) {
  if (!state?.rows?.entries || !selfId) return '';
  let latest = '';
  let latestSeq = -1;
  for (const [rowSeq, row] of state.rows.entries()) {
    if (row?.kind !== 'request' || row.type !== TYPES.agentAsk || row.sender?.id !== selfId) continue;
    const audience = Array.isArray(row.audience) ? row.audience : [];
    if (audience.length !== 1 || !agentIds.has(audience[0])) continue;
    const seq = Number(rowSeq || 0);
    if (seq >= latestSeq) { latest = audience[0]; latestSeq = seq; }
  }
  return latest;
}

// The probe owner supplies public-ledger evidence; the Composer selection
// owner applies the shared manual > recent > sole > none priority.
function defaultComposerAgentId({ channelId, stateFor, rosters, rosterRef, manualAgentsRef }) {
  return defaultComposerAgentSelection({ channelId, stateFor, rosters, rosterRef, manualAgentsRef }).actorId;
}

function defaultComposerAgentSelection({ channelId, stateFor, rosters, rosterRef, manualAgentsRef }) {
  if (!channelId) return resolveComposerAgentSelection({ roster: [] });
  const roster = rosters.get(channelId) || [];
  const agentIds = new Set(roster.filter((row) => row.kind === 'agent').map((row) => row.id));
  const manual = manualAgentsRef.current.get(channelId);
  const recent = latestAgentInteraction(
    stateFor(channelId),
    rosterRef.current?.self(channelId) || '',
    agentIds,
  );
  return resolveComposerAgentSelection({ roster, manualAgentId: manual, recentAgentId: recent });
}

export function useAgentProbes({
  activeChannelId,
  activeChannelRef,
  accessRef,
  stateFor,
  feedVersion,
  handleSend,
  handleControl,
  pending,
  rosterRef,
  rosters,
  wireState,
}) {
  const [composerAgent, setComposerAgent] = useState({ channelId: '', actorId: '' });
  const manualAgentsRef = useRef(new Map());
  const contextProbedRef = useRef(new Map());
  const optionsProbedRef = useRef(new Map());
  const lifecycleRef = useRef(null);
  if (lifecycleRef.current === null) lifecycleRef.current = createAgentProbeLifecycle();
  const liveRequestIds = lifecycleRef.current.liveRequestIds;
  const manualProbeRef = useRef(new Set());
  const [version, setVersion] = useState(0);

  const authorize = useCallback((channelId, actorId) => {
    if (!channelId || !actorId) return;
    const probeKey = `${channelId}:${actorId}`;
    manualProbeRef.current.add(probeKey);
    clearProbeSlots(lifecycleRef.current, probeKey);
    releaseAgentProbe(lifecycleRef.current, probeKey);
    for (const registry of [contextProbedRef, optionsProbedRef]) {
      const record = registry.current.get(probeKey);
      if (record) record.stale = true;
    }
    setVersion((current) => current + 1);
  }, []);

  const pickAgent = useCallback((actorId) => {
    if (!activeChannelId) return;
    manualAgentsRef.current.set(activeChannelId, actorId);
    authorize(activeChannelId, actorId);
    setVersion((current) => current + 1);
  }, [activeChannelId, authorize]);

  useEffect(() => {
    const channelId = activeChannelRef.current;
    if (!channelId) return;
    const manual = manualAgentsRef.current.get(channelId);
    if (!manual) return;
    const state = stateFor(channelId);
    if (!state) return;
    const agents = new Set((rosters.get(channelId) || [])
      .filter((row) => row.kind === 'agent')
      .map((row) => row.id));
    const selfActorId = rosterRef.current?.self(channelId) || '';
    if (latestAgentInteraction(state, selfActorId, agents) === manual) {
      manualAgentsRef.current.delete(channelId);
      setVersion((current) => current + 1);
    }
  }, [activeChannelRef, feedVersion, rosterRef, rosters, stateFor]);

  useEffect(() => {
    advanceAgentProbeGeneration(lifecycleRef.current);
    if (wireState === 'open') {
      contextProbedRef.current.clear();
      optionsProbedRef.current.clear();
    }
  }, [wireState]);

  const targetChanged = useCallback((actorId) => {
    setComposerAgent((current) => {
      const channelId = activeChannelRef.current || '';
      const nextActorId = actorId || defaultComposerAgentId({ channelId, stateFor, rosters, rosterRef, manualAgentsRef });
      if (current.channelId === channelId && current.actorId === nextActorId) return current;
      return { channelId, actorId: nextActorId };
    });
  }, [activeChannelRef, rosterRef, rosters, stateFor]);

  useEffect(() => {
    const channelId = activeChannelId || activeChannelRef.current || '';
    if (!channelId) return;
    const actorId = defaultComposerAgentId({ channelId, stateFor, rosters, rosterRef, manualAgentsRef });
    setComposerAgent((current) => {
      if (current.channelId === channelId && current.actorId === actorId) return current;
      return { channelId, actorId };
    });
  }, [activeChannelId, activeChannelRef, feedVersion, rosterRef, rosters, stateFor, version]);

  const describeActor = useCallback(async (actor, channelId = activeChannelId, { force = false } = {}) => {
    if (!actor || !channelId) return '';
    const probeKey = `${channelId}:${actor.id}`;
    const probe = beginAgentProbe(lifecycleRef.current, probeKey, { force });
    if (!probe) return '';
    try {
      const requestId = await handleSend({
        channelId,
        text: `读取 ${actor.name || actor.id} 的能力`,
        msgType: TYPES.describe,
        audience: [actor.id],
        targetLabel: actor.name || actor.id,
        payload: {},
        expiresAtMs: Date.now() + PROBE_TIMEOUT_MS,
      });
      acceptAgentProbe(lifecycleRef.current, probe, requestId);
      setVersion((current) => current + 1);
      return requestId || '';
    } catch (error) {
      failAgentProbe(lifecycleRef.current, probe);
      setVersion((current) => current + 1);
      throw error;
    }
  }, [activeChannelId, handleSend]);

  // Presentation may discover a control whose safety contract depends on a
  // live Describe before that actor has ever been selected in Composer. Keep
  // the request inside this owner: callers name the actor, while lifecycle,
  // one-minute rate limiting and ledger correlation remain centralized here.
  const requestCapability = useCallback((actorId, channelId = activeChannelRef.current) => {
    const refused = (code, detail) => ({ requested: false, requestId: '', error: { code, detail } });
    if (wireState !== 'open') return refused('probe_offline', '连接尚未就绪，无法读取能力');
    if (!actorId || !channelId) return refused('probe_target_missing', '能力读取缺少目标 Actor');
    const channelAccess = accessRef.current?.state?.(channelId);
    if (channelAccess?.relationship !== 'member' || channelAccess?.unavailable) {
      return refused('probe_access_denied', '当前无权读取该 Actor 的能力');
    }
    const actor = (rosters.get(channelId) || []).find((row) => row.id === actorId && row.kind === 'agent');
    if (!actor) return refused('probe_actor_unavailable', '目标 Agent 当前不在名册中');
    const state = stateFor(channelId);
    const capability = capabilityIndex(state, liveRequestIds, pending).get(actorId);
    const probeKey = `${channelId}:${actorId}`;
    const describeProbe = lifecycleRef.current.entries.get(probeKey);
    const describeRejected = Boolean(describeProbe?.requestId && pending.some(
      (item) => item.messageId === describeProbe.requestId && item.state === 'rejected',
    ));
    observeAgentProbe(lifecycleRef.current, probeKey, capability, describeRejected);
    if (capability?.loading) return refused('probe_in_flight', '能力读取正在进行中');

    // A known Describe means this call came from the explicit refresh surface:
    // retire only the current attempt, retain its live request as visible
    // evidence, and let the cross-generation one-minute gate decide whether a
    // new request may start. Never force or clear the rate-limit timestamp.
    if (capability?.describe) releaseAgentProbe(lifecycleRef.current, probeKey);
    return describeActor(actor, channelId).then((requestId) => {
      if (requestId) return { requested: true, requestId, error: null };
      const current = lifecycleRef.current.entries.get(probeKey);
      return current
        ? refused('probe_in_flight', '能力读取正在进行中')
        : refused('probe_rate_limited', '能力刷新每分钟最多一次，请稍后再试');
    }, (error) => ({
      requested: false,
      requestId: '',
      error: operationError(error, 'probe_submit_failed', '能力读取请求发送失败'),
    }));
  }, [accessRef, activeChannelRef, describeActor, liveRequestIds, pending, rosters, stateFor, wireState]);

  useEffect(() => {
    if (wireState !== 'open') return;
    const { channelId, actorId } = composerAgent;
    if (!channelId || !actorId || channelId !== activeChannelId) return;
    const channelAccess = accessRef.current?.state?.(channelId);
    if (channelAccess?.relationship !== 'member' || channelAccess?.unavailable) return;
    const actor = (rosters.get(channelId) || []).find((row) => row.id === actorId);
    if (!actor) return;
    const state = stateFor(channelId);
    const capability = capabilityIndex(state, liveRequestIds, pending).get(actorId);
    const probeKey = `${channelId}:${actorId}`;
    const describeProbe = lifecycleRef.current.entries.get(probeKey);
    const describeRejected = Boolean(describeProbe?.requestId && pending.some(
      (item) => item.messageId === describeProbe.requestId && item.state === 'rejected',
    ));
    observeAgentProbe(lifecycleRef.current, probeKey, capability, describeRejected);
    if (!manualProbeRef.current.has(probeKey)) return;
    if (!capability?.describe && !capability?.loading) {
      void describeActor(actor, channelId).catch(() => {});
      return;
    }
    if (!capability?.describe) return;

    const probeWord = (type, registry) => {
      if (!capability.describe.types?.has?.(type)) return;
      const probe = registry.current.get(probeKey);
      if (probe && !probe.stale) {
        if (!probe.failed && probe.requestId) {
          if (probeFailed(state, pending, probe.requestId, type)) probe.failed = true;
        }
        return;
      }
      if (!reserveProbeSlot(lifecycleRef.current, `${probeKey}:${type}`)) return;
      const entry = {
        requestId: '',
        previousRequestId: probe?.requestId || probe?.previousRequestId || '',
        failed: false,
        stale: false,
      };
      registry.current.set(probeKey, entry);
      const request = {
        channelId,
        text: '',
        msgType: type,
        audience: [actorId],
        targetLabel: actorId,
        payload: {},
        expiresAtMs: Date.now() + PROBE_TIMEOUT_MS,
      };
      // agent.options/context are Agent control words. They must enter the
      // canonical submission.control owner; sending the same frame through
      // raw `send` is rejected by the owner gate and would bypass its
      // control-specific authorization. A missing control owner fails closed
      // as a rejected probe instead of silently downgrading to raw send.
      const operation = typeof handleControl === 'function'
        ? Promise.resolve().then(() => handleControl(request))
        : Promise.reject(Object.assign(new TypeError('Agent 能力控制 owner 未连接'), { code: 'owner_unavailable' }));
      void operation.then((requestId) => {
        entry.requestId = requestId || '';
        entry.failed = !entry.requestId;
        setVersion((current) => current + 1);
      }).catch(() => {
        entry.failed = true;
        setVersion((current) => current + 1);
      });
    };

    probeWord(TYPES.agentOptions, optionsProbedRef);
    probeWord(TYPES.agentContext, contextProbedRef);
    const settled = (type, registry) => !capability.describe.types?.has?.(type) || registry.current.has(probeKey);
    if (settled(TYPES.agentOptions, optionsProbedRef) && settled(TYPES.agentContext, contextProbedRef)) {
      manualProbeRef.current.delete(probeKey);
    }
  }, [accessRef, activeChannelId, composerAgent, describeActor, feedVersion, handleControl, liveRequestIds, pending, rosters, stateFor, version, wireState]);

  const selectorOpened = useCallback(() => {
    authorize(composerAgent.channelId, composerAgent.actorId);
  }, [authorize, composerAgent]);

  const reset = useCallback(() => {
    manualAgentsRef.current.clear();
    contextProbedRef.current.clear();
    optionsProbedRef.current.clear();
    manualProbeRef.current.clear();
    advanceAgentProbeGeneration(lifecycleRef.current);
    setComposerAgent({ channelId: '', actorId: '' });
  }, []);

  const requestKeys = useCallback((channelId, actorId) => {
    if (!actorId) return { context: '', options: '' };
    const key = `${channelId}:${actorId}`;
    const serialize = (record) => [record?.requestId, record?.previousRequestId].filter(Boolean).join('|');
    return {
      context: serialize(contextProbedRef.current.get(key)),
      options: serialize(optionsProbedRef.current.get(key)),
    };
  }, []);

  const capabilitiesFor = useCallback(
    (channelId) => capabilityIndex(stateFor(channelId), liveRequestIds, pending),
    [liveRequestIds, pending, stateFor, version],
  );
  const composerAgentSource = (() => {
    const channelId = composerAgent.channelId;
    const actorId = composerAgent.actorId;
    if (!channelId || !actorId) return '';
    const roster = rosters.get(channelId) || [];
    const selection = defaultComposerAgentSelection({ channelId, stateFor, rosters, rosterRef, manualAgentsRef });
    if (selection.actorId === actorId) return selection.source;
    if (manualAgentsRef.current.get(channelId) === actorId && roster.some((row) => row.id === actorId && row.kind === 'agent')) return 'manual';
    return '';
  })();

  return {
    capabilitiesFor,
    composerAgent,
    composerAgentSource,
    pickAgent,
    requestKeys,
    requestCapability,
    reset,
    selectorOpened,
    targetChanged,
  };
}
