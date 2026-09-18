function normalizedTargets(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

export function createSendScrollTransaction(intent, activationID) {
  const targetIDs = normalizedTargets(intent?.targetMessageIDs);
  if (!String(intent?.id || '').startsWith('composer:send-start:') || !targetIDs.length) return null;
  return Object.freeze({
    intentID: String(intent.id),
    activationID: String(activationID || ''),
    inputEpoch: Number(intent.inputEpoch) || 0,
    targetIDs: Object.freeze(targetIDs),
    afterPresentationRevision: Math.max(0, Number(intent.afterPresentationRevision) || 0),
    readyRevision: 0,
    ready: false,
    measuredRevision: 0,
    measuredHeight: 0,
    measuredTargetIDs: Object.freeze([]),
    targetMeasurements: Object.freeze({}),
    destination: '',
    waitingTargetIDs: Object.freeze([]),
    timelineTargetIDs: Object.freeze([]),
    targetListRevisions: Object.freeze({}),
  });
}

export function advanceSendScrollTransaction(state, event = {}) {
  if (!state) return null;
  if (event.activationID && event.activationID !== state.activationID) return null;
  if (event.inputEpoch != null && Number(event.inputEpoch) !== state.inputEpoch) return null;
  if (event.intentID && event.intentID !== state.intentID) return state;
  if (event.type === 'invalidate') return null;
  if (event.type === 'ready') {
    const targets = normalizedTargets(event.targetIDs);
    if (targets.length !== state.targetIDs.length
      || targets.some((id) => !state.targetIDs.includes(id))) return state;
    const revision = Number(event.revision) || 0;
    // Presentation evidence is monotonic. A late parent/layout callback from
    // an older render must not replace the destination chosen by the newest
    // committed presentation (in particular timeline -> waiting).
    if (state.ready && revision <= state.readyRevision) return state;
    if (revision < state.afterPresentationRevision) return state;
    const destinationByID = new Map((event.destinations || [])
      .map((entry) => [String(entry?.messageID || ''), entry?.destination]));
    const targetListRevisions = Object.fromEntries(targets.map((id) => {
      const destination = (event.destinations || []).find((entry) => String(entry?.messageID || '') === id);
      return [id, Math.max(0, Number(destination?.targetListRevision ?? revision) || 0)];
    }));
    const waitingTargetIDs = targets.filter((id) => (
      destinationByID.size
        ? destinationByID.get(id) === 'waiting'
        : event.destination === 'waiting'
    ));
    const timelineCount = targets.length - waitingTargetIDs.length;
    return Object.freeze({
      ...state,
      ready: true,
      readyRevision: revision,
      destination: waitingTargetIDs.length === targets.length
        ? 'waiting'
        : waitingTargetIDs.length && timelineCount ? 'mixed' : 'timeline',
      waitingTargetIDs: Object.freeze(waitingTargetIDs),
      timelineTargetIDs: Object.freeze(targets.filter((id) => !waitingTargetIDs.includes(id))),
      targetListRevisions: Object.freeze(targetListRevisions),
    });
  }
  if (event.type === 'measured') {
    const measuredTargets = normalizedTargets(event.targetIDs)
      .filter((id) => state.targetIDs.includes(id));
    const revision = Math.max(0, Number(event.revision) || 0);
    const height = Math.max(0, Number(event.height) || 0);
    const targetMeasurements = { ...state.targetMeasurements };
    for (const targetID of measuredTargets) {
      const previous = targetMeasurements[targetID];
      if (!previous || revision >= previous.listRevision) {
        targetMeasurements[targetID] = Object.freeze({ listRevision: revision, height });
      }
    }
    return Object.freeze({
      ...state,
      measuredRevision: Math.max(state.measuredRevision, revision),
      measuredHeight: Math.max(0, ...Object.values(targetMeasurements).map((entry) => entry.height)),
      measuredTargetIDs: Object.freeze([...new Set([
        ...state.measuredTargetIDs,
        ...measuredTargets,
      ])]),
      targetMeasurements: Object.freeze(targetMeasurements),
    });
  }
  return state;
}

export function sendScrollTransactionCanWrite(state) {
  return Boolean(
    state
    && state.ready
    && (state.destination === 'waiting'
      || state.readyRevision > state.afterPresentationRevision)
    // Timeline readiness may be a later metadata-only presentation revision
    // than the public item measurement which installed the target row. Join
    // by stable target identity, not by assuming those revisions are equal.
    && (state.destination === 'waiting'
      || state.targetIDs
        .filter((id) => !state.waitingTargetIDs.includes(id))
        .every((id) => (
          state.targetMeasurements[id]?.listRevision >= state.targetListRevisions[id]
        ))),
  );
}
