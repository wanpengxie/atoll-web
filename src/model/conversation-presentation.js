import { argsOf } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

function finiteSeq(value) {
  const seq = Number(value || 0);
  return Number.isFinite(seq) && seq > 0 ? seq : 0;
}

function envelopeSeq(envelope) {
  return finiteSeq(envelope?.seq || envelope?._seq);
}

function boundsOf(entry) {
  if (entry?.kind !== 'turn') {
    const seq = finiteSeq(entry?.seq);
    return { low: seq, high: seq };
  }
  const turn = entry.turn || {};
  const seqs = [
    finiteSeq(entry.seq), finiteSeq(turn.requestSeq), finiteSeq(turn.lastSeq),
    envelopeSeq(turn.request), finiteSeq(turn.terminalSeq), envelopeSeq(turn.terminal),
  ];
  for (const child of entry.thread || []) {
    const childTurn = child?.turn || {};
    seqs.push(
      finiteSeq(child?.seq), finiteSeq(childTurn.requestSeq), finiteSeq(childTurn.lastSeq),
      finiteSeq(childTurn.terminalSeq), envelopeSeq(childTurn.request), envelopeSeq(childTurn.terminal),
    );
    for (const provisional of childTurn.provisional || []) {
      seqs.push(finiteSeq(provisional?.seq), envelopeSeq(provisional?.envelope));
    }
  }
  const present = seqs.filter(Boolean);
  const fallback = finiteSeq(entry.seq);
  return {
    low: present.length ? Math.min(...present) : fallback,
    high: present.length ? Math.max(...present) : fallback,
  };
}

function identityOf(entry) {
  if (entry?.kind === 'turn') return entry.turn?.requestId || entry.turn?.request?.id || '';
  if (entry?.kind === 'narration') return `narration:${finiteSeq(entry.seq)}`;
  return entry?.envelope?.id || `${entry?.kind || 'entry'}:${finiteSeq(entry?.seq)}`;
}

function entryContainsTimelineSubject(entry, subjectID) {
  if (!subjectID || identityOf(entry) === subjectID) return true;
  return (entry?.thread || []).some((item) => item?.turn?.requestId === subjectID);
}

function actorOf(entry) {
  if (entry?.kind === 'turn') {
    return entry.turn?.request?.audience?.[0]
      || entry.turn?.terminal?.sender?.id
      || entry.turn?.request?.sender?.id
      || '';
  }
  return entry?.envelope?.sender?.id || '';
}

function timestampOf(entry) {
  return Number(entry?.kind === 'turn' ? entry.turn?.request?.ts : entry?.envelope?.ts) || 0;
}

function authorOf(entry) {
  return entry?.kind === 'turn' ? entry.turn?.request?.sender?.id : entry?.envelope?.sender?.id || '';
}

function endAuthorOf(entry) {
  return entry?.kind === 'turn'
    ? entry.turn?.terminal?.sender?.id || entry.turn?.request?.sender?.id || ''
    : entry?.envelope?.sender?.id || '';
}

function conversational(entry) {
  return entry?.kind === 'standalone'
    || (entry?.kind === 'turn' && ![TYPES.humanAsk, TYPES.humanApprove].includes(entry.turn?.request?.type));
}

