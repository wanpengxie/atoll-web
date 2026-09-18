export function createNotificationConfirmation(authorityRevision = 0, generation = 0, observationRevision = 0) {
  return {
    authorityRevision: Number(authorityRevision || 0),
    generation: Number(generation || 0),
    needsBacklog: true,
    requiredObservationRevision: Number(observationRevision || 0) + 1,
    confirmedBoundary: 0,
    queuedPresented: null,
    pending: null,
  };
}

export function reconcileNotificationConfirmation(state, {
  authorityRevision, generation, observationRevision, controllerChanged,
  previousMode, currentMode, activationID,
}) {
  let next = state;
  if (state.authorityRevision !== Number(authorityRevision || 0)
    || state.generation !== Number(generation || 0)) {
    next = createNotificationConfirmation(authorityRevision, generation, observationRevision);
  } else next = { ...state };
  if (controllerChanged) {
    next.needsBacklog = true;
    next.requiredObservationRevision = Number(observationRevision || 0) + 1;
    next.queuedPresented = null;
    next.pending = null;
  } else if (previousMode === 'following' && currentMode !== 'following') {
    next.needsBacklog = true;
    next.requiredObservationRevision = Number(observationRevision || 0) + 1;
  }
  if (next.pending && (next.pending.activationID !== activationID || next.pending.generation !== Number(generation || 0))) next.pending = null;
  if (next.queuedPresented && (next.queuedPresented.activationID !== activationID || next.queuedPresented.generation !== Number(generation || 0))) next.queuedPresented = null;
  return next;
}

export function queuePresentedConfirmation(state, context, presentedBoundary) {
  const boundary = Math.min(
    Number(presentedBoundary || 0),
    Number(context.evidence.installedHighSeq || 0),
    Number(context.evidence.headSeq || 0),
  );
  if (boundary <= state.confirmedBoundary
    || context.messageCurrent !== true
    || Number(context.evidence.sourceRevision || 0) !== Number(context.presentationRevision || 0)) return state;
  const event = confirmationEvent(context, 'presented-follow', boundary);
  return !state.queuedPresented || boundary > state.queuedPresented.boundary
    ? { ...state, queuedPresented: event } : state;
}

export function nextNotificationConfirmation(state, context) {
  if (state.pending) return { state, event: state.pending };
  if (state.needsBacklog
    && Number(context.evidence.observationRevision || 0) >= state.requiredObservationRevision
    && context.attached === true && Number(context.evidence.generation || 0) > 0) {
    const event = confirmationEvent(context, 'tail-backlog', Math.max(0, Number(context.evidence.headSeq || 0)));
    return { state: { ...state, needsBacklog: false }, event };
  }
  return state.queuedPresented?.boundary > state.confirmedBoundary
    ? { state, event: state.queuedPresented } : { state, event: null };
}

export function settleNotificationConfirmation(state, event, accepted) {
  if (!event) return state;
  if (event.boundary <= 0 && event.cause === 'tail-backlog') return { ...state, pending: null };
  if (accepted !== true) return { ...state, pending: event };
  const confirmedBoundary = Math.max(state.confirmedBoundary, event.boundary);
  return {
    ...state,
    pending: null,
    confirmedBoundary,
    queuedPresented: state.queuedPresented === event || state.queuedPresented?.boundary <= confirmedBoundary
      ? null : state.queuedPresented,
  };
}

function confirmationEvent(context, cause, boundary) {
  const { evidence } = context;
  return Object.freeze({
    channelId: context.channelID,
    viewKey: context.viewKey,
    activationID: context.activationID,
    authorityRevision: Number(evidence.notificationAuthorityRevision || 0),
    generation: Number(evidence.generation || 0),
    cause,
    boundary,
    presentationRevision: Number(evidence.presentationRevision || 0),
    sourceRevision: Number(evidence.sourceRevision || 0),
    installedHighSeq: Number(evidence.installedHighSeq || 0),
    atTail: true,
    following: true,
    surfaceVisible: true,
  });
}
