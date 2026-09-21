const DEFAULT_QUIET_MS = Object.freeze({
  wheel: 120,
  touch: 100,
  key: 80,
  scrollbar: 100,
  selection: 100,
});

function finiteTime(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function sourceID(value) {
  return value == null ? '' : String(value);
}

function copyTransaction(transaction) {
  if (!transaction) return null;
  return Object.freeze({ ...transaction });
}

export function createReadingNavigationCoordinator({
  activationID,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (handle) => globalThis.clearTimeout(handle),
  quietMs = {},
  onBegin = () => 0,
  onUpdate = () => {},
  onEnd = () => {},
  onCancel = () => {},
} = {}) {
  let currentActivationID = String(activationID || '');
  let transaction = null;
  let timerHandle = null;
  let sequence = 0;
  const quiet = { ...DEFAULT_QUIET_MS, ...quietMs };

  const clearDeadline = () => {
    if (timerHandle == null) return;
    clearTimer(timerHandle);
    timerHandle = null;
  };

  const reset = () => {
    clearDeadline();
    transaction = null;
  };

  const finish = (reason) => {
    if (!transaction) return false;
    const completed = copyTransaction(transaction);
    const active = transaction.phase !== 'potential';
    reset();
    if (active) onEnd(completed, reason);
    return active;
  };

  const cancel = (reason = 'cancelled') => {
    if (!transaction) return false;
    const cancelled = copyTransaction(transaction);
    reset();
    onCancel(cancelled, reason);
    return true;
  };

  const quietDelay = (source) => Math.max(0, Number(quiet[source] ?? 100));

  const scheduleQuietEnd = () => {
    if (!transaction) return;
    clearDeadline();
    const transactionID = transaction.id;
    const delay = quietDelay(transaction.source);
    timerHandle = setTimer(() => {
      timerHandle = null;
      if (transaction?.id !== transactionID) return;
      finish('quiet-deadline');
    }, delay);
  };

  const compatible = (event) => Boolean(
    transaction
    && transaction.activationID === String(event.activationID || currentActivationID)
    && transaction.hostRole === String(event.hostRole || '')
    && transaction.hostToken === event.hostToken
    && transaction.source === String(event.source || '')
    && (transaction.source === 'wheel'
      || transaction.sourceID === sourceID(event.sourceID)),
  );

  const startPotential = (event) => {
    const at = finiteTime(event.at, now());
    transaction = {
      id: `navigation:${++sequence}`,
      activationID: String(event.activationID || currentActivationID),
      inputGeneration: 0,
      source: String(event.source || ''),
      sourceID: sourceID(event.sourceID),
      phase: 'potential',
      direction: String(event.direction || 'browse'),
      hostRole: String(event.hostRole || ''),
      hostToken: event.hostToken,
      startedBookmark: event.bookmark || null,
      latestBookmark: event.bookmark || null,
      canFollowTail: event.canFollowTail !== false,
      canRequestHistory: event.canRequestHistory !== false,
      contactEnded: false,
      startedAt: at,
      lastInputAt: at,
      lastScrollAt: 0,
    };
    scheduleQuietEnd();
    return transaction;
  };

  const activate = (event) => {
    const at = finiteTime(event.at, now());
    if (!transaction) startPotential(event);
    // A potential contact has a bounded no-motion lifetime. Once real motion
    // activates it, that deadline no longer describes the transaction and
    // must not terminate an in-progress touch before touchend/scrollend.
    clearDeadline();
    const candidate = {
      ...transaction,
      phase: 'active',
      direction: String(event.direction || transaction.direction || 'browse'),
      startedBookmark: transaction.startedBookmark || event.bookmark || null,
      latestBookmark: event.bookmark || transaction.latestBookmark || null,
      canFollowTail: event.canFollowTail ?? transaction.canFollowTail,
      canRequestHistory: event.canRequestHistory ?? transaction.canRequestHistory,
      contactEnded: transaction.source === 'wheel',
      lastInputAt: at,
    };
    const beginResult = onBegin(copyTransaction(candidate)) || 0;
    const inputGeneration = Number(beginResult?.inputGeneration ?? beginResult) || sequence;
    transaction = { ...candidate, inputGeneration };
    onUpdate(copyTransaction(transaction), 'begin');
    if (transaction.source === 'wheel') scheduleQuietEnd();
    return transaction;
  };

  const update = (event, reason) => {
    const at = finiteTime(event.at, now());
    const previousDirection = transaction.direction;
    transaction = {
      ...transaction,
      direction: String(event.direction || transaction.direction),
      latestBookmark: event.bookmark || transaction.latestBookmark,
      canFollowTail: event.canFollowTail ?? transaction.canFollowTail,
      canRequestHistory: event.canRequestHistory ?? transaction.canRequestHistory,
      lastInputAt: reason === 'input' ? at : transaction.lastInputAt,
      lastScrollAt: reason === 'scroll' ? at : transaction.lastScrollAt,
    };
    onUpdate(copyTransaction(transaction), previousDirection === transaction.direction
      ? reason
      : 'direction-change');
    if (transaction.source === 'wheel' || transaction.contactEnded) scheduleQuietEnd();
    return transaction;
  };

  return Object.freeze({
    getSnapshot() {
      return Object.freeze({
        activationID: currentActivationID,
        transaction: copyTransaction(transaction),
      });
    },

    beginPotential(event) {
      if (!event?.source || !event?.hostRole) return null;
      if (transaction && !compatible(event)) finish('superseded-input');
      if (!transaction) startPotential(event);
      return copyTransaction(transaction);
    },

    recordInput(event) {
      if (!event?.source || !event?.hostRole) return null;
      const at = finiteTime(event.at, now());
      if (transaction && compatible(event) && transaction.source === 'wheel') {
        const gap = at - Math.max(transaction.lastInputAt, transaction.lastScrollAt || 0);
        if (gap > quietDelay('wheel')) finish('wheel-gap');
      }
      if (transaction && (!compatible(event) || transaction.contactEnded && transaction.source !== 'wheel')) {
        finish('superseded-input');
      }
      if (!transaction) startPotential(event);
      if (transaction.phase === 'potential') return copyTransaction(activate(event));
      return copyTransaction(update(event, 'input'));
    },

    recordScroll(event) {
      if (!transaction || transaction.phase === 'potential') return null;
      if (transaction.activationID !== String(event?.activationID || currentActivationID)
        || transaction.hostRole !== String(event?.hostRole || '')
        || transaction.hostToken !== event?.hostToken) return null;
      return copyTransaction(update(event || {}, 'scroll'));
    },

    endContact(event = {}) {
      if (!transaction || !compatible({ ...event, source: event.source || transaction.source })) return false;
      if (transaction.phase === 'potential') {
        reset();
        return false;
      }
      transaction = { ...transaction, phase: 'settling', contactEnded: true };
      onUpdate(copyTransaction(transaction), 'contact-end');
      scheduleQuietEnd();
      return true;
    },

    cancelContact(event = {}) {
      if (!transaction || !compatible({ ...event, source: event.source || transaction.source })) return false;
      return cancel('contact-cancel');
    },

    recordScrollEnd(event = {}) {
      if (!transaction) return false;
      if (transaction.activationID !== String(event.activationID || currentActivationID)
        || transaction.hostRole !== String(event.hostRole || '')
        || transaction.hostToken !== event.hostToken) return false;
      if (transaction.phase === 'potential') {
        reset();
        return false;
      }
      if (transaction.source !== 'wheel' && !transaction.contactEnded) return false;
      return finish('native-scrollend');
    },

    // A semantic top demand may settle after Chromium has already emitted its
    // per-tick scrollend.  That settlement is the owner-level boundary for
    // the wheel lease: release this exact transaction so the next native
    // wheel mints a new gesture/input epoch.  It performs no DOM write.
    settle(event = {}) {
      if (!transaction || transaction.source !== 'wheel') return false;
      if (transaction.activationID !== String(event.activationID || currentActivationID)
        || (event.hostRole && transaction.hostRole !== String(event.hostRole))
        || (Object.prototype.hasOwnProperty.call(event, 'hostToken')
          && transaction.hostToken !== event.hostToken)
        || (event.gestureID && transaction.id !== String(event.gestureID))
        || (event.inputEpoch != null
          && transaction.inputGeneration !== Number(event.inputEpoch))) return false;
      return finish('semantic-settled');
    },

    replaceActivation(nextActivationID) {
      const next = String(nextActivationID || '');
      if (next === currentActivationID) return false;
      cancel('activation-replaced');
      currentActivationID = next;
      return true;
    },

    cancel,
  });
}