function dayOf(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function continuationOf(previous, current) {
  if (!conversational(previous) || !conversational(current)) return false;
  const delta = timestampOf(current) - timestampOf(previous);
  return Boolean(authorOf(current))
    && authorOf(current) === endAuthorOf(previous)
    && delta >= 0
    && delta <= 5 * 60_000;
}

function layoutClassOf(entry) {
  if (entry?.kind === 'narration') return 'compact';
  const envelope = entry?.kind === 'turn' ? entry.turn?.request : entry?.envelope;
  const payload = argsOf(envelope);
  const text = String(payload?.text || payload?.body || '');
  const attachments = payload?.attachments || payload?.files || [];
  if (attachments.length || text.includes('```') || text.length > 1_200) return 'rich';
  if (entry?.kind === 'turn') return entry.turn?.terminal ? 'normal' : 'reserved';
  return text.length < 120 ? 'compact' : 'normal';
}

function settledOf(entry) {
  if (entry?.kind === 'turn') return Boolean(entry.turn?.terminal);
  if (entry?.kind === 'narration') return true;
  return argsOf(entry?.envelope)?.transient !== true;
}

const CURRENT_ENTRY_EXCLUDED_TYPES = new Set([
  TYPES.humanAsk,
  TYPES.humanApprove,
  TYPES.agentSelect,
  TYPES.agentNew,
  TYPES.agentHold,
  TYPES.agentHoldExpired,
  TYPES.agentUnhold,
  TYPES.agentInterrupt,
  TYPES.agentContext,
  TYPES.agentOptions,
  TYPES.agentFork,
  TYPES.describe,
]);

// Current-entry eligibility is a Presentation concern. Consumers must not
// infer it from the last locally loaded/materialized row: a historical window
// can have a local last row without containing the authoritative view tail.
function currentEntryEligible(entry) {
  if (entry?.kind !== 'turn' && entry?.kind !== 'standalone') return false;
  const envelope = entry.kind === 'turn' ? entry.turn?.request : entry.envelope;
  const type = String(envelope?.type || '');
  return Boolean(envelope)
    && !type.startsWith('ui.')
    && !CURRENT_ENTRY_EXCLUDED_TYPES.has(type);
}

function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, item] of value) { deepFreeze(key, seen); deepFreeze(item, seen); }
    return value;
  }
  if (Array.isArray(value)) for (const item of value) deepFreeze(item, seen);
  else for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function readonlyIndex(source) {
  const api = {
    get size() { return source.size; },
    get: (key) => source.get(key),
    has: (key) => source.has(key),
    keys: () => source.keys(),
    values: () => source.values(),
    entries: () => source.entries(),
    forEach: (fn, thisArg) => source.forEach((value, key) => fn.call(thisArg, value, key, api)),
    [Symbol.iterator]: () => source[Symbol.iterator](),
  };
  return Object.freeze(api);
}

function candidateOf(entry, previous, next, preservedContinuation, contentVersion, visualSlotID = '') {
  const bounds = boundsOf(entry);
  const timestamp = timestampOf(entry);
  const nextTimestamp = timestampOf(next);
  const localState = entry?.local ? String((entry.turn?.request || entry.envelope)?.local_submission_state || 'queued') : '';
  const candidate = {
    id: identityOf(entry),
    visualSlotID: visualSlotID || identityOf(entry),
    seqLow: bounds.low,
    seqHigh: bounds.high,
    kind: entry?.kind === 'narration' ? 'boundary' : entry?.kind === 'turn' ? 'turn' : 'notice',
    actorID: actorOf(entry),
    timestamp,
    dayKey: dayOf(timestamp),
    boundaryAfterTimestamp: timestamp && nextTimestamp && dayOf(timestamp) !== dayOf(nextTimestamp)
      ? nextTimestamp
      : 0,
    continuation: typeof preservedContinuation === 'boolean'
      ? preservedContinuation
      : continuationOf(previous, entry),
    contentRevision: `${bounds.high}:${Math.max(0, Number(contentVersion) || 0)}`,
    layoutClass: layoutClassOf(entry),
    settled: settledOf(entry),
    localState,
    currentEntryEligible: currentEntryEligible(entry),
  };
  candidate.signature = [
    candidate.id, candidate.visualSlotID, candidate.seqLow, candidate.seqHigh, candidate.kind, candidate.actorID,
    candidate.timestamp, candidate.dayKey, candidate.boundaryAfterTimestamp,
    candidate.continuation ? 1 : 0, candidate.contentRevision, candidate.layoutClass,
    candidate.settled ? 1 : 0, candidate.localState, candidate.currentEntryEligible ? 1 : 0,
  ].join('\u001f');
  return candidate;
}

function reciprocalReplacement(oldEntry, newEntry, oldID, newID) {
  if (oldEntry?.kind !== 'turn' || newEntry?.kind !== 'turn') return false;
  if (newEntry.turn?.request?.type !== TYPES.agentReplace) return false;
  const target = String(argsOf(newEntry.turn.request)?.target || '');
  const terminal = argsOf(oldEntry.turn?.terminal);
  const replacedBy = String(terminal?.replaced_by ?? terminal?.value?.replaced_by ?? '');
  return target === oldID && replacedBy === newID;
}

