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

export function createReadingSession({ key, activationID, saved = {} } = {}) {
  if (!key || !activationID) throw new TypeError('reading session requires key and activationID');
  const savedMode = saved.mode === READING_MODE.browsing ? READING_MODE.browsing : READING_MODE.following;
  return Object.freeze({
    key: String(key),
    activationID: String(activationID),
    revision: Math.max(0, Number(saved.revision) || 0),
    inputEpoch: 0,
    intentRevision: 0,
    geometryRevision: 0,
    mode: savedMode,
    bookmark: savedMode === READING_MODE.browsing ? normalizedBookmark(saved.bookmark) : null,
    bottomIntent: idleBottomIntent(),
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
export function takeReadingControl(session, { direction = 'browse', gestureID = '', geometryRevision } = {}) {
  const inputEpoch = session.inputEpoch + 1;
  return next(session, {
    inputEpoch,
    intentRevision: session.intentRevision + 1,
    mode: READING_MODE.browsing,
    bottomIntent: idleBottomIntent(),
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
  inputEpoch,
  direction = 'browse',
  gestureID = '',
  geometryRevision,
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
  if (sameEvidence && !session.bottomIntent.id) return session;
  return next(session, {
    mode: READING_MODE.browsing,
    bottomIntent: idleBottomIntent(),
    tailEvidence: sameEvidence ? evidence : nextEvidence,
  });
}

export function cancelReadingControl(session, { inputEpoch, gestureID = '' } = {}) {
  if (Number(inputEpoch) !== session.inputEpoch) return session;
  const evidence = session.tailEvidence;
  if (!evidence || (gestureID && evidence.gestureID !== String(gestureID))) return session;
  return next(session, { tailEvidence: null });
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
  if (geometryRevision === session.geometryRevision
    && mode === session.mode
    && sameBookmark(bookmark, session.bookmark)
    && tailEvidence === session.tailEvidence) return session;
  return next(session, { geometryRevision, mode, bookmark, tailEvidence });
}

// This is the product's one explicit scrolling intent. If rows are not ready,
// the adapter may consume it later only while activation and inputEpoch still
// match. Any native input or channel/view replacement invalidates it.
export function requestLatest(session, id, {
  afterPresentationRevision = 0,
  baselineTailID = '',
  targetMessageIDs = [],
} = {}) {
  if (!id) throw new TypeError('latest intent requires id');
  return next(session, {
    intentRevision: session.intentRevision + 1,
    mode: READING_MODE.following,
    bookmark: null,
    tailEvidence: null,
    bottomIntent: Object.freeze({
      id: String(id),
      inputEpoch: session.inputEpoch,
      afterPresentationRevision: Math.max(0, Number(afterPresentationRevision) || 0),
      baselineTailID: String(baselineTailID || ''),
      targetMessageIDs: Object.freeze([...new Set((targetMessageIDs || []).map(String).filter(Boolean))]),
    }),
  });
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
