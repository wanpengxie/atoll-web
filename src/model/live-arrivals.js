import { isNarrationEnvelope } from '../protocol/vocab.js';
import { isViewportNotifiableDisposition, notificationDisposition } from './notification-policy.js';
import { isSelfActor, relatedEnvelopeIdsIncremental } from './timeline-scope.js';

const LIVE_ARRIVAL_LIMIT = 1_024;
const LIVE_PRESENTATION_ARRIVAL_LIMIT = 1_024;

export function createLiveArrivalState() {
  return {
    _liveArrivalRevision: 0,
    _liveArrivalAckRevision: 0,
    _liveArrivalLog: [],
    _liveArrivalConsumers: 0,
    _liveArrivalConsumerTokens: new Set(),
    _liveArrivalOverflow: new Map(),
    _livePresentationArrivalRevision: 0,
    _livePresentationArrivalAckRevision: 0,
    _livePresentationArrivalLog: [],
    _livePresentationArrivalConsumerTokens: new Set(),
  };
}

function rootTurnID(state, envelope) {
  let id = envelope?.kind === 'request'
    ? envelope.id
    : envelope?.parent_id || envelope?.correlation_id || '';
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const turn = state?.turns?.get?.(id);
    const parent = turn?.request?.parent_id;
    if (!parent || !state?.turns?.has?.(parent)) break;
    id = parent;
  }
  const unresolvedParent = state?.turns?.get?.(id)?.request?.parent_id;
  if (unresolvedParent && !state?.turns?.has?.(unresolvedParent)) {
    return state.turns.get(id)?.request?.correlation_id
      || envelope?.correlation_id
      || unresolvedParent;
  }
  if (!state?.turns?.has?.(id) && envelope?.correlation_id) return envelope.correlation_id;
  return id;
}

// Replica commit provenance for the personal viewport. This owner contains no
// message bodies and is independent from the canonical ledger fold.
export function recordLiveTimelineArrival(state, envelope, seq, selfId = '') {
  if (!state || !envelope) return null;
  if (!selfId || isSelfActor(envelope.sender?.id, selfId)) return null;
  const disposition = notificationDisposition(state, envelope, selfId);
  let rowID = '';
  let key = '';
  if (disposition === 'request' || disposition === 'final') {
    key = rootTurnID(state, envelope);
    rowID = state.turns?.has?.(key) ? key : envelope.id || key;
  } else if (disposition === 'event') {
    rowID = envelope.id || '';
    key = rowID;
  }
  if (!isViewportNotifiableDisposition(disposition) || !rowID) return null;
  const related = relatedEnvelopeIdsIncremental(state, selfId);
  if (!related.has(envelope.id) && !related.has(key) && !related.has(rowID)) return null;

  const previousRevision = Number(state._liveArrivalRevision || 0);
  const hadUndisposedArrival = Number(state._liveArrivalAckRevision || 0) < previousRevision;
  const revision = previousRevision + 1;
  const event = Object.freeze({
    revision,
    key: String(key || rowID),
    rowID: String(rowID),
    seq: Math.max(0, Number(seq) || 0),
  });
  state._liveArrivalRevision = revision;
  state._liveArrivalLog.push(event);
  if (state._liveArrivalLog.length > LIVE_ARRIVAL_LIMIT) {
    const removed = state._liveArrivalLog.splice(0, state._liveArrivalLog.length - LIVE_ARRIVAL_LIMIT);
    for (const item of removed) {
      if (item.revision <= Number(state._liveArrivalAckRevision || 0)) continue;
      const previous = state._liveArrivalOverflow.get(item.key);
      const rowIDs = new Set(previous?.rowIDs || [previous?.rowID].filter(Boolean));
      rowIDs.add(item.rowID);
      state._liveArrivalOverflow.set(item.key, Object.freeze({
        ...item,
        revision: Math.max(item.revision, Number(previous?.revision || 0)),
        seq: Math.max(item.seq, Number(previous?.seq || 0)),
        rowIDs: Object.freeze([...rowIDs]),
      }));
    }
  }
  if (Number(state._liveArrivalConsumers || 0) === 0 && !hadUndisposedArrival) {
    acknowledgeLiveTimelineArrivals(state, revision);
  }
  return event;
}

export function liveTimelineArrivals(state) {
  const overflow = [...(state?._liveArrivalOverflow?.values?.() || [])];
  const hot = [...(state?._liveArrivalLog || [])];
  return Object.freeze({
    revision: Number(state?._liveArrivalRevision || 0),
    acknowledgedRevision: Number(state?._liveArrivalAckRevision || 0),
    events: Object.freeze([...overflow, ...hot].sort((left, right) => left.revision - right.revision)),
  });
}

