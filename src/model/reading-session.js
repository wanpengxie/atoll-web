export const READING_MODE = Object.freeze({
  following: 'following',
  browsing: 'browsing',
});

function normalizedBookmark(value) {
  if (!value?.messageID) return null;
  const rowViewportOffset = value.rowViewportOffset == null || value.rowViewportOffset === ''
    ? null
    : Number(value.rowViewportOffset);
  const textViewportOffset = value.textViewportOffset == null || value.textViewportOffset === ''
    ? null
    : Number(value.textViewportOffset);
  return Object.freeze({
    messageID: String(value.messageID),
    blockID: String(value.blockID || ''),
    textOffset: Math.max(0, Number(value.textOffset) || 0),
    textBefore: String(value.textBefore || '').slice(-64),
    textAfter: String(value.textAfter || '').slice(0, 64),
    blockTextStart: String(value.blockTextStart || '').slice(0, 96),
    blockTextEnd: String(value.blockTextEnd || '').slice(-96),
    viewportOffset: Number(value.viewportOffset) || 0,
    textViewportOffset: Number.isFinite(textViewportOffset) ? textViewportOffset : null,
    rowViewportOffset: Number.isFinite(rowViewportOffset) ? rowViewportOffset : null,
    seq: Math.max(0, Number(value.seq) || 0),
    predecessorID: String(value.predecessorID || ''),
    successorID: String(value.successorID || ''),
  });
}

// Resolve a saved semantic position against the one committed Presentation.
// Exact identity wins; a deleted identity resumes at its recorded successor,
// predecessor, nearest sequence, and finally the first surviving row. Only an
// exact identity may reuse the saved row-local offset.
export function resolveReadingBookmark(rows = [], bookmark = null) {
  if (!bookmark?.messageID || rows.length === 0) return null;
  let index = rows.findIndex((row) => row.id === bookmark.messageID);
  const exact = index >= 0;
  if (index < 0 && bookmark.successorID) {
    index = rows.findIndex((row) => row.id === bookmark.successorID);
  }
  if (index < 0 && bookmark.predecessorID) {
    index = rows.findIndex((row) => row.id === bookmark.predecessorID);
  }
  if (index < 0 && bookmark.seq) {
    let distance = Number.POSITIVE_INFINITY;
    rows.forEach((row, candidate) => {
      const nextDistance = Math.abs(Number(row.seqLow || 0) - Number(bookmark.seq));
      if (nextDistance < distance) {
        distance = nextDistance;
        index = candidate;
      }
    });
  }
  if (index < 0) index = 0;
  const rowViewportOffset = Number(bookmark.rowViewportOffset);
  return Object.freeze({
    index,
    messageID: rows[index].id,
    rowViewportOffset: exact && Number.isFinite(rowViewportOffset) ? rowViewportOffset : null,
    exact,
  });
}

function idleBottomIntent() {
  return Object.freeze({
    id: '',
    inputEpoch: 0,
    afterPresentationRevision: 0,
    baselineTailID: '',
    targetMessageIDs: Object.freeze([]),
  });
}

function idleContentAnchor() {
  return null;
}

function normalizedPositionRowLease(value) {
  if (!value || value.type !== 'position-row') return null;
  const viewportOffset = Number(value.viewportOffset);
  const presentationRevision = Number(value.presentationRevision);
  if (!value.activationID || !Number.isFinite(Number(value.inputEpoch))
    || !Number.isFinite(Number(value.intentRevision)) || !value.operationID
    || !value.viewID || !value.epoch || !value.messageID
    || !Number.isFinite(presentationRevision) || !Number.isFinite(viewportOffset)) return null;
  return Object.freeze({
    type: 'position-row',
    activationID: String(value.activationID),
    inputEpoch: Number(value.inputEpoch),
    intentRevision: Number(value.intentRevision),
    operationID: String(value.operationID),
    viewID: String(value.viewID),
    epoch: String(value.epoch),
    presentationRevision,
    messageID: String(value.messageID),
    viewportOffset,
  });
}

function samePositionRowLease(left, right) {
  return Boolean(left && right)
    && left.type === 'position-row' && right.type === 'position-row'
    && String(left.activationID) === String(right.activationID)
    && Number(left.inputEpoch) === Number(right.inputEpoch)
    && Number(left.intentRevision) === Number(right.intentRevision)
    && String(left.operationID) === String(right.operationID)
    && String(left.viewID) === String(right.viewID)
    && String(left.epoch) === String(right.epoch)
    && Number(left.presentationRevision) === Number(right.presentationRevision)
    && String(left.messageID) === String(right.messageID)
    && Number(left.viewportOffset) === Number(right.viewportOffset);
}

