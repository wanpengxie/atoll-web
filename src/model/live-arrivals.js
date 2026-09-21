export const LIVE_ARRIVAL_RECEIPT = Object.freeze({
  acknowledgeTimeline: 'live-arrival.acknowledge-timeline',
  acknowledgeTimelineRow: 'live-arrival.acknowledge-timeline-row',
  acknowledgePresentation: 'live-arrival.acknowledge-presentation',
});

function acknowledgement(type, throughRevision, throughSeq = Number.POSITIVE_INFINITY) {
  const sequence = Number(throughSeq);
  return Object.freeze({
    type,
    throughRevision: Math.max(0, Number(throughRevision) || 0),
    ...(Number.isSafeInteger(sequence) && sequence > 0 ? { throughSeq: sequence } : {}),
  });
}

// Receipt values are commands, not state mutators. ChannelReplica is the only
// component allowed to interpret them and advance its arrival journals.
export function acknowledgeLiveTimelineArrivals(throughRevision, throughSeq) {
  return acknowledgement(LIVE_ARRIVAL_RECEIPT.acknowledgeTimeline, throughRevision, throughSeq);
}

export function acknowledgeLiveTimelineRow({ key = '', rowID = '', seq = 0, revision = 0 } = {}) {
  return Object.freeze({
    type: LIVE_ARRIVAL_RECEIPT.acknowledgeTimelineRow,
    key: String(key || ''),
    rowID: String(rowID || ''),
    seq: Number(seq),
    revision: Number(revision),
  });
}

export function acknowledgeLivePresentationArrivals(throughRevision) {
  return acknowledgement(LIVE_ARRIVAL_RECEIPT.acknowledgePresentation, throughRevision);
}
