function rangeCovers(ranges = [], low, high) {
  const start = Number(low || 0);
  const end = Number(high || 0);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 && end >= start
    && ranges.some((range) => Number(range?.lowSeq || 0) <= start && Number(range?.highSeq || 0) >= end);
}

export function currentEntryAuthority({ snapshot, historyStatus, bottomReady, availability, authoritativeEmpty }) {
  const candidate = snapshot?.currentEntryCandidate;
  const durableCovered = candidate && candidate.local !== true
    && rangeCovers(historyStatus?.coverage, candidate.seqHigh, historyStatus?.headSeq);
  const localCovered = candidate?.local === true && (authoritativeEmpty
    || (bottomReady && rangeCovers(historyStatus?.coverage, historyStatus?.headSeq, historyStatus?.headSeq)));
  if (availability !== 'readable' || !candidate || !((bottomReady && durableCovered) || localCovered)) return null;
  return Object.freeze({
    epoch: snapshot.epoch,
    viewID: snapshot.viewID,
    sourceRevision: Number(snapshot.sourceRevision || 0),
    candidateID: candidate.id,
  });
}

export function pendingArrivalEvents(arrivals, previousRevision) {
  const revision = Number(arrivals?.revision || 0);
  const events = arrivals?.events || [];
  const firstIndex = Math.max(0, Number(previousRevision || 0) - Math.max(0, revision - events.length));
  return events.slice(firstIndex)
    .filter((event) => Number(event?.revision || 0) > previousRevision && Number(event?.revision || 0) <= revision);
}

export function installedTailReadRows(rows = [], installedHighSeq = 0, visibleRows = []) {
  const high = Number(installedHighSeq || 0);
  const byID = new Map();
  const admit = (messageID, seqHigh) => {
    const id = String(messageID || '');
    const seq = Number(seqHigh || 0);
    if (id && Number.isSafeInteger(seq) && seq > 0 && seq <= high) byID.set(id, Math.max(byID.get(id) || 0, seq));
  };
  for (const row of visibleRows || []) admit(row?.messageID, row?.seqHigh);
  for (const row of rows || []) if (row && !row.localState && row.body?.local !== true) admit(row.id, row.seqHigh);
  return Object.freeze([...byID].map(([messageID, seqHigh]) => Object.freeze({ messageID, seqHigh })));
}

export function emptyDOMEvidence({ owner, controller, activationID, notificationAuthorityRevision = 0, observationRevision = 0 }) {
  return {
    owner, controller, activationID, atTail: false, surfaceVisible: false,
    installedHighSeq: 0, presentationRevision: 0, sourceRevision: 0,
    generation: 0, headSeq: 0, notificationAuthorityRevision,
    observationRevision, visibleRows: Object.freeze([]), readPending: false,
  };
}

export function observedDOMEvidence({ owner, controller, activationID, observation, snapshot, historyStatus, observationRevision }) {
  return {
    owner, controller, activationID,
    atTail: Boolean(observation.atTail),
    surfaceVisible: observation.surfaceVisible === true,
    installedHighSeq: Number(observation.installedHighSeq || 0),
    presentationRevision: Number(snapshot.revision || 0),
    sourceRevision: Number(snapshot.sourceRevision || 0),
    generation: Number(historyStatus.generation || 0),
    headSeq: Number(historyStatus.headSeq || 0),
    notificationAuthorityRevision: Number(historyStatus.notificationAuthorityRevision || 0),
    observationRevision,
    visibleRows: Object.freeze([...(observation.visibleRows || [])]),
    readPending: false,
  };
}

export function evidenceBelongsTo(evidence, { owner, controller, activationID }) {
  return evidence.owner === owner && evidence.controller === controller && evidence.activationID === activationID;
}

export function transferDOMEvidence(evidence, previousOwner, nextOwner, inputs) {
  const sameAuthority = previousOwner.controller === nextOwner.controller
    && previousOwner.activationID === nextOwner.activationID
    && previousOwner.channelID === nextOwner.channelID
    && previousOwner.viewKey === nextOwner.viewKey
    && Number(previousOwner.session?.inputEpoch || 0) === Number(nextOwner.session?.inputEpoch || 0)
    && Number(previousOwner.snapshot?.revision || 0) === Number(nextOwner.snapshot?.revision || 0)
    && Number(previousOwner.snapshot?.sourceRevision || 0) === Number(nextOwner.snapshot?.sourceRevision || 0)
    && Number(previousOwner.historyStatus?.generation || 0) === Number(nextOwner.historyStatus?.generation || 0);
  if (sameAuthority && evidence.owner === previousOwner) return { ...evidence, owner: nextOwner };
  if (previousOwner.controller !== nextOwner.controller || (inputs.surfaceVisible !== true && evidence.surfaceVisible !== true)) {
    return emptyDOMEvidence({
      owner: nextOwner,
      controller: inputs.controller,
      activationID: inputs.controller.activationID,
      notificationAuthorityRevision: inputs.notificationAuthorityRevision,
      observationRevision: inputs.observationRevision,
    });
  }
  return evidence;
}