function normalizedHistoryAnchor(session, value) {
  if (!value?.messageID || !Number.isFinite(Number(value.viewportOffset))) return null;
  return Object.freeze({
    activationID: session.activationID,
    inputEpoch: session.inputEpoch,
    intentRevision: session.intentRevision,
    gestureID: String(value.gestureID || session.historyAnchor?.gestureID || ''),
    messageID: String(value.messageID),
    viewportOffset: Number(value.viewportOffset),
  });
}

function normalizedHistoryStartIntent(session, {
  channelID = '', viewKey = '', generation = 0, sourceLease = '',
  inputEpoch = session.inputEpoch, intentRevision = session.intentRevision,
} = {}) {
  const numericGeneration = Number(generation);
  if (!channelID || !viewKey || !Number.isSafeInteger(numericGeneration) || numericGeneration < 0) {
    return null;
  }
  const nextInputEpoch = Number(inputEpoch);
  const nextIntentRevision = Number(intentRevision);
  return Object.freeze({
    type: 'history-start',
    id: `history-start:${session.activationID}:${nextInputEpoch}:${nextIntentRevision}`,
    activationID: session.activationID,
    channelID: String(channelID),
    viewKey: String(viewKey),
    generation: numericGeneration,
    sourceLease: String(sourceLease || ''),
    inputEpoch: nextInputEpoch,
    intentRevision: nextIntentRevision,
    direction: 'older',
  });
}

function sameHistoryStartIntent(left, right) {
  return Boolean(left && right)
    && left.type === 'history-start' && right.type === 'history-start'
    && String(left.id) === String(right.id)
    && String(left.activationID) === String(right.activationID)
    && String(left.channelID) === String(right.channelID)
    && String(left.viewKey) === String(right.viewKey)
    && Number(left.generation) === Number(right.generation)
    && String(left.sourceLease) === String(right.sourceLease)
    && Number(left.inputEpoch) === Number(right.inputEpoch)
    && Number(left.intentRevision) === Number(right.intentRevision)
    && left.direction === right.direction;
}

function normalizedUnseenRecords(value) {
  const records = new Map();
  for (const record of value?.unseenRecords || []) {
    if (!Array.isArray(record) || !record[0]) continue;
    const key = String(record[0]);
    const seq = Number(record[1]);
    if (!Number.isSafeInteger(seq) || seq <= 0) continue;
    records.set(key, Math.max(records.get(key) || 0, seq));
  }
  return Object.freeze([...records]);
}

export function createReadingSession({ key, activationID, saved = {} } = {}) {
  if (!key || !activationID) throw new TypeError('reading session requires key and activationID');
  const unseenRecords = normalizedUnseenRecords(saved);
  // A persisted unseen record is itself a durable browsing obligation. The
  // storage boundary intentionally starts at the latest physical position,
  // but the public jump must remain available until this obligation is
  // explicitly acknowledged.
  const savedMode = saved.mode === READING_MODE.browsing || unseenRecords.length
    ? READING_MODE.browsing
    : READING_MODE.following;
  return Object.freeze({
    key: String(key),
    activationID: String(activationID),
    revision: Math.max(0, Number(saved.revision) || 0),
    inputEpoch: 0,
    intentRevision: 0,
    geometryRevision: 0,
    mode: savedMode,
    bookmark: savedMode === READING_MODE.browsing ? normalizedBookmark(saved.bookmark) : null,
    unseenRecords,
    bottomIntent: idleBottomIntent(),
    contentAnchor: idleContentAnchor(),
    positionRowLease: null,
    historyAnchor: null,
    historyStartIntent: null,
    tailEvidence: null,
  });
}

function next(session, change) {
  return Object.freeze({ ...session, ...change, revision: session.revision + 1 });
}

function sameBookmark(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.messageID === right.messageID
    && left.blockID === right.blockID
    && left.textOffset === right.textOffset
    && left.textBefore === right.textBefore
    && left.textAfter === right.textAfter
    && left.blockTextStart === right.blockTextStart
    && left.blockTextEnd === right.blockTextEnd
    && left.viewportOffset === right.viewportOffset
    && left.textViewportOffset === right.textViewportOffset
    && left.rowViewportOffset === right.rowViewportOffset
    && left.seq === right.seq
    && left.predecessorID === right.predecessorID
    && left.successorID === right.successorID;
}