// A replacement is allowed to inherit geometry only when Presentation itself
// observes one committed row leave and its reciprocal successor enter the same
// visual position in the same view/epoch. Protocol ancestry alone is not
// enough: a filtered successor or one folded into another stable root is not a
// replacement row in this Presentation and receives no slot handoff.
function replacementSlots(owner, entries, ordered, viewChanged, epoch) {
  if (viewChanged || owner.snapshot.epoch !== epoch || ordered.length === 0) return new Map();
  const previousIDs = owner.snapshot.orderedIDs;
  const previousCounts = new Map();
  const nextCounts = new Map();
  for (const id of previousIDs) previousCounts.set(id, (previousCounts.get(id) || 0) + 1);
  for (const id of ordered) nextCounts.set(id, (nextCounts.get(id) || 0) + 1);
  const slots = new Map();
  const neighbour = (ids, index, admitted, direction) => {
    for (let cursor = index + direction; cursor >= 0 && cursor < ids.length; cursor += direction) {
      if (admitted.has(ids[cursor])) return ids[cursor];
    }
    return '';
  };
  for (let index = 0; index < ordered.length; index += 1) {
    const newID = ordered[index];
    const newEntry = entries[index];
    const oldID = String(argsOf(newEntry?.turn?.request)?.target || '');
    const oldIndex = owner.indexesByID.get(oldID);
    if (!oldID || !Number.isInteger(oldIndex) || oldID === newID) continue;
    if (previousCounts.get(oldID) !== 1 || nextCounts.get(newID) !== 1) continue;
    if (nextCounts.has(oldID) || previousCounts.has(newID)) continue;
    const oldEntry = owner.entriesByID.get(oldID);
    if (!reciprocalReplacement(oldEntry, newEntry, oldID, newID)) continue;
    const sameVisualPosition = neighbour(previousIDs, oldIndex, nextCounts, -1) === neighbour(ordered, index, previousCounts, -1)
      && neighbour(previousIDs, oldIndex, nextCounts, 1) === neighbour(ordered, index, previousCounts, 1);
    if (!sameVisualPosition) continue;
    slots.set(newID, owner.rowsByID.get(oldID)?.visualSlotID || oldID);
  }
  return slots;
}

function materialize(candidate, entry) {
  const { signature, currentEntryEligible: _currentEntryEligible, ...fields } = candidate;
  return Object.freeze({
    ...fields,
    role: Object.freeze({ latest: false }),
    body: deepFreeze(clone(entry)),
  });
}

// Virtuoso requires a positive logical origin so true prepends can decrement
// firstItemIndex. Keeping it in the immutable presentation snapshot makes the
// data and its prepend coordinate one atomic React input.
const FIRST_ITEM_INDEX_ORIGIN = 1_000_000;

function emptySnapshot() {
  return Object.freeze({
    epoch: '', viewID: '', revision: 0, baseRevision: 0, sourceRevision: 0,
    firstItemIndex: FIRST_ITEM_INDEX_ORIGIN,
    currentEntryCandidate: null,
    roleRevision: 0,
    roleChanges: Object.freeze({ updated: Object.freeze([]) }),
    orderedIDs: Object.freeze([]), entities: readonlyIndex(new Map()), rows: Object.freeze([]),
    changes: Object.freeze({
      kind: 'empty', prefixCount: 0,
      frontInsertedIDs: Object.freeze([]), backInsertedIDs: Object.freeze([]),
      inserted: Object.freeze([]), updated: Object.freeze([]), removed: Object.freeze([]),
    }),
  });
}

function initialPresentationState() {
  return {
    viewID: '', revision: 0, sourceRevision: 0, entriesReference: null,
    entriesByID: new Map(), indexesByID: new Map(), rowsByID: new Map(),
    signatures: new Map(), contentVersions: new Map(), currentEntryEligibility: new Map(),
    snapshot: emptySnapshot(),
  };
}