export function acknowledgeLiveTimelineArrivals(state, throughRevision) {
  if (!state) return 0;
  const revision = Math.min(
    Number(state._liveArrivalRevision || 0),
    Math.max(Number(state._liveArrivalAckRevision || 0), Number(throughRevision || 0)),
  );
  state._liveArrivalAckRevision = revision;
  state._liveArrivalLog = (state._liveArrivalLog || []).filter((event) => event.revision > revision);
  for (const [key, event] of state._liveArrivalOverflow || []) {
    if (event.revision <= revision) state._liveArrivalOverflow.delete(key);
  }
  return revision;
}

export function registerLiveTimelineArrivalConsumer(state, consumerToken = Symbol('live-arrival-consumer')) {
  if (!state) return () => {};
  const consumers = state._liveArrivalConsumerTokens instanceof Set
    ? state._liveArrivalConsumerTokens
    : new Set();
  state._liveArrivalConsumerTokens = consumers;
  consumers.add(consumerToken);
  state._liveArrivalConsumers = consumers.size;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    consumers.delete(consumerToken);
    state._liveArrivalConsumers = consumers.size;
  };
}

function livePresentationRowIDs(state, envelope, seq) {
  if (!envelope) return Object.freeze([]);
  const ids = new Set();
  if (isNarrationEnvelope(envelope)) {
    const narrationSeq = Number(state.narration?.[0]?.seq || seq || 0);
    if (narrationSeq > 0) ids.add(`narration:${narrationSeq}`);
  }
  if (envelope.kind === 'request' || envelope.kind === 'response') {
    const rootID = rootTurnID(state, envelope);
    if (rootID) ids.add(String(rootID));
  }
  if (envelope.id) ids.add(String(envelope.id));
  return Object.freeze([...ids]);
}

export function recordLivePresentationArrival(state, envelope, seq) {
  if (!state?._livePresentationArrivalConsumerTokens?.size) return null;
  const rowIDs = livePresentationRowIDs(state, envelope, seq);
  if (!rowIDs.length) return null;
  const revision = Number(state._livePresentationArrivalRevision || 0) + 1;
  const event = Object.freeze({
    revision,
    rowIDs,
    seq: Math.max(0, Number(seq) || 0),
    sourceRevision: Number(state._timelineRevision || 0),
  });
  state._livePresentationArrivalRevision = revision;
  state._livePresentationArrivalLog.push(event);
  if (state._livePresentationArrivalLog.length > LIVE_PRESENTATION_ARRIVAL_LIMIT) {
    const removed = state._livePresentationArrivalLog.splice(
      0,
      state._livePresentationArrivalLog.length - LIVE_PRESENTATION_ARRIVAL_LIMIT,
    );
    state._livePresentationArrivalAckRevision = Math.max(
      Number(state._livePresentationArrivalAckRevision || 0),
      Number(removed.at(-1)?.revision || 0),
    );
  }
  return event;
}

export function livePresentationArrivals(state, throughSourceRevision = Number.POSITIVE_INFINITY) {
  const acknowledgedRevision = Number(state?._livePresentationArrivalAckRevision || 0);
  const events = [];
  let revision = acknowledgedRevision;
  for (const event of state?._livePresentationArrivalLog || []) {
    if (Number(event.revision) <= acknowledgedRevision) continue;
    if (Number(event.sourceRevision) > Number(throughSourceRevision)) break;
    events.push(event);
    revision = Number(event.revision);
  }
  return Object.freeze({
    revision,
    headRevision: Number(state?._livePresentationArrivalRevision || 0),
    acknowledgedRevision,
    events: Object.freeze(events),
  });
}

export function acknowledgeLivePresentationArrivals(state, throughRevision) {
  if (!state) return 0;
  const revision = Math.min(
    Number(state._livePresentationArrivalRevision || 0),
    Math.max(Number(state._livePresentationArrivalAckRevision || 0), Number(throughRevision || 0)),
  );
  state._livePresentationArrivalAckRevision = revision;
  state._livePresentationArrivalLog = (state._livePresentationArrivalLog || [])
    .filter((event) => Number(event.revision) > revision);
  return revision;
}

export function registerLivePresentationArrivalConsumer(
  state,
  consumerToken = Symbol('live-presentation-arrival-consumer'),
) {
  if (!state) return () => {};
  const consumers = state._livePresentationArrivalConsumerTokens instanceof Set
    ? state._livePresentationArrivalConsumerTokens
    : new Set();
  state._livePresentationArrivalConsumerTokens = consumers;
  if (consumers.size === 0) acknowledgeLivePresentationArrivals(state, state._livePresentationArrivalRevision);
  consumers.add(consumerToken);
  return () => {
    consumers.delete(consumerToken);
    if (consumers.size === 0) acknowledgeLivePresentationArrivals(state, state._livePresentationArrivalRevision);
  };
}