// Native input changes only the business reading intent. It does not mirror or
// cancel the list component's internal work. A pending return-to-bottom intent
// is application-owned, however, and becomes invalid synchronously.
export function takeReadingControl(session, {
  direction = 'browse', gestureID = '', geometryRevision, historyAnchor = null,
  historyStart = false, channelID = '', viewKey = '', generation = 0, sourceLease = '',
} = {}) {
  const inputEpoch = session.inputEpoch + 1;
  const intentRevision = session.intentRevision + 1;
  // Wheel delivery can cross the coordinator's quiet deadline while it is
  // still one semantic older intent (for example while a delayed page is
  // being admitted).  Keep the first physical row anchor for that intent and
  // only rebind its identity to the new input epoch/revision.  Re-capturing
  // the row after it has moved to the top would turn the later grant into a
  // different viewport offset, so the prepend would be visibly displaced.
  const existingAnchor = direction === 'older' && session.historyAnchor?.messageID
    && Number.isFinite(Number(session.historyAnchor.viewportOffset))
    ? session.historyAnchor
    : historyAnchor;
  // The coordinator's transaction id is the boundary between one physical
  // older gesture and the next. A later gesture must use its newly captured
  // baseline; blindly carrying the previous first-row lease replays an old
  // viewport after a pause. The id is mandatory for rebasing: a production
  // caller that omits it cannot prove that this is the same physical gesture,
  // so its old anchor is never reused.
  const sameOlderGesture = existingAnchor && direction === 'older'
    && Boolean(gestureID)
    && String(existingAnchor.gestureID || '') === String(gestureID);
  const olderAnchor = sameOlderGesture ? existingAnchor : historyAnchor;
  const nextHistoryStart = historyStart === true && direction === 'older'
    ? normalizedHistoryStartIntent(session, {
      channelID, viewKey, generation, sourceLease, inputEpoch, intentRevision,
    })
    : null;
  return next(session, {
    inputEpoch,
    intentRevision,
    mode: READING_MODE.browsing,
    bottomIntent: idleBottomIntent(),
    contentAnchor: idleContentAnchor(),
    positionRowLease: null,
    historyAnchor: nextHistoryStart ? null : direction === 'older' && olderAnchor?.messageID
      && Number.isFinite(Number(olderAnchor.viewportOffset))
      ? Object.freeze({
        activationID: session.activationID,
        inputEpoch,
        intentRevision,
        gestureID: String(gestureID || olderAnchor.gestureID || ''),
        messageID: String(olderAnchor.messageID),
        viewportOffset: Number(olderAnchor.viewportOffset),
      })
      : null,
    historyStartIntent: nextHistoryStart,
    tailEvidence: direction === 'newer' ? Object.freeze({
      gestureID: String(gestureID || inputEpoch),
      inputEpoch,
      geometryRevision: Number.isFinite(geometryRevision) ? geometryRevision : session.geometryRevision,
      direction: 'newer',
    }) : null,
  });
}

// A physical navigation transaction owns one inputEpoch for its full contact
// lifetime. Direction reversals update only the evidence attached to that
// epoch; they must neither mint a second epoch nor leave evidence from the
// previous direction able to authorize following later.
export function updateReadingControl(session, {
  inputEpoch, direction = 'browse', gestureID = '', geometryRevision,
  source = '', sourceID = '',
} = {}) {
  if (Number(inputEpoch) !== session.inputEpoch) return session;
  const nextEvidence = direction === 'newer' ? Object.freeze({
    gestureID: String(gestureID || inputEpoch),
    inputEpoch: session.inputEpoch,
    geometryRevision: Number.isFinite(geometryRevision) ? geometryRevision : session.geometryRevision,
    direction: 'newer',
  }) : null;
  const evidence = session.tailEvidence;
  const sameEvidence = evidence === nextEvidence || Boolean(
    evidence && nextEvidence
    && evidence.gestureID === nextEvidence.gestureID
    && evidence.inputEpoch === nextEvidence.inputEpoch
    && evidence.geometryRevision === nextEvidence.geometryRevision
    && evidence.direction === nextEvidence.direction
  );
  const positionRowLease = direction === 'newer' ? null : session.positionRowLease;
  const historyAnchor = direction === 'newer' ? null : session.historyAnchor || null;
  // A key-Home transaction has no native top movement. Virtuoso can emit a
  // synthetic scroll while older pages are admitted; that callback still
  // carries the Home coordinator source and must not revoke the semantic
  // history-start lease. A real newer transaction (wheel/touch/key End) uses
  // a different source and therefore retires it synchronously.
  const homeSyntheticScroll = session.historyStartIntent
    && String(source) === 'key' && String(sourceID) === 'Home';
  if (homeSyntheticScroll) return session;
  const historyStartIntent = direction === 'newer'
    ? null : session.historyStartIntent || null;
  if (sameEvidence && positionRowLease === session.positionRowLease
    && historyAnchor === session.historyAnchor
    && historyStartIntent === session.historyStartIntent
    && !session.bottomIntent.id && !session.contentAnchor) return session;
  return next(session, {
    mode: READING_MODE.browsing,
    bottomIntent: idleBottomIntent(),
    contentAnchor: idleContentAnchor(),
    positionRowLease,
    historyAnchor,
    historyStartIntent,
    tailEvidence: sameEvidence ? evidence : nextEvidence,
  });
}