// Compute against one immutable owner version. Maps are cloned before any
// write, so a render candidate cannot mutate the last committed Presentation.
function evaluatePresentation(owner, entries = [], {
  epoch = '', nextViewID = '', sourceRevision: nextSourceRevision = 0,
  sourceChangeBase = 0, sourceChanges = [],
} = {}) {
  const viewChanged = nextViewID !== owner.viewID;
  const viewID = nextViewID;
  const revision = owner.revision;
  let sourceRevision = viewChanged ? 0 : owner.sourceRevision;
  let entriesReference = viewChanged ? null : owner.entriesReference;
  let entriesByID = viewChanged ? new Map() : owner.entriesByID;
  let indexesByID = viewChanged ? new Map() : owner.indexesByID;
  let rowsByID = viewChanged ? new Map() : owner.rowsByID;
  let signatures = viewChanged ? new Map() : owner.signatures;
  let contentVersions = viewChanged ? new Map() : owner.contentVersions;
  let currentEntryEligibility = viewChanged ? new Map() : owner.currentEntryEligibility;
  let snapshot = owner.snapshot;
  const incrementalChanges = sourceChanges.filter((change) => Number(change.revision) > sourceRevision);
  const revisionAdvanced = Number(nextSourceRevision) > sourceRevision;
  const canIncrement = !viewChanged
    && snapshot.epoch === epoch
    && entries === entriesReference
    && sourceRevision >= Number(sourceChangeBase || 0)
    && (!revisionAdvanced || incrementalChanges.length > 0)
    && incrementalChanges.every((change) => change.kind === 'content');
  // The exact committed entries array already has an owner-private identity
  // index. Reuse it for the hot content-only path instead of rebuilding an
  // all-roots Map for one nested progress subject. A structural/rebased input
  // is about to pay the existing full rebuild below; bound its potentially
  // many subject lookups to one additional scan with an evaluate-local index.
  // This fallback is neither retained nor published as snapshot state.
  let rebuildSourceEntriesByID = null;
  const sourceEntry = canIncrement
    ? (id) => entriesByID.get(id)
    : (id) => {
      if (!rebuildSourceEntriesByID) {
        rebuildSourceEntriesByID = new Map();
        for (const entry of entries) rebuildSourceEntriesByID.set(identityOf(entry), entry);
      }
      return rebuildSourceEntriesByID.get(id);
    };
  // Fold names the visible root row and retains the mutated child as the
  // subject. A view that filtered that child out must consume the source clock
  // without manufacturing a content/geometry revision for an unchanged row.
  const visibleIncrementalChanges = incrementalChanges.filter((change) => (
    !change.subjectID || entryContainsTimelineSubject(sourceEntry(change.id), change.subjectID)
  ));
  if (visibleIncrementalChanges.some((change) => change.id)) {
    contentVersions = new Map(contentVersions);
    for (const change of visibleIncrementalChanges) {
      if (change.id) contentVersions.set(change.id, Math.max(contentVersions.get(change.id) || 0, Number(change.revision) || 0));
    }
  }
  if (canIncrement) {
    const changedIDs = [...new Set(visibleIncrementalChanges.map((change) => change.id).filter(Boolean))];
    sourceRevision = Math.max(sourceRevision, Number(nextSourceRevision) || 0);
    if (!changedIDs.length) {
      if (snapshot.sourceRevision !== sourceRevision) snapshot = Object.freeze({ ...snapshot, sourceRevision });
      return {
        ...owner, viewID, sourceRevision, contentVersions, snapshot,
      };
    }
    const nextRows = new Map(rowsByID);
    const nextSignatures = new Map(signatures);
    const nextEligibility = new Map(currentEntryEligibility);
    const updated = [];
    for (const id of changedIDs) {
      const index = indexesByID.get(id);
      const entry = entriesByID.get(id);
      const previousRow = rowsByID.get(id);
      if (!Number.isInteger(index) || !entry || !previousRow) continue;
      const candidate = candidateOf(
        entry,
        entries[index - 1],
        entries[index + 1],
        previousRow.continuation,
        contentVersions.get(id),
        previousRow.visualSlotID || id,
      );
      if (nextSignatures.get(id) === candidate.signature) continue;
      nextRows.set(id, materialize(candidate, entry));
      nextSignatures.set(id, candidate.signature);
      nextEligibility.set(id, candidate.currentEntryEligible);
      updated.push(id);
    }
    if (!updated.length) {
      if (snapshot.sourceRevision !== sourceRevision) snapshot = Object.freeze({ ...snapshot, sourceRevision });
      return {
        ...owner, viewID, sourceRevision, contentVersions, snapshot,
      };
    }
    const nextRevision = revision + 1;
    const rows = Object.freeze(snapshot.orderedIDs.map((id) => nextRows.get(id)));
    const currentEntryRow = [...snapshot.orderedIDs].reverse().find((id) => nextEligibility.get(id));
    const currentEntryCandidate = currentEntryRow
      ? Object.freeze({
        id: currentEntryRow,
        seqHigh: Number(nextRows.get(currentEntryRow)?.seqHigh || 0),
        local: nextRows.get(currentEntryRow)?.body?.local === true,
      })
      : null;
    snapshot = Object.freeze({
      epoch, viewID, revision: nextRevision, baseRevision: revision, sourceRevision,
      firstItemIndex: snapshot.firstItemIndex, currentEntryCandidate,
      orderedIDs: snapshot.orderedIDs, entities: readonlyIndex(nextRows), rows,
      changes: Object.freeze({
        kind: 'revise', prefixCount: 0,
        frontInsertedIDs: Object.freeze([]), backInsertedIDs: Object.freeze([]),
        inserted: Object.freeze([]), updated: Object.freeze(updated), removed: Object.freeze([]),
      }),
    });
    return {
      ...owner, viewID, revision: nextRevision, sourceRevision,
      rowsByID: nextRows, signatures: nextSignatures,
      contentVersions, currentEntryEligibility: nextEligibility, snapshot,
    };
  }

  const nextRows = new Map();
  const nextSignatures = new Map();
  const nextEntries = new Map();
  const nextIndexes = new Map();
  const nextEligibility = new Map();
  const preparedEntries = [...entries];
  const ordered = preparedEntries.map(identityOf);
  const visualSlots = replacementSlots(owner, preparedEntries, ordered, viewChanged, epoch);
  const inserted = [];
  const updated = [];
  for (let index = 0; index < preparedEntries.length; index += 1) {
    const entry = preparedEntries[index];
    const id = identityOf(entry);
    const previousRow = rowsByID.get(id);
    const candidate = candidateOf(
      entry,
      preparedEntries[index - 1],
      preparedEntries[index + 1],
      previousRow?.continuation,
      contentVersions.get(id),
      visualSlots.get(id) || previousRow?.visualSlotID || id,
    );
    const unchanged = signatures.get(id) === candidate.signature;
    const row = unchanged ? previousRow : materialize(candidate, entry);
    if (!previousRow) inserted.push(id);
    else if (!unchanged) updated.push(id);
    nextRows.set(id, row);
    nextSignatures.set(id, candidate.signature);
    nextEntries.set(id, entry);
    nextIndexes.set(id, index);
    nextEligibility.set(id, candidate.currentEntryEligible);
  }
  const removed = [...rowsByID.keys()].filter((id) => !nextRows.has(id));
  const orderChanged = ordered.length !== snapshot.orderedIDs.length
    || ordered.some((id, index) => snapshot.orderedIDs[index] !== id);
  const changed = inserted.length || updated.length || removed.length || orderChanged
    || snapshot.viewID !== viewID || snapshot.epoch !== epoch;
  entriesReference = entries;
  entriesByID = nextEntries;
  indexesByID = nextIndexes;
  rowsByID = nextRows;
  signatures = nextSignatures;
  currentEntryEligibility = nextEligibility;
  sourceRevision = Math.max(0, Number(nextSourceRevision) || 0);
  if (!changed) {
    if (snapshot.sourceRevision !== sourceRevision) snapshot = Object.freeze({ ...snapshot, sourceRevision });
    return {
      viewID, revision, sourceRevision, entriesReference, entriesByID, indexesByID,
      rowsByID, signatures, contentVersions, currentEntryEligibility, snapshot,
    };
  }
  const previousIDs = snapshot.orderedIDs;
  const previousStart = previousIDs.length ? ordered.indexOf(previousIDs[0]) : -1;
  const orderedPrevious = !viewChanged && previousStart >= 0
    && !removed.length
    && previousIDs.every((id, index) => ordered[previousStart + index] === id);
  const frontCandidate = orderedPrevious ? ordered.slice(0, previousStart) : [];
  const backCandidate = orderedPrevious ? ordered.slice(previousStart + previousIDs.length) : [];
  const insertedSet = new Set(inserted);
  const continuousPrevious = orderedPrevious
    && frontCandidate.length + backCandidate.length === inserted.length
    && [...frontCandidate, ...backCandidate].every((id) => insertedSet.has(id));
  const frontInsertedIDs = Object.freeze(continuousPrevious ? frontCandidate : []);
  const backInsertedIDs = Object.freeze(continuousPrevious ? backCandidate : []);
  const prefixCount = frontInsertedIDs.length;
  const structuralKind = frontInsertedIDs.length && backInsertedIDs.length
    ? 'mixed'
    : frontInsertedIDs.length
      ? 'prepend'
      : backInsertedIDs.length
        ? 'append'
        : orderChanged || removed.length
          ? 'mixed'
          : 'revise';
  const nextRevision = revision + 1;
  const rows = Object.freeze(ordered.map((id) => nextRows.get(id)));
  const currentEntryRow = [...ordered].reverse().find((id) => nextEligibility.get(id));
  const currentEntryCandidate = currentEntryRow
    ? Object.freeze({
      id: currentEntryRow,
      seqHigh: Number(nextRows.get(currentEntryRow)?.seqHigh || 0),
      local: nextRows.get(currentEntryRow)?.body?.local === true,
    })
    : null;
  const firstItemIndex = viewChanged || previousIDs.length === 0
    ? FIRST_ITEM_INDEX_ORIGIN
    : continuousPrevious && prefixCount > 0
      ? Math.max(1, snapshot.firstItemIndex - prefixCount)
      : snapshot.firstItemIndex;
  snapshot = Object.freeze({
    epoch, viewID, revision: nextRevision, baseRevision: revision, sourceRevision,
    firstItemIndex, currentEntryCandidate, orderedIDs: Object.freeze([...ordered]),
    entities: readonlyIndex(nextRows), rows,
    changes: Object.freeze({
      kind: viewChanged ? 'rebase' : structuralKind,
      prefixCount: continuousPrevious ? prefixCount : 0,
      frontInsertedIDs, backInsertedIDs,
      inserted: Object.freeze(inserted), updated: Object.freeze(updated), removed: Object.freeze(removed),
    }),
  });
  return {
    viewID, revision: nextRevision, sourceRevision, entriesReference, entriesByID, indexesByID,
    rowsByID, signatures, contentVersions, currentEntryEligibility, snapshot,
  };
}

