// Candidate contract retained from the isolated Legend experiment. The
// production Virtuoso list does not import or activate this model; its tests
// prove lifecycle isolation only, not a shipped geometry fix.
export const FOLD_DIRECTION = Object.freeze({
  expand: 'expand',
  collapse: 'collapse',
});

function choiceEntries(value) {
  if (value instanceof Map) return value;
  return Array.isArray(value) ? value : [];
}

function copyChoices(value) {
  return new Map([...choiceEntries(value)]
    .filter((entry) => Array.isArray(entry) && entry[0])
    .map(([id, expanded]) => [String(id), Boolean(expanded)]));
}

function validDirection(value) {
  return value === FOLD_DIRECTION.expand || value === FOLD_DIRECTION.collapse;
}

function sameStamp(left, right) {
  return Boolean(left && right
    && left.token === right.token
    && left.activationID === right.activationID
    && left.choiceRevision === right.choiceRevision
    && left.itemKey === right.itemKey
    && left.direction === right.direction);
}

function immutableChoice({ activationID, choiceRevision, foldID, itemKey, direction, commitSeen = false }) {
  return Object.freeze({
    activationID,
    choiceRevision,
    foldID,
    itemKey,
    direction,
    token: foldChoiceToken({ activationID, choiceRevision, itemKey, direction }),
    commitSeen: Boolean(commitSeen),
  });
}

function stateWith(state, change = {}) {
  return Object.freeze({
    activationID: String(change.activationID ?? state.activationID),
    choiceRevision: Number(change.choiceRevision ?? state.choiceRevision),
    choices: change.choices || state.choices,
    acknowledgedChoices: change.acknowledgedChoices || state.acknowledgedChoices,
    pendingChoice: change.pendingChoice === undefined ? state.pendingChoice : change.pendingChoice,
    admission: change.admission === undefined ? state.admission : change.admission,
  });
}

// The token is opaque to consumers. JSON keeps channel/message ids containing
// ':' unambiguous while still making every ownership field inspectable in
// diagnostics.
export function foldChoiceToken({ activationID = '', choiceRevision = 0, itemKey = '', direction = '' } = {}) {
  return JSON.stringify([
    String(activationID),
    Math.max(0, Number(choiceRevision) || 0),
    String(itemKey),
    String(direction),
  ]);
}

export function createFoldAdmissionState({ activationID = '', choices = [] } = {}) {
  const currentChoices = copyChoices(choices);
  return Object.freeze({
    activationID: String(activationID),
    choiceRevision: 0,
    choices: currentChoices,
    // A restored choice is part of initial placement for this activation. It
    // is therefore the geometry baseline, not a new size mutation.
    acknowledgedChoices: new Map(currentChoices),
    pendingChoice: null,
    admission: null,
  });
}

export function replaceFoldActivation(state, activationID) {
  const nextActivationID = String(activationID || '');
  if (nextActivationID === state.activationID && !state.pendingChoice && !state.admission) return state;
  return stateWith(state, {
    activationID: nextActivationID,
    // Initial placement in a new owner establishes the current choices as its
    // baseline. A callback carrying the old activation token cannot match it.
    acknowledgedChoices: new Map(state.choices),
    pendingChoice: null,
    admission: null,
  });
}

export function abandonFoldAdmission(state) {
  if (!state.pendingChoice && !state.admission) return state;
  return stateWith(state, { pendingChoice: null, admission: null });
}

