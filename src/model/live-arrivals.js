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
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    consumers.delete(consumerToken);
  };
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