// Published rows never reach through getters into the mutable channel model.
// Changed entities receive detached bodies; unchanged rows retain identity.
export function createConversationPresentation() {
  let owner = initialPresentationState();
  const consumedReceipts = new WeakSet();

  function evaluate(entries = [], options = {}) {
    const nextOwner = evaluatePresentation(owner, entries, options);
    return Object.freeze({
      snapshot: nextOwner.snapshot,
      receipt: Object.freeze({ owner, nextOwner }),
    });
  }

  function commitCandidate(candidate) {
    if (!candidate?.receipt
      || consumedReceipts.has(candidate.receipt)
      || candidate.receipt.owner !== owner) return false;
    consumedReceipts.add(candidate.receipt);
    owner = candidate.receipt.nextOwner;
    return true;
  }

  function project(entries = [], options = {}) {
    const candidate = evaluate(entries, options);
    commitCandidate(candidate);
    return candidate.snapshot;
  }

  return Object.freeze({ evaluate, commitCandidate, project, current: () => owner.snapshot });
}

function authorizedLatestID(snapshot, authority) {
  const candidate = snapshot?.currentEntryCandidate;
  return authority
    && authority.epoch === snapshot.epoch
    && authority.viewID === snapshot.viewID
    && Number(authority.sourceRevision || 0) === Number(snapshot.sourceRevision || 0)
    && authority.candidateID === candidate?.id
    ? candidate.id
    : '';
}