export function cancelReadingControl(session, { inputEpoch, gestureID = '' } = {}) {
  if (Number(inputEpoch) !== session.inputEpoch) return session;
  const evidence = session.tailEvidence;
  if ((!evidence || (gestureID && evidence.gestureID !== String(gestureID)))
    && !session.historyStartIntent) return session;
  return next(session, { tailEvidence: null, historyStartIntent: null });
}

export function cancelHistoryStartIntent(session, intent = null) {
  if (!session?.historyStartIntent
    || (intent && !sameHistoryStartIntent(session.historyStartIntent, intent))) return session;
  return next(session, {
    inputEpoch: session.inputEpoch + 1,
    intentRevision: session.intentRevision + 1,
    contentAnchor: idleContentAnchor(),
    positionRowLease: null,
    historyAnchor: null,
    historyStartIntent: null,
    tailEvidence: null,
  });
}

export function historyStartIntentCommand(session, authority = {}) {
  const intent = session?.historyStartIntent;
  if (!intent || intent.type !== 'history-start'
    || intent.activationID !== session.activationID
    || String(authority.channelID || '') !== intent.channelID
    || String(authority.viewKey || '') !== intent.viewKey
    || Number(authority.generation) !== Number(intent.generation)
    || String(authority.sourceLease || '') !== intent.sourceLease
    || Number(authority.inputEpoch) !== Number(intent.inputEpoch)
    || Number(authority.intentRevision) !== Number(intent.intentRevision)) return null;
  return intent;
}

export function consumeHistoryStartIntent(session, intent = null) {
  if (!session?.historyStartIntent || !sameHistoryStartIntent(session.historyStartIntent, intent)) return session;
  return next(session, { historyStartIntent: null });
}

// A surface disappearance is a semantic lease boundary even when no native
// gesture occurred. Advance the owner epoch without changing following vs
// browsing; a later visible paint must therefore publish a receipt newer than
// the typed hidden/cleanup revoke, while any queued geometry command is fenced
// by the same input epoch.
export function advanceReadingInputEpoch(session) {
  return next(session, {
    inputEpoch: session.inputEpoch + 1,
    intentRevision: session.intentRevision + 1,
    bottomIntent: idleBottomIntent(),
    contentAnchor: idleContentAnchor(),
    positionRowLease: null,
    historyAnchor: null,
    historyStartIntent: null,
    tailEvidence: null,
  });
}

export function observeReading(session, observation = {}) {
  if (observation.activationID && observation.activationID !== session.activationID) return session;
  const observedGeometryRevision = Number(observation.geometryRevision) || 0;
  const geometryRevision = Math.max(session.geometryRevision, observedGeometryRevision);
  const observed = normalizedBookmark(observation.bookmark);
  const evidence = session.tailEvidence;
  const reachedByCurrentInput = Boolean(
    observation.atTail
    && observation.source === 'user'
    && evidence?.direction === 'newer'
    && evidence.inputEpoch === session.inputEpoch
    && Number(observation.inputEpoch) === session.inputEpoch
    && evidence.geometryRevision === observedGeometryRevision,
  );
  const mode = reachedByCurrentInput ? READING_MODE.following : session.mode;
  const bookmark = mode === READING_MODE.following
    ? null
    : observed || session.bookmark;
  const tailEvidence = reachedByCurrentInput ? null : session.tailEvidence;
  const contentAnchor = mode === READING_MODE.following ? idleContentAnchor() : session.contentAnchor;
  const positionRowLease = mode === READING_MODE.following ? null : session.positionRowLease;
  const historyAnchor = mode === READING_MODE.following ? null : session.historyAnchor;
  const historyStartIntent = mode === READING_MODE.following ? null : session.historyStartIntent;
  if (geometryRevision === session.geometryRevision
    && mode === session.mode
    && sameBookmark(bookmark, session.bookmark)
    && tailEvidence === session.tailEvidence
    && contentAnchor === session.contentAnchor
    && positionRowLease === session.positionRowLease
    && historyAnchor === session.historyAnchor
    && historyStartIntent === session.historyStartIntent) return session;
  return next(session, {
    geometryRevision, mode, bookmark, tailEvidence, contentAnchor,
    positionRowLease, historyAnchor, historyStartIntent,
  });
}

