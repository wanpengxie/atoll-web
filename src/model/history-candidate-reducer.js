export const HISTORY_DEMAND_URGENCY_SCORE = Object.freeze({ anticipatory: 0, interactive: 4, blocking: 8 });
const DISPATCH_WHEEL = Object.freeze([0, 0, 0, 1, 1, 2]);
export function historyNumeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}
export function historyCoverageContains(meta, seq) {
  return Array.isArray(meta?.coverage) && meta.coverage.some((entry) =>
    historyNumeric(entry?.lowSeq) <= seq && historyNumeric(entry?.highSeq) >= seq);
}
export function historyRangesContain(ranges, seq) {
  const target = historyNumeric(seq);
  return target > 0 && Array.isArray(ranges) && ranges.some((entry) =>
    historyNumeric(entry?.lowSeq) <= target && historyNumeric(entry?.highSeq) >= target);
}
export function historyRangesCover(ranges, lowSeq, highSeq) {
  const low = historyNumeric(lowSeq);
  const high = historyNumeric(highSeq);
  return low > 0 && high >= low && Array.isArray(ranges) && ranges.some((entry) =>
    historyNumeric(entry?.lowSeq) <= low && historyNumeric(entry?.highSeq) >= high);
}
export function historyTailWindowCovered(meta, head, revealSize) {
  const target = historyNumeric(head);
  if (!target) return true;
  const interval = Array.isArray(meta?.coverage) && meta.coverage.find((entry) =>
    historyNumeric(entry?.lowSeq) <= target && historyNumeric(entry?.highSeq) >= target);
  if (!interval) return false;
  const low = historyNumeric(interval.lowSeq);
  return low === 1 || target - low + 1 >= revealSize;
}
export function mergeHistoryCoverage(ranges = [], addition = null) {
  const ordered = [...ranges, ...(addition ? [addition] : [])]
    .map((range) => ({ lowSeq: historyNumeric(range?.lowSeq), highSeq: historyNumeric(range?.highSeq) }))
    .filter((range) => range.lowSeq > 0 && range.highSeq >= range.lowSeq)
    .sort((left, right) => left.lowSeq - right.lowSeq || left.highSeq - right.highSeq);
  const merged = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.lowSeq > previous.highSeq + 1) merged.push({ ...range });
    else previous.highSeq = Math.max(previous.highSeq, range.highSeq);
  }
  return merged;
}
export function hasHistoryLocalKnowledge(meta) {
  return Boolean(meta && (historyNumeric(meta.rowCount) > 0 || meta.coverage?.length > 0));
}
export function historyLocalHead(meta) {
  const coverageHigh = Array.isArray(meta?.coverage)
    ? meta.coverage.reduce((high, entry) => Math.max(high, historyNumeric(entry?.highSeq)), 0)
    : 0;
  return Math.max(historyNumeric(meta?.newestSeq), coverageHigh);
}
function purposeFor(state, focus) {
  if (state.foregroundOwners.size > 0 || state.foregroundWaiters.length > 0) return 'user-demand';
  if (!state.tailVisible) return 'initial-tail';
  return 'hydrate';
}
function foregroundDemand(state) {
  let selected = null;
  for (const owner of state?.foregroundOwners || []) {
    const urgency = Object.hasOwn(HISTORY_DEMAND_URGENCY_SCORE, owner?.urgency) ? owner.urgency : 'interactive';
    const candidate = {
      intent: owner?.intent || 'scroll-history',
      urgency,
      score: HISTORY_DEMAND_URGENCY_SCORE[urgency],
    };
    if (!selected || candidate.score > selected.score) selected = candidate;
  }
  return selected;
}
function visibleGapBefore(state, visibleOldestByChannel) {
  const visibleOldest = historyNumeric(visibleOldestByChannel.get(state?.id));
  return visibleOldest > historyNumeric(state?.beforeSeq) ? visibleOldest : 0;
}
export function historySourceFor(state, beforeSeq = state?.beforeSeq) {
  const local = state?.localMeta;
  if (!local) return 'network';
  const frontier = beforeSeq - 1;
  return frontier > 0 && historyCoverageContains(local, frontier) ? 'indexeddb' : 'network';
}
export function historySourceBlockIdentity(state, context) {
  const { focus, generation, replicaEpoch, localMetaEpoch, visibleOldestSeq = 0 } = context;
  const tailRefresh = historyNumeric(state?.tailRefreshBeforeSeq) > 0;
  const purpose = tailRefresh ? 'initial-tail' : purposeFor(state, focus);
  const visibleOldest = historyNumeric(visibleOldestSeq);
  const gapBeforeSeq = purpose === 'user-demand' && visibleOldest > historyNumeric(state?.beforeSeq)
    ? visibleOldest
    : 0;
  const beforeSeq = tailRefresh ? state.tailRefreshBeforeSeq : gapBeforeSeq || state.beforeSeq;
  const source = tailRefresh ? 'network' : historySourceFor(state, beforeSeq);
  return { source, beforeSeq, replicaEpoch, localMetaEpoch, stateLease: state.stateLease,
    generation: source === 'network' ? generation : 0 };
}
export function historyBlockedSourceMatches(state, identity) {
  const blocked = state?.blockedSource;
  return Boolean(blocked
    && blocked.source === identity.source
    && blocked.beforeSeq === identity.beforeSeq
    && blocked.replicaEpoch === identity.replicaEpoch
    && blocked.localMetaEpoch === identity.localMetaEpoch
    && blocked.stateLease === identity.stateLease
    && blocked.generation === identity.generation);
}
function classifyTiers(states, { focus, generation, p1Channels, p2Channels }) {
  const tiers = new Map(states.map((state) => [state.id, 3]));
  if (tiers.has(focus)) tiers.set(focus, 0);
  for (const state of states) if (state.foregroundWaiters.length || state.foregroundOwners.size) tiers.set(state.id, 0);
  const eligible = states.filter((state) => {
    if (tiers.get(state.id) === 0 || state.remoteEligible === false) return false;
    const remoteAttached = Boolean(generation && state.attachedGeneration === generation);
    const localAttached = Boolean(!remoteAttached && hasHistoryLocalKnowledge(state.localMeta));
    return (remoteAttached || localAttached)
      && (state.hasRows || state.hasOlder || hasHistoryLocalKnowledge(state.localMeta));
  });
  const ordered = [];
  const seen = new Set();
  const append = (rows) => rows.forEach((state) => {
    if (!seen.has(state.id)) { seen.add(state.id); ordered.push(state); }
  });
  const descending = (field) => eligible
    .filter((state) => state[field] > 0)
    .sort((left, right) => right[field] - left[field] || left.id.localeCompare(right.id));
  const viewed = descending('lastFocusOrder');
  append(viewed.slice(0, 1));
  append(descending('relatedUnreadOrder'));
  append(descending('liveOrder'));
  append(viewed);
  append(eligible.slice().sort((left, right) => right.activity - left.activity || left.id.localeCompare(right.id)));
  ordered.slice(0, p1Channels).forEach((state) => tiers.set(state.id, 1));
  ordered.slice(p1Channels, p1Channels + p2Channels).forEach((state) => tiers.set(state.id, 2));
  return tiers;
}
function estimateBatch(source, limit, byteLimit, transportStats) {
  const stats = transportStats[source] || transportStats.network;
  const expectedBytes = Math.min(byteLimit, limit * stats.averageRowBytes);
  return Math.ceil(Math.max(
    stats.durationMs * 0.25,
    limit / Math.max(0.001, stats.rowsPerMs),
    expectedBytes / Math.max(1, stats.bytesPerMs),
  ));
}
function compareCandidates(left, right) {
  return right.priorityClass - left.priorityClass
    || left.tier - right.tier
    || right.lastFocusOrder - left.lastFocusOrder
    || right.activity - left.activity
    || right.waterDeficit - left.waterDeficit
    || right.waitDispatches - left.waitDispatches
    || left.channelId.localeCompare(right.channelId);
}
function evaluateCandidate(state, tier, input) {
  const { focus, generation, replicaEpoch, localMetaEpoch, localMetaReady,
    inflightByChannel, now, globalReservoirBytes, reservedInflightBytes, dispatchSerial,
    transportStats, visibleOldestByChannel, visibleNewestByChannel, config } = input;
  const blocked = (blockedBy) => ({ candidate: null, blockedBy });
  if (!state) return blocked('channel-unknown');
  if (!localMetaReady) return blocked('local-meta-pending');
  const remoteAttached = Boolean(generation && state?.attachedGeneration === generation);
  const localAttached = Boolean(!remoteAttached
    && state?.remoteEligible !== false
    && hasHistoryLocalKnowledge(state?.localMeta));
  if (!remoteAttached && !localAttached) return blocked('source-not-attached');
  if (inflightByChannel.has(state.id)) return blocked('channel-inflight');
  if (state.retryAt > now) return blocked('retry-backoff');
  if (state.projectionPending) return blocked('projection-ack-pending');
  if (tier >= 3) return blocked('priority-ineligible');
  const tailRefresh = historyNumeric(state.tailRefreshBeforeSeq) > 0;
  const purpose = tailRefresh ? 'initial-tail' : purposeFor(state, focus);
  const demand = purpose === 'user-demand' ? foregroundDemand(state) : null;
  if (purpose === 'user-demand' && state.reservoir.size > 0) return blocked('buffer-awaiting-release');
  const gapBeforeSeq = purpose === 'user-demand' ? visibleGapBefore(state, visibleOldestByChannel) : 0;
  const rangeKind = tailRefresh ? 'tail-refresh' : gapBeforeSeq ? 'visible-gap' : 'backfill';
  const taskBeforeSeq = tailRefresh ? state.tailRefreshBeforeSeq : gapBeforeSeq || state.beforeSeq;
  const target = config.targets[tier];
  if (!tailRefresh && purpose !== 'user-demand'
    && (state.tailVisible || state.id !== focus)
    && (state.reservoir.size >= target.rows
      || state.reservoirBytes >= target.bytes
      || state.warmScanned >= target.scanBudget)) return blocked('warm-target-satisfied');
  if (state.reservoir.size >= config.reservoirSize
    || state.reservoirBytes >= config.reservoirChannelBytes) return blocked('channel-reservoir-capacity');
  const priority = tailRefresh || tier === 0 ? 'foreground' : 'background';
  const urgent = priority === 'foreground';
  const channelAvailable = Math.max(0, config.reservoirChannelBytes - state.reservoirBytes);
  const globalAvailable = Math.max(0,
    config.reservoirGlobalBytes - globalReservoirBytes - reservedInflightBytes);
  const foregroundInflight = [...inflightByChannel.values()].some((batch) => batch.priority === 'foreground');
  const globalAllowance = urgent && !foregroundInflight
    ? Math.max(globalAvailable, config.batchBytes)
    : globalAvailable;
  const targetByteDeficit = tailRefresh || purpose === 'user-demand'
    || (!state.tailVisible && state.id === focus)
    ? config.batchBytes
    : Math.max(1, target.bytes - state.reservoirBytes);
  const byteLimit = Math.min(config.batchBytes, targetByteDeficit, channelAvailable, globalAllowance);
  if (byteLimit <= 0) return blocked('global-byte-capacity');
  if (!tailRefresh && !state.hasRows && !state.hasOlder
    && !hasHistoryLocalKnowledge(state.localMeta) && !gapBeforeSeq) return blocked('authoritative-eof');
  if (!tailRefresh && !gapBeforeSeq && state.completedPages > 0 && !state.hasOlder) return blocked('authoritative-eof');
  let priorityClass = priority === 'foreground' ? 100 : 0;
  if (purpose === 'user-demand') priorityClass += 20;
  else if (purpose === 'initial-tail') priorityClass += 10;
  if (tailRefresh) priorityClass += 40;
  priorityClass += Math.min(9, Math.floor(state.waitDispatches / config.fairnessDispatches));
  priorityClass += demand?.score || 0;
  const source = tailRefresh ? 'network' : historySourceFor(state, taskBeforeSeq);
  if (historyBlockedSourceMatches(state, { source, beforeSeq: taskBeforeSeq, replicaEpoch,
    localMetaEpoch, stateLease: state.stateLease,
    generation: source === 'network' ? generation : 0 })) return blocked('source-failure-block');
  const sourceStats = transportStats[source] || transportStats.network;
  const rowDeficit = tailRefresh || purpose === 'user-demand' || !state.tailVisible
    ? sourceStats.rowLimit
    : Math.max(1, target.rows - state.reservoir.size);
  const limit = Math.max(1, Math.min(sourceStats.rowLimit, rowDeficit,
    config.reservoirSize - state.reservoir.size));
  if (!remoteAttached && source !== 'indexeddb') return blocked('remote-source-unavailable');
  return { blockedBy: 'ready', candidate: {
    id: `${replicaEpoch}:${source === 'network' ? generation : 'cache'}:${state.id}:${dispatchSerial + 1}`,
    generation: source === 'network' ? generation : 0, replicaEpoch, localMetaEpoch,
    stateLease: state.stateLease, channelId: state.id,
    source, purpose,
    intent: demand?.intent || '', urgency: demand?.urgency || '',
    rangeKind, priority,
    beforeSeq: taskBeforeSeq,
    limit, byteLimit,
    estimatedMs: estimateBatch(source, limit, byteLimit, transportStats), reservedBytes: byteLimit,
    priorityClass, tier, lastFocusOrder: state.lastFocusOrder, activity: state.activity,
    waterDeficit: config.reservoirSize - state.reservoir.size,
    waitDispatches: state.waitDispatches, visibleNewestAtDispatch: historyNumeric(visibleNewestByChannel.get(state.id)),
  } };
}
// Pure scheduling reduction. ChannelFeedRuntime supplies immutable observations;
// this function alone classifies channels and selects the next obligation.
export function reduceHistoryCandidates(input) {
  const states = [...input.states];
  const tiers = classifyTiers(states, { focus: input.focus, generation: input.generation,
    p1Channels: input.config.p1Channels, p2Channels: input.config.p2Channels });
  const candidates = new Map(), blockReasons = new Map();
  for (const state of states) {
    const evaluation = evaluateCandidate(state, tiers.get(state.id), input);
    blockReasons.set(state.id, evaluation.blockedBy);
    if (evaluation.candidate) candidates.set(state.id, evaluation.candidate);
  }
  const backgroundInflight = [...input.inflightByChannel.values()]
    .filter((batch) => batch.priority === 'background').length;
  const eligible = [...candidates.values()].filter((batch) =>
    batch.priority === 'foreground' || backgroundInflight < input.maxBackgroundInflight);
  for (const candidate of candidates.values()) {
    if (input.inflightByChannel.size >= input.config.maxInflight)
      blockReasons.set(candidate.channelId, 'global-inflight-capacity');
    else if (candidate.priority === 'background' && backgroundInflight >= input.maxBackgroundInflight)
      blockReasons.set(candidate.channelId, 'background-inflight-capacity');
  }
  let selected = eligible.filter((batch) => batch.rangeKind === 'tail-refresh').sort(compareCandidates)[0] || null;
  if (!selected) selected = eligible.filter((batch) => batch.purpose === 'user-demand')
    .sort(compareCandidates)[0] || null;
  let focusedBlocksHydration = false;
  if (!selected) {
    const focused = states.find((state) => state.id === input.focus);
    if (focused && !focused.tailVisible) {
      selected = eligible.filter((batch) => batch.channelId === input.focus).sort(compareCandidates)[0] || null;
      if (!selected && input.inflightByChannel.has(input.focus)) focusedBlocksHydration = true;
    }
  }
  let nextWheelIndex = input.dispatchWheelIndex;
  if (!selected && !focusedBlocksHydration) {
    for (let offset = 0; offset < DISPATCH_WHEEL.length; offset += 1) {
      const index = (input.dispatchWheelIndex + offset) % DISPATCH_WHEEL.length;
      const tier = DISPATCH_WHEEL[index];
      const wheelCandidate = eligible.filter((batch) => batch.tier === tier).sort(compareCandidates)[0];
      if (!wheelCandidate) continue;
      selected = wheelCandidate;
      nextWheelIndex = (index + 1) % DISPATCH_WHEEL.length;
      break;
    }
  }
  if (!selected && !focusedBlocksHydration) selected = eligible.sort(compareCandidates)[0] || null;
  return Object.freeze({ tiers, candidates, blockReasons, selected, nextWheelIndex });
}