function withLatestRole(snapshot, latestID, roleRevision, updated) {
  if (!snapshot?.rows) return snapshot;
  const rows = Object.freeze(snapshot.rows.map((row) => (
    row.id === latestID
      ? Object.freeze({ ...row, role: Object.freeze({ ...row.role, latest: true }) })
      : row
  )));
  const entities = readonlyIndex(new Map(rows.map((row) => [row.id, row])));
  return Object.freeze({
    ...snapshot,
    roleRevision,
    roleChanges: Object.freeze({ updated: Object.freeze([...updated]) }),
    rows,
    entities,
  });
}

// Role publication has its own monotonic commit clock. It deliberately does
// not modify contentRevision, Presentation revision, or the geometry key, but
// it does name the exact rows whose rendered fold role changed so the list can
// admit the resulting public height acknowledgement through its existing
// single-writer transaction.
export function createConversationRoleFinalizer() {
  let owner = {
    roleKey: '', roleRevision: 0, latestID: '',
    cachedSnapshot: null, cachedLatestID: '', published: null,
  };
  const consumedReceipts = new WeakSet();

  function evaluate(snapshot, authority = null) {
    if (!snapshot?.rows) {
      return Object.freeze({ snapshot, receipt: Object.freeze({ owner, nextOwner: owner }) });
    }
    const nextRoleKey = `${snapshot.epoch}\u001f${snapshot.viewID}`;
    const base = nextRoleKey === owner.roleKey ? owner : {
      roleKey: nextRoleKey, roleRevision: 0, latestID: '',
      cachedSnapshot: null, cachedLatestID: '', published: null,
    };
    const nextLatestID = authorizedLatestID(snapshot, authority);
    if (base.cachedSnapshot === snapshot && base.cachedLatestID === nextLatestID) {
      return Object.freeze({
        snapshot: base.published,
        receipt: Object.freeze({ owner, nextOwner: base }),
      });
    }
    const updated = [];
    let nextRoleRevision = base.roleRevision;
    if (base.latestID !== nextLatestID) {
      if (base.latestID && snapshot.entities.has(base.latestID)) updated.push(base.latestID);
      if (nextLatestID && snapshot.entities.has(nextLatestID)) updated.push(nextLatestID);
      if (updated.length) nextRoleRevision += 1;
    }
    const published = withLatestRole(snapshot, nextLatestID, nextRoleRevision, updated);
    const nextOwner = {
      roleKey: nextRoleKey,
      roleRevision: nextRoleRevision,
      latestID: nextLatestID,
      cachedSnapshot: snapshot,
      cachedLatestID: nextLatestID,
      published,
    };
    return Object.freeze({
      snapshot: published,
      receipt: Object.freeze({ owner, nextOwner }),
    });
  }

  function commitCandidate(candidate) {
    if (!candidate?.receipt
      || consumedReceipts.has(candidate.receipt)
      || candidate.receipt.owner !== owner) return false;
    consumedReceipts.add(candidate.receipt);
    owner = candidate.receipt.nextOwner;
    return true;
  }

  function finalize(snapshot, authority = null) {
    const candidate = evaluate(snapshot, authority);
    commitCandidate(candidate);
    return candidate.snapshot;
  }

  return Object.freeze({
    evaluate, commitCandidate, finalize,
    current: () => owner.published,
  });
}

// Stateless helper kept for model callers that need only exact token
// validation. Production Timeline uses createConversationRoleFinalizer so role
// commits carry a monotonic revision and an exact updated-row set.
export function finalizeConversationPresentation(snapshot, authority = null) {
  const latestID = authorizedLatestID(snapshot, authority);
  if (!latestID) return snapshot;
  return withLatestRole(snapshot, latestID, latestID ? 1 : 0, latestID ? [latestID] : []);
}

export function presentationEntryId(entryOrRow) {
  return entryOrRow?.id || identityOf(entryOrRow);
}

export function presentationGeometryKey(rows = [], localLayoutKey = '') {
  let hash = 2166136261;
  const feed = (token) => {
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const row of rows) feed(`${row.id}\u001f${row.contentRevision}\u001f${row.layoutClass}\u001e`);
  feed(`\u001d${localLayoutKey}`);
  return `${rows.length}:${(hash >>> 0).toString(36)}`;
}