// This is the product's one explicit scrolling intent. If rows are not ready,
// the adapter may consume it later only while activation and inputEpoch still
// match. Any native input or channel/view replacement invalidates it.
export function requestLatest(session, id, {
  afterPresentationRevision = 0,
  baselineTailID = '',
  targetMessageIDs = [],
  // A public return-to-tail is a new authority transaction when the reader
  // is browsing. The caller supplies this only for an explicit user intent;
  // passive append/paint paths must keep using the current epoch.
  mintSuccessorEpoch = false,
} = {}) {
  if (!id) throw new TypeError('latest intent requires id');
  const authority = mintSuccessorEpoch === true && session.mode === READING_MODE.browsing
    ? Object.freeze({
      ...session,
      inputEpoch: session.inputEpoch + 1,
      bottomIntent: idleBottomIntent(),
      contentAnchor: idleContentAnchor(),
      positionRowLease: null,
      historyAnchor: null,
      tailEvidence: null,
    })
    : session;
  return next(authority, {
    intentRevision: session.intentRevision + 1,
    mode: READING_MODE.following,
    bookmark: null,
    contentAnchor: idleContentAnchor(),
    positionRowLease: null,
    historyAnchor: null,
    historyStartIntent: null,
    tailEvidence: null,
    bottomIntent: Object.freeze({
      id: String(id),
      inputEpoch: authority.inputEpoch,
      afterPresentationRevision: Math.max(0, Number(afterPresentationRevision) || 0),
      baselineTailID: String(baselineTailID || ''),
      targetMessageIDs: Object.freeze([...new Set((targetMessageIDs || []).map(String).filter(Boolean))]),
    }),
  });
}

// A semantic content choice (for example folding a body) may change the
// measured height of rows above the reader's current anchor. Capture only the
// anchor identity and its pre-choice viewport offset here. The list adapter
// later turns this pending intent into the one typed DOM command after the
// committed presentation reports a changed extent.
export function captureContentAnchor(session, {
  anchorID = '',
  viewportOffset,
  beforeScrollHeight,
  expectedExpanded = null,
} = {}) {
  if (session.mode !== READING_MODE.browsing
    || !anchorID
    || !Number.isFinite(Number(viewportOffset))
    || !Number.isFinite(Number(beforeScrollHeight))) return session;
  return next(session, {
    positionRowLease: null,
    contentAnchor: Object.freeze({
      activationID: session.activationID,
      inputEpoch: session.inputEpoch,
      anchorID: String(anchorID),
      viewportOffset: Number(viewportOffset),
      beforeScrollHeight: Number(beforeScrollHeight),
      expectedExpanded: expectedExpanded == null ? null : Boolean(expectedExpanded),
    }),
  });
}

// A history prepend may change the native list extent before the browser has
// painted the accepted rows. This lease is the semantic handoff for that one
// exact presentation: only the current Reading owner may accept it, and only
// the sole Vendor adapter may consume it after the row reaches its captured
// offset. It is intentionally not persisted as a bookmark or a new scroll
// owner.
export function acceptPositionRowLease(session, lease) {
  const normalized = normalizedPositionRowLease(lease);
  if (!normalized
    || normalized.activationID !== session.activationID
    || Number(normalized.inputEpoch) !== session.inputEpoch
    || Number(normalized.intentRevision) !== session.intentRevision
    || session.mode !== READING_MODE.browsing) return session;
  if (samePositionRowLease(session.positionRowLease, normalized)) return session;
  // A second accepted prepend may not overwrite a lease whose actual-paint
  // outcome is still unknown. The scheduler must wait for consumption or an
  // explicit revoke before issuing a new top operation.
  if (session.positionRowLease) return session;
  return next(session, { positionRowLease: normalized });
}

