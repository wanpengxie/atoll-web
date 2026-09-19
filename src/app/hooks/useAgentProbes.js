import { useCallback, useEffect, useRef, useState } from 'react';
import { argsOf } from '../../protocol/envelope.js';
import { capabilityIndexFromState } from '../../model/capabilities.js';
import { latestInteractedAgentId } from '../../model/agent-selection.js';
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

export function useAgentProbes({
  activeChannelId,
  activeChannelRef,
  accessRef,
  stateFor,
  feedVersion,
  handleSend,
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
    if (latestInteractedAgentId(state, selfActorId, agents) === manual) {
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
      if (current.channelId === channelId && current.actorId === actorId) return current;
      return { channelId, actorId };
    });
  }, [activeChannelRef]);

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
    if (wireState !== 'open' || !actorId || !channelId) return false;
    const channelAccess = accessRef.current?.state?.(channelId);
    if (channelAccess?.relationship !== 'member' || channelAccess?.unavailable) return false;
    const actor = (rosters.get(channelId) || []).find((row) => row.id === actorId && row.kind === 'agent');
    if (!actor) return false;
    const state = stateFor(channelId);
    const capability = capabilityIndexFromState(state, liveRequestIds).get(actorId);
    const probeKey = `${channelId}:${actorId}`;
    const describeProbe = lifecycleRef.current.entries.get(probeKey);
    const describeRejected = Boolean(describeProbe?.requestId && pending.some(
      (item) => item.messageId === describeProbe.requestId && item.state === 'rejected',
    ));
    observeAgentProbe(lifecycleRef.current, probeKey, capability, describeRejected);
    if (capability?.describe || capability?.loading) return false;
    void describeActor(actor, channelId).catch(() => {});
    return true;
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
    const capability = capabilityIndexFromState(state, liveRequestIds).get(actorId);
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
          const failedRow = argsOf(state?.turns?.get?.(probe.requestId)?.terminal)?.status === 'failed';
          const rejected = pending.some((item) => item.messageId === probe.requestId && item.state === 'rejected');
          if (failedRow || rejected) probe.failed = true;
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
      void handleSend({
        channelId,
        text: '',
        msgType: type,
        audience: [actorId],
        targetLabel: actorId,
        payload: {},
        expiresAtMs: Date.now() + PROBE_TIMEOUT_MS,
      }).then((requestId) => {
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
  }, [accessRef, activeChannelId, composerAgent, describeActor, feedVersion, handleSend, liveRequestIds, pending, rosters, stateFor, version, wireState]);

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

  return {
    composerAgent,
    describeActor,
    liveRequestIds,
    manualAgentIdFor: (channelId) => manualAgentsRef.current.get(channelId) || '',
    pickAgent,
    requestKeys,
    requestCapability,
    reset,
    selectorOpened,
    targetChanged,
    version,
  };
}
