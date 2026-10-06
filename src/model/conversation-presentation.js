import { argsOf, correlationOf } from '../protocol/envelope.js';
import { isConversationCall, isOperationCall, TYPES } from '../protocol/vocab.js';
import { subTaskEnds } from './background-tasks.js';
import { isControlOnlyTurn, weakNoticeEvent } from './conversation-visibility.js';
import { LIFECYCLE, memberRestarts, requestLifecycle } from './request-lifecycle.js';

function finiteSeq(value) {
  const seq = Number(value || 0);
  return Number.isFinite(seq) && seq > 0 ? seq : 0;
}

function envelopeSeq(envelope) {
  return finiteSeq(envelope?.seq || envelope?._seq);
}

function boundsOf(entry) {
  if (entry?.kind === 'narration') {
    // 一段叙事从第一条排到最后一条：后面再来一条（比如构建开始之后的构建结束），
    // 这一段的内容就变了，要重画。
    const seq = finiteSeq(entry.seq);
    return { low: seq, high: Math.max(seq, finiteSeq(entry.lastSeq)) };
  }
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

// A weak notice neither continues a message nor is continued by one.
function conversational(entry) {
  return (entry?.kind === 'standalone' && !weakNoticeEvent(entry.envelope))
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
  if (entry?.kind === 'standalone' && weakNoticeEvent(entry.envelope)) return 'compact';
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
  TYPES.storageGetURL,
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
    contentRevision: `${bounds.high}:${Math.max(0, Number(contentVersion) || 0)}${entry?.subTaskRevision ? `:${entry.subTaskRevision}` : ''}`,
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
  const replacedBy = String(terminal?.replaced_by || '');
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
  const epochChanged = epoch !== owner.snapshot.epoch;
  const ownerIdentityChanged = viewChanged || epochChanged;
  const viewID = nextViewID;
  const revision = owner.revision;
  let sourceRevision = ownerIdentityChanged ? 0 : owner.sourceRevision;
  let entriesReference = ownerIdentityChanged ? null : owner.entriesReference;
  let entriesByID = ownerIdentityChanged ? new Map() : owner.entriesByID;
  let indexesByID = ownerIdentityChanged ? new Map() : owner.indexesByID;
  let rowsByID = ownerIdentityChanged ? new Map() : owner.rowsByID;
  let signatures = ownerIdentityChanged ? new Map() : owner.signatures;
  let contentVersions = ownerIdentityChanged ? new Map() : owner.contentVersions;
  let currentEntryEligibility = ownerIdentityChanged ? new Map() : owner.currentEntryEligibility;
  let snapshot = owner.snapshot;
  const incrementalChanges = sourceChanges.filter((change) => Number(change.revision) > sourceRevision);
  const revisionAdvanced = Number(nextSourceRevision) > sourceRevision;
  const sameEntryOrder = entries === entriesReference || (
    entries.length === snapshot.orderedIDs.length
    && entries.every((entry, index) => identityOf(entry) === snapshot.orderedIDs[index])
  );
  const canIncrement = !ownerIdentityChanged
    && snapshot.epoch === epoch
    && sameEntryOrder
    && sourceRevision >= Number(sourceChangeBase || 0)
    && (!revisionAdvanced || incrementalChanges.length > 0)
    && incrementalChanges.every((change) => change.kind === 'content');
  // A content-only source revision preserves semantic order even when the
  // selection layer returns a fresh array wrapper. Reuse the committed
  // owner-private identity index instead of rebuilding an all-roots Map for
  // one nested progress subject. A structural/rebased input is about to pay
  // the existing full rebuild below; bound its potentially many subject
  // lookups to one additional scan with an evaluate-local index. This fallback
  // is neither retained nor published as snapshot state.
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
  const visualSlots = replacementSlots(owner, preparedEntries, ordered, ownerIdentityChanged, epoch);
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
  const orderedPrevious = !ownerIdentityChanged && previousStart >= 0
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
  const firstItemIndex = ownerIdentityChanged || previousIDs.length === 0
    ? FIRST_ITEM_INDEX_ORIGIN
    : continuousPrevious && prefixCount > 0
      ? Math.max(1, snapshot.firstItemIndex - prefixCount)
      : snapshot.firstItemIndex;
  snapshot = Object.freeze({
    epoch, viewID, revision: nextRevision, baseRevision: revision, sourceRevision,
    firstItemIndex, currentEntryCandidate, orderedIDs: Object.freeze([...ordered]),
    entities: readonlyIndex(nextRows), rows,
    changes: Object.freeze({
      kind: ownerIdentityChanged ? 'rebase' : structuralKind,
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

  return Object.freeze({ evaluate, commitCandidate, current: () => owner.snapshot });
}

export function presentationEntryId(entryOrRow) {
  return entryOrRow?.id || identityOf(entryOrRow);
}

export const CONVERSATION_SCOPE = Object.freeze({ all: 'all', mine: 'mine' });
export const TIMELINE_SCOPE = CONVERSATION_SCOPE;

const HIDDEN_CONVERSATION_TYPES = new Set([
  TYPES.agentHold,
  TYPES.agentUnhold,
  TYPES.agentInterrupt,
  TYPES.agentContext,
  TYPES.agentOptions,
  TYPES.agentFork,
  TYPES.describe,
]);
// A queued replace is its target's successor in Waiting, not a new timeline
// message (legacy agent-control.js CONTENT_TYPES carried it for this reason).
const WAITING_TURN_TYPES = new Set([TYPES.agentAsk, TYPES.agentQueue, TYPES.agentReplace]);
const SELF_OPERATION_TYPES = new Set(['terminal.command', 'terminal.session']);

// Waiting owns a request exactly while its lifecycle is waiting, and while it
// is on the ledger without a status yet. A send this page placed in the
// timeline (its receiver was idle) stays in the timeline for good: an idle
// receiver still reports `queued` for a few milliseconds before `processing`,
// and following that would move the row out and back. Running, closed and
// lost requests belong to the timeline.
function waitingOnlyTurn(turn, lifecycleOf, timelinePlaced) {
  if (!turn || !WAITING_TURN_TYPES.has(turn.request?.type)) return false;
  if (timelinePlaced?.has?.(String(turn.requestId || ''))) return false;
  const stage = lifecycleOf(turn);
  return stage === LIFECYCLE.waiting || stage === LIFECYCLE.pending;
}

function envelopeOf(entry) {
  return entry?.kind === 'turn' ? entry.turn?.request : entry?.envelope;
}

export function entryEnvelopes(entry) {
  if (entry?.kind !== 'turn') return [entry?.envelope].filter(Boolean);
  const envelopes = [entry.turn?.request, entry.turn?.terminal];
  for (const provisional of entry.turn?.provisional || []) envelopes.push(provisional?.envelope);
  for (const child of entry.thread || []) envelopes.push(...entryEnvelopes(child));
  return envelopes.filter(Boolean);
}

// 是不是"我"：只比完整 actor id，从不拆开它。
function samePerson(left, right) {
  return Boolean(left && right && left === right);
}

function selfOperation(envelope) {
  return SELF_OPERATION_TYPES.has(envelope?.type);
}

function directlyMine(envelope, selfID) {
  return Boolean(selfID && envelope && (
    samePerson(envelope.sender?.id, selfID)
    || (Array.isArray(envelope.audience)
      && envelope.audience.some((audience) => samePerson(audience, selfID)))
  ));
}

// Members other than people also start conversations here: a scheduler fire,
// a provider run reporting a finished background task, an agent's own call to
// the system door, one agent asking another. A person watching the channel
// must see that work the same way they see their own, so every root a member
// started seeds the conversation just as a direct human fact does. Only a
// root: a member's message under someone else's request belongs to that
// request's conversation, and another person's conversation stays theirs.
const MEMBER_SENDER_KINDS = new Set(['agent', 'tool', 'peer']);

function memberInitiatedRoot(envelope) {
  return MEMBER_SENDER_KINDS.has(envelope?.sender?.kind)
    && Boolean(envelope.sender.id)
    && !envelope.parent_id
    // A member working the machinery or calling a tool on its own is process,
    // not something it said: a request seeds only when it addresses someone.
    && !isOperationCall(envelope)
    && (envelope.kind !== 'request' || isConversationCall(envelope));
}

// Mine is a relation over the canonical ledger, not a sender/audience test on
// one materialized entry. A direct human fact (or a root a member started)
// seeds the conversation; one parent/correlation pass admits its related facts.
function relatedConversationEnvelopeIDs(state, selfID) {
  const rows = [...(state?.rows?.values?.() || [])];
  const seedIDs = new Set();
  const correlations = new Set();
  for (const envelope of rows) {
    if (selfOperation(envelope)
      || (!directlyMine(envelope, selfID) && !memberInitiatedRoot(envelope))) continue;
    if (envelope.id) seedIDs.add(envelope.id);
    const correlation = correlationOf(envelope);
    if (correlation) correlations.add(correlation);
  }
  const related = new Set(seedIDs);
  for (const envelope of rows) {
    if (!envelope?.id || related.has(envelope.id) || selfOperation(envelope)) continue;
    if ((envelope.parent_id && seedIDs.has(envelope.parent_id))
      || correlations.has(correlationOf(envelope))) related.add(envelope.id);
  }
  return related;
}

function entryMatchesConversation(entry, related) {
  const envelopes = entryEnvelopes(entry);
  return envelopes.some((envelope) => !selfOperation(envelope))
    && envelopes.some((envelope) => envelope?.id && related.has(envelope.id));
}

// The one answer to "is this envelope part of the reader's conversation": the
// mine view shows exactly the entries it admits, and unread asks the same
// question to decide which read position governs a row. Two definitions let a
// row be shown in the mine view yet judged against the all position, so
// reading the mine view to the bottom could never clear it and scrolling back
// up brought it back as new.
export function conversationRelation(state, selfID) {
  const related = relatedConversationEnvelopeIDs(state, selfID);
  const byEnvelope = new Map();
  for (const entry of state?.timeline || []) {
    const inConversation = entryMatchesConversation(entry, related);
    for (const envelope of entryEnvelopes(entry)) {
      if (envelope?.id) byEnvelope.set(envelope.id, inConversation);
    }
  }
  return (envelope) => byEnvelope.get(envelope?.id) ?? related.has(envelope?.id);
}

function entryMatchesActors(entry, actors) {
  if (!actors?.size) return true;
  return entryEnvelopes(entry).some((envelope) => (
    actors.has(envelope?.sender?.id)
    || envelope?.audience?.some((audience) => actors.has(audience))
  ));
}

function uiType(type) {
  return String(type || '').startsWith('ui.');
}

function visibleEntry(entry, scope, editingTargetID, editingReplacementID, lifecycleOf, timelinePlaced) {
  const envelope = envelopeOf(entry);
  if (!envelope || (entry.kind === 'standalone' && envelope.type === 'terminal.session')) return false;
  if (entry.kind !== 'turn') return scope === CONVERSATION_SCOPE.all
    || !uiType(envelope.type);
  if (editingReplacementID && entry.turn?.requestId === editingReplacementID) return false;
  // Waiting is the sole projection for accepted-but-not-processing Agent work.
  // Editing may remove a row from Waiting, but must not duplicate it here.
  if (waitingOnlyTurn(entry.turn, lifecycleOf, timelinePlaced)) return false;
  if (entry.turn?.requestId === editingTargetID) return true;
  // Ported from the public owner's agentMessageStage:
  //   if (turn?.terminal && !terminalValue(turn, 'replaced_by')) return 'timeline';
  // A request whose own terminal names its replacement has left the
  // conversation — the successor carries the body from here on. Keeping the
  // original visible is what makes one edit read as two messages.
  if (argsOf(entry.turn?.terminal)?.replaced_by) return false;
  // A control word is an operation, not a message. The hidden list covers the
  // ones that are never prose; a steer is the one word that may be either, and
  // is a message exactly when it carries the sender's own text. A steer naming
  // only its target moves a request that is already on screen — narrating that
  // move as its own row says nothing the reader cannot already see.
  if (scope === CONVERSATION_SCOPE.mine
    && (uiType(envelope.type) || HIDDEN_CONVERSATION_TYPES.has(envelope.type)
      || isControlOnlyTurn(entry.turn))) return false;
  if ([TYPES.agentSelect, TYPES.agentNew].includes(envelope.type)) {
    return argsOf(entry.turn?.terminal)?.status === 'completed';
  }
  return true;
}

function withoutUiChildren(entry, scope) {
  if (scope !== CONVERSATION_SCOPE.mine || entry?.kind !== 'turn' || !entry.thread?.length) return entry;
  // The same rule one level down: as a child, a control word becomes a
  // "关联调用" row that states the same operation a second time.
  const thread = entry.thread.filter((child) => !uiType(child?.turn?.request?.type)
    && !isControlOnlyTurn(child?.turn));
  return thread.length === entry.thread.length ? entry : { ...entry, thread };
}

function transient(entry) {
  const envelope = entry?.kind === 'standalone' ? entry.envelope : null;
  return Boolean(envelope && (argsOf(envelope)?.transient === true || envelope.type === 'mock.channel.pulse'));
}

function localEchoEntries(localEchoes, selfID, landed, timelinePlaced) {
  return (localEchoes || []).flatMap((submission, index) => {
    if (!submission?.messageId || landed.has(submission.messageId)) return [];
    const frame = submission.frame || {};
    if (!frame.msg_type || uiType(frame.msg_type) || HIDDEN_CONVERSATION_TYPES.has(frame.msg_type)
      || (WAITING_TURN_TYPES.has(frame.msg_type) && !timelinePlaced?.has?.(submission.messageId))
      || frame.msg_type === TYPES.agentSelect || frame.msg_type === TYPES.agentNew) return [];
    const envelope = {
      id: submission.messageId,
      type: frame.msg_type,
      kind: frame.kind || 'request',
      payload: Object.prototype.hasOwnProperty.call(frame.payload || {}, 'body')
        ? frame.payload
        : { body: frame.payload || { text: submission.text || '' } },
      audience: frame.audience || [],
      parent_id: frame.parent_id || '',
      visibility: frame.visibility || 'public',
      ts: submission.createdAt || Date.now() + index,
      sender: { id: selfID, kind: 'human' },
      local_submission_state: submission.state,
    };
    return envelope.kind === 'request' ? [{
      kind: 'turn', seq: 0, local: true, thread: [],
      turn: {
        requestId: envelope.id, request: envelope, requestSeq: 0, lastSeq: 0,
        provisional: [], terminal: null, terminalSeq: 0, status: 'local', local: true,
      },
    }] : [{ kind: 'standalone', seq: 0, local: true, envelope }];
  });
}

// Background work an agent sets off (a sub agent, a background shell) reports
// as agent.task events whose parent is the request the starting call served.
// They belong to that request's card, not to the timeline: a busy sub agent
// reports every few seconds, and each step as its own row would bury the
// conversation. The card that holds the request — as its root or anywhere in
// its thread — takes them; a step whose request is not on screen stays a row
// of its own so nothing is lost.
function attachSubTasks(items, state) {
  const byRequest = new Map();
  for (const envelope of state?.rows?.values?.() || []) {
    if (envelope?.type !== TYPES.agentTask || !envelope.parent_id) continue;
    const list = byRequest.get(envelope.parent_id) || [];
    list.push(envelope);
    byRequest.set(envelope.parent_id, list);
  }
  if (!byRequest.size && !items.some((entry) => entry?.envelope?.type === TYPES.agentTask)) return items;
  const holders = new Map();
  items.forEach((entry, index) => {
    if (entry?.kind !== 'turn') return;
    const visit = (node) => {
      if (node?.turn?.requestId && byRequest.has(node.turn.requestId)) holders.set(node.turn.requestId, index);
      for (const child of node?.thread || []) visit(child);
    };
    visit(entry);
  });
  const attached = new Map();
  for (const [requestID, index] of holders) {
    const list = attached.get(index) || [];
    list.push(...byRequest.get(requestID));
    attached.set(index, list);
  }
  // A task resumed from a later message ends there, not in the card that set
  // it off: that card is shown the end too, so it does not read as running
  // forever.
  const { identity, ends } = subTaskEnds(state);
  for (const list of attached.values()) {
    const keys = new Set(list.map(identity));
    for (const key of keys) {
      const end = ends.get(key);
      if (end && !list.includes(end)) list.push(end);
    }
  }
  // Steps whose request is not on screen (an old request, or none: a task
  // started before the agent restarted) still read as one piece of work, not a
  // row per step or per task: one row per request (per call when there is no
  // request), carrying every step. The row stays where the work first showed
  // up: later steps update it in place instead of moving it to the bottom.
  const orphanSteps = new Map();
  const orphanAnchor = new Map();
  const orphanKey = (envelope) => String(envelope.parent_id
    ? `request:${envelope.parent_id}`
    : `call:${argsOf(envelope)?.call_id || envelope.id}`);
  const isOrphanStep = (entry) => entry?.kind === 'standalone' && entry.envelope?.type === TYPES.agentTask
    && !holders.has(entry.envelope.parent_id);
  items.forEach((entry, index) => {
    if (!isOrphanStep(entry)) return;
    const key = orphanKey(entry.envelope);
    const list = orphanSteps.get(key) || [];
    list.push(entry.envelope);
    orphanSteps.set(key, list);
    if (!orphanAnchor.has(key)) orphanAnchor.set(key, index);
  });
  // Tasks with no request at all (their call was forgotten, e.g. across an
  // agent restart) cannot be grouped by request; those the same agent started
  // back to back — nothing else between them — are one burst of work and read
  // as one row too.
  const blockOf = new Map();
  const blocks = new Map();
  const openBlocks = new Map();
  items.forEach((entry, index) => {
    if (!isOrphanStep(entry)) { openBlocks.clear(); return; }
    const key = orphanKey(entry.envelope);
    if (orphanAnchor.get(key) !== index) return;
    const sender = String(entry.envelope.sender?.id || '');
    const block = key.startsWith('call:') && openBlocks.get(sender) ? openBlocks.get(sender) : key;
    blockOf.set(key, block);
    blocks.set(block, [...(blocks.get(block) || []), key]);
    if (key.startsWith('call:')) openBlocks.set(sender, block);
  });
  const out = [];
  items.forEach((entry, index) => {
    if (entry?.kind === 'standalone' && entry.envelope?.type === TYPES.agentTask) {
      if (holders.has(entry.envelope.parent_id)) return;
      const key = orphanKey(entry.envelope);
      if (orphanAnchor.get(key) !== index || blockOf.get(key) !== key) return;
      const steps = blocks.get(key).flatMap((member) => orphanSteps.get(member));
      out.push({ ...entry, subTasks: steps, subTaskRevision: subTaskRevision(steps) });
      return;
    }
    const steps = attached.get(index);
    if (!steps) { out.push(entry); return; }
    steps.sort((left, right) => (Number(left.ts) || 0) - (Number(right.ts) || 0));
    out.push({ ...entry, subTasks: steps, subTaskRevision: subTaskRevision(steps) });
  });
  return out;
}

// When a row holding background work must be drawn again. A task starting,
// ending or its sub agent speaking redraws at once; running progress only
// every 15s — dozens of busy sub agents otherwise redraw the row on every
// tool they use.
function subTaskRevision(steps) {
  let settled = 0;
  let progressAt = 0;
  for (const envelope of steps) {
    if (argsOf(envelope)?.phase === 'progress') progressAt = Math.max(progressAt, Number(envelope.ts) || 0);
    else settled += 1;
  }
  return `${settled}.${Math.floor(progressAt / 15000)}`;
}

// Work hung under a message is read inside that message's card. With the
// message not on the page — it is further back than what is loaded, or a
// reload left it behind — a call, a progress step or an answer that belongs
// to it has nothing to be read against, so it is not drawn on its own: a long
// turn's hundreds of calls used to flood the timeline one card each. They come
// back folded in their card once history reaches it. Kept on their own: what a
// person wrote, what asks a person to act, and an agent speaking after its
// background work (that is prose, anchored only for placement).
function detachedFromParent(entry, state) {
  const envelope = entry?.kind === 'turn' ? entry.turn?.request : entry?.envelope;
  const parent = String(envelope?.parent_id || '');
  if (!parent || envelope?.sender?.kind === 'human') return false;
  if (envelope?.type === TYPES.agentProviderRun) return false;
  if (envelope?.kind === 'request' && (envelope.audience || []).some((id) => String(id).startsWith('human:'))) return false;
  return !state?._envelopesById?.has(parent);
}

// Semantic projection is exported from the Presentation owner. It consumes the
// Replica's canonical timeline and does not retain or mutate another ledger.
export function selectTimelineItems(state, {
  scope = CONVERSATION_SCOPE.mine,
  selfId = '',
  actorFilter = new Set(),
  editingTargetId = '',
  editingReplacementId = '',
  showNarration = false,
  localEchoes = [],
  timelinePlaced = null,
} = {}) {
  const restarts = memberRestarts(state);
  const now = Date.now();
  const lifecycleOf = (turn) => requestLifecycle(turn, restarts, now);
  const related = scope === CONVERSATION_SCOPE.mine && selfId
    ? relatedConversationEnvelopeIDs(state, selfId)
    : null;
  const allEntries = [];
  const scoped = [];
  const filtered = [];
  for (const rawEntry of state?.timeline || []) {
    if (detachedFromParent(rawEntry, state)) continue;
    if (!visibleEntry(rawEntry, scope, editingTargetId, editingReplacementId, lifecycleOf, timelinePlaced)) continue;
    allEntries.push(rawEntry);
    const entry = withoutUiChildren(rawEntry, scope);
    if (related && !entryMatchesConversation(entry, related)) continue;
    scoped.push(entry);
    if (scope === CONVERSATION_SCOPE.mine && actorFilter?.size && !entryMatchesActors(entry, actorFilter)) continue;
    filtered.push(entry);
  }
  const latestTransient = new Map();
  for (const entry of filtered) {
    if (transient(entry)) latestTransient.set(`${entry.envelope?.sender?.id || ''}:${entry.envelope?.type || ''}`, entry);
  }
  let items = attachSubTasks(filtered.filter((entry) => !transient(entry)
    || latestTransient.get(`${entry.envelope?.sender?.id || ''}:${entry.envelope?.type || ''}`) === entry), state);
  if (showNarration && state?.narration?.length) {
    const narrationSeq = state.narration[0].seq;
    const narration = { kind: 'narration', seq: narrationSeq, lastSeq: state.narration.at(-1).seq };
    const insertion = items.findIndex((entry) => entry.seq > narrationSeq);
    items = insertion < 0 ? [...items, narration] : [...items.slice(0, insertion), narration, ...items.slice(insertion)];
  }
  const landed = state?._envelopesById?.has ? state._envelopesById : new Map();
  const echoes = localEchoEntries(localEchoes, selfId, landed, timelinePlaced);
  if (echoes.length) items = [...items, ...echoes];
  return Object.freeze({
    items,
    allEntries,
    scoped,
    filtered,
    localEchoes: echoes,
    actorFilterApplies: scope === CONVERSATION_SCOPE.mine,
    firstVisibleSeq: Number(items[0]?.seq || 0),
    lastVisibleSeq: Number(items.at(-1)?.seq || 0),
  });
}

// Render projection is hard-bound to Admission and Presentation. Callers may
// use evaluate/commit candidates or their narrow admit/project render ports.
export function projectTimeline(state, options = {}) {
  const semantic = selectTimelineItems(state, options);
  const { presentation, presentationAdmission, presentationKey = '', dataEpoch = '' } = options;
  const sourceRevision = Number(state?._timelineRevision ?? state?.lastSeq ?? 0);
  let admissionCandidate = null;
  let items;
  if (typeof presentationAdmission?.admit === 'function') {
    items = presentationAdmission.admit(state.channelId, semantic.items, {
      viewID: presentationKey, epoch: dataEpoch, sourceRevision,
    });
  } else if (typeof presentationAdmission?.evaluate === 'function') {
    admissionCandidate = presentationAdmission.evaluate(state.channelId, semantic.items, {
      viewID: presentationKey, epoch: dataEpoch, sourceRevision,
    });
    items = admissionCandidate.items;
  } else throw new TypeError('conversation projection requires HistoryPresentationAdmission');
  if (!Array.isArray(items)) throw new TypeError('HistoryPresentationAdmission must return items');
  const fence = presentationAdmission.sourceFence?.(state.channelId);
  const projectedRevision = fence == null ? sourceRevision : Number(fence);
  const meta = {
    epoch: dataEpoch,
    nextViewID: presentationKey,
    sourceRevision: projectedRevision,
    sourceChangeBase: Number(state?._timelineChangeBase || 0),
    sourceChanges: (state?._timelineChangeLog || [])
      .filter((change) => Number(change.revision || 0) <= projectedRevision),
  };
  let presentationCandidate = null;
  let snapshot;
  if (typeof presentation?.project === 'function') snapshot = presentation.project(items, meta);
  else if (typeof presentation?.evaluate === 'function') {
    presentationCandidate = presentation.evaluate(items, meta);
    snapshot = presentationCandidate.snapshot;
  } else throw new TypeError('conversation projection requires ConversationPresentation');
  if (!snapshot || !Array.isArray(snapshot.rows)) throw new TypeError('ConversationPresentation must return a snapshot');
  return Object.freeze({
    ...semantic,
    items,
    presentation: snapshot,
    presentationRows: snapshot.rows,
    admissionCandidate,
    presentationCandidate,
    firstVisibleSeq: Number(items[0]?.seq || 0),
    lastVisibleSeq: Number(items.at(-1)?.seq || 0),
  });
}