export function positionRowLeaseCommand(session) {
  const lease = normalizedPositionRowLease(session?.positionRowLease);
  if (!lease
    || lease.activationID !== session.activationID
    || Number(lease.inputEpoch) !== session.inputEpoch
    || Number(lease.intentRevision) !== session.intentRevision
    || session.mode !== READING_MODE.browsing) return null;
  return lease;
}

export function consumePositionRowLease(session, command = {}) {
  const lease = positionRowLeaseCommand(session);
  if (!lease || !samePositionRowLease(lease, command)) return session;
  return next(session, { positionRowLease: null });
}

// After a successful prepend the old first row is no longer the baseline for
// the next top request. Capture the new first row only from the actual painted
// DOM handoff; this updates semantic evidence without minting a scroll command.
export function updateHistoryAnchor(session, anchor = null) {
  if (session.mode !== READING_MODE.browsing || session.positionRowLease) return session;
  const normalized = normalizedHistoryAnchor(session, anchor);
  if (!normalized) return session;
  const previous = session.historyAnchor;
  if (previous
    && previous.activationID === normalized.activationID
    && previous.inputEpoch === normalized.inputEpoch
    && previous.intentRevision === normalized.intentRevision
    && previous.messageID === normalized.messageID
    && previous.viewportOffset === normalized.viewportOffset) return session;
  return next(session, { historyAnchor: normalized });
}

export function revokePositionRowLease(session, command = null, { clearHistoryAnchor = false } = {}) {
  const lease = session?.positionRowLease;
  if (!lease || (command && !samePositionRowLease(lease, command))) return session;
  const anchor = session.historyAnchor;
  const clearAnchor = clearHistoryAnchor && anchor
    && anchor.activationID === lease.activationID
    && Number(anchor.inputEpoch) === Number(lease.inputEpoch)
    && Number(anchor.intentRevision) === Number(lease.intentRevision)
    && anchor.messageID === lease.messageID;
  return next(session, {
    positionRowLease: null,
    ...(clearAnchor ? { historyAnchor: null } : {}),
  });
}

export function contentAnchorCommand(session) {
  const anchor = session.contentAnchor;
  if (!anchor
    || anchor.activationID !== session.activationID
    || anchor.inputEpoch !== session.inputEpoch
    || session.mode !== READING_MODE.browsing) return null;
  return Object.freeze({
    type: 'restore-content-anchor',
    activationID: anchor.activationID,
    inputEpoch: anchor.inputEpoch,
    anchorID: anchor.anchorID,
    viewportOffset: anchor.viewportOffset,
    beforeScrollHeight: anchor.beforeScrollHeight,
    expectedExpanded: anchor.expectedExpanded,
  });
}

export function consumeContentAnchor(session, command = {}) {
  const anchor = session.contentAnchor;
  if (!anchor
    || command.type !== 'restore-content-anchor'
    || command.activationID !== session.activationID
    || Number(command.inputEpoch) !== session.inputEpoch
    || command.anchorID !== anchor.anchorID
    || Number(command.beforeScrollHeight) !== anchor.beforeScrollHeight) return session;
  return next(session, { contentAnchor: idleContentAnchor() });
}

// Durable acceptance correlates the stable outbox identities with the
// already-issued send intent. It does not mint or refresh scrolling authority.
export function bindLatestIntentTargets(session, {
  activationID,
  inputEpoch,
  intentRevision,
} = {}, messageIDs = []) {
  const targets = [...new Set((messageIDs || []).map(String).filter(Boolean))];
  if (activationID !== session.activationID
    || Number(inputEpoch) !== session.inputEpoch
    || Number(intentRevision) !== session.intentRevision
    || !session.bottomIntent.id
    || !targets.length) return session;
  return next(session, {
    bottomIntent: Object.freeze({ ...session.bottomIntent, targetMessageIDs: Object.freeze(targets) }),
  });
}

export function consumeLatestIntent(session, { id, inputEpoch, activationID } = {}) {
  if (activationID !== session.activationID
    || !id
    || session.bottomIntent.id !== id
    || session.bottomIntent.inputEpoch !== session.inputEpoch
    || Number(inputEpoch) !== session.bottomIntent.inputEpoch) return session;
  return next(session, { bottomIntent: idleBottomIntent() });
}

export function persistentReadingSession(session) {
  return Object.freeze({
    revision: session.revision,
    mode: session.mode,
    bookmark: session.mode === READING_MODE.browsing ? session.bookmark : null,
  });
}