// A Choice and its expand admission are returned as one immutable state so a
// React owner can publish the body and Legend's public size policy in the same
// commit. Collapse never creates an admission: ordinary size MVCP remains on.
export function requestFoldChoice(state, {
  foldID,
  itemKey,
  nextExpanded,
  currentExpanded,
} = {}) {
  const normalizedFoldID = String(foldID || '');
  const normalizedItemKey = String(itemKey || '');
  if (!normalizedFoldID || !normalizedItemKey || typeof nextExpanded !== 'boolean') {
    return Object.freeze({ state, changed: false, reason: 'invalid-choice', choice: null });
  }
  const presentExpanded = typeof currentExpanded === 'boolean'
    ? currentExpanded
    : Boolean(state.choices.get(normalizedFoldID));
  if (presentExpanded === nextExpanded) {
    return Object.freeze({ state, changed: false, reason: 'same-choice', choice: null });
  }

  const choiceRevision = state.choiceRevision + 1;
  const direction = nextExpanded ? FOLD_DIRECTION.expand : FOLD_DIRECTION.collapse;
  const choice = immutableChoice({
    activationID: state.activationID,
    choiceRevision,
    foldID: normalizedFoldID,
    itemKey: normalizedItemKey,
    direction,
  });
  const choices = new Map(state.choices);
  choices.set(normalizedFoldID, nextExpanded);
  const acknowledgedChoices = new Map(state.acknowledgedChoices);
  if (!acknowledgedChoices.has(normalizedFoldID)) {
    // The first interaction tells us the actual rendered default (including a
    // deliberate exemption). Preserve it as the pre-mutation size baseline.
    acknowledgedChoices.set(normalizedFoldID, presentExpanded);
  }
  const acknowledgedExpanded = acknowledgedChoices.get(normalizedFoldID);
  const netChange = acknowledgedExpanded !== nextExpanded;
  const pendingChoice = netChange ? choice : null;
  const admission = netChange && direction === FOLD_DIRECTION.expand ? choice : null;
  const next = stateWith(state, {
    choiceRevision,
    choices,
    acknowledgedChoices,
    pendingChoice,
    admission,
  });
  return Object.freeze({
    state: next,
    changed: true,
    reason: netChange ? direction : 'superseded-no-net-choice',
    choice,
  });
}

// commitSeen separates an old/pre-commit size callback from the callback
// caused by the render that published this exact Choice.
export function commitFoldChoice(state, stamp) {
  if (!sameStamp(state.pendingChoice, stamp)) {
    return Object.freeze({ state, accepted: false, reason: 'stale-choice' });
  }
  if (state.pendingChoice.commitSeen) {
    return Object.freeze({ state, accepted: false, reason: 'already-committed' });
  }
  const committed = immutableChoice({ ...state.pendingChoice, commitSeen: true });
  const admission = sameStamp(state.admission, stamp) ? committed : state.admission;
  return Object.freeze({
    state: stateWith(state, { pendingChoice: committed, admission }),
    accepted: true,
    reason: 'choice-committed',
  });
}

function sizeDirection(info) {
  const previousSize = Number(info?.previousSize ?? info?.previous);
  const size = Number(info?.size);
  if (!Number.isFinite(previousSize) || !Number.isFinite(size) || size === previousSize) return '';
  return size > previousSize ? FOLD_DIRECTION.expand : FOLD_DIRECTION.collapse;
}

export function acknowledgeFoldItemSize(state, evidence = {}) {
  const {
    stamp = evidence,
    itemKey,
    previousSize,
    previous,
    size,
  } = evidence;
  const pending = state.pendingChoice;
  if (!pending || !pending.commitSeen) {
    return Object.freeze({ state, accepted: false, reason: 'choice-not-committed' });
  }
  if (!sameStamp(pending, stamp)) {
    return Object.freeze({ state, accepted: false, reason: 'stale-choice' });
  }
  if (String(itemKey || '') !== pending.itemKey) {
    return Object.freeze({ state, accepted: false, reason: 'wrong-item' });
  }
  const direction = sizeDirection({ previousSize, previous, size });
  if (!validDirection(direction) || direction !== pending.direction) {
    return Object.freeze({ state, accepted: false, reason: 'wrong-direction' });
  }
  const acknowledgedChoices = new Map(state.acknowledgedChoices);
  acknowledgedChoices.set(pending.foldID, pending.direction === FOLD_DIRECTION.expand);
  return Object.freeze({
    state: stateWith(state, {
      acknowledgedChoices,
      pendingChoice: null,
      admission: null,
    }),
    accepted: true,
    reason: 'matching-item-size',
  });
}

export function foldSizeMVCPEnabled(state) {
  return !state.admission;
}
