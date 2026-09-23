import { argsOf, FINAL, hasCanonicalBody } from '../protocol/envelope.js';
import { isNarrationEnvelope } from '../protocol/vocab.js';
import { redactSensitive } from './terminal-result.js';

const CACHE_DATABASE = 'atoll-channel-replica-v1';
const CACHE_VERSION = 1;
// A quota retry keeps a small usable suffix even when the cache has no
// caller-provided per-channel bound. This is only activated for a channel
// that has actually hit quota; ordinary writes keep their current retention.
const QUOTA_MIN_RETAINED_ROWS = 8;
const memoryCache = new Map();

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError'
    || error?.code === 'QuotaExceededError'
    || error?.cause?.name === 'QuotaExceededError';
}

function cacheUnavailableError() {
  return Object.assign(new Error('本地缓存不可用，已转网络重取'), {
    code: 'cache_unavailable',
  });
}

function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function rowBytes(row) {
  try { return new TextEncoder().encode(JSON.stringify(row)).byteLength; }
  catch { return 0; }
}

// Cache persistence is the last boundary before a row leaves the process. Keep
// the historical feed-cache contract here, rather than relying on a renderer
// to hide values after they have already reached IndexedDB.
function sanitizedCacheRow(row) {
  const sanitized = redactSensitive(row);
  let changed = row !== sanitized;
  try { changed = JSON.stringify(row) !== JSON.stringify(sanitized); }
  catch { /* non-JSON rows are not expected, but the sanitized value is safe */ }
  return { row: sanitized, changed };
}

function bodylessSystemNarration(envelope) {
  const payload = envelope?.payload;
  return envelope?.visibility === 'system'
    && (payload == null
      || (typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0));
}

function hasProjectionBody(envelope) {
  return hasCanonicalBody(envelope) || bodylessSystemNarration(envelope);
}

export function mergeReplicaCoverage(ranges = [], addition = null) {
  const ordered = [...ranges, ...(addition ? [addition] : [])]
    .map((range) => ({ lowSeq: numeric(range?.lowSeq), highSeq: numeric(range?.highSeq) }))
    .filter((range) => range.lowSeq > 0 && range.highSeq >= range.lowSeq)
    .sort((left, right) => left.lowSeq - right.lowSeq || left.highSeq - right.highSeq);
  const merged = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.lowSeq > previous.highSeq + 1) merged.push({ ...range });
    else previous.highSeq = Math.max(previous.highSeq, range.highSeq);
  }
  return merged;
}

// A request sits under another request only when its parent_id names that
// request: an agent calling another actor while it serves a turn. correlation
// is not the test — a person replying to an answer shares the answer's
// correlation, and so does every sibling request in it; only parent_id says
// which request called which (legacy fold.js: "判据用 parent_id 而不是
// correlation_id"). A reply's parent_id names the answer, a response, so the
// reply is a root of its own.
function climbRequestParents(start, requests) {
  let root = '';
  let parent = start;
  const visited = new Set();
  while (parent && requests.has(parent) && !visited.has(parent)) {
    visited.add(parent);
    root = parent;
    parent = String(requests.get(parent).parent_id || '');
  }
  return root;
}

function rootRequestId(envelope, requests) {
  if (envelope?.kind === 'request') {
    return climbRequestParents(String(envelope.parent_id || ''), requests) || envelope.id;
  }
  return climbRequestParents(String(envelope?.parent_id || envelope?.correlation_id || ''), requests);
}

const TERMINAL_RETAINED_FIELDS = Object.freeze([
  'merged_into',
  'replaced_by',
  'preempted_by',
]);

function terminalRetainedFields(payload = {}) {
  const nested = payload?.value && typeof payload.value === 'object' && !Array.isArray(payload.value)
    ? payload.value
    : {};
  const retained = {};
  for (const key of TERMINAL_RETAINED_FIELDS) {
    const value = payload?.[key] ?? nested[key];
    if (value !== undefined && value !== null && value !== '') retained[key] = value;
  }
  return retained;
}

// A closure is lifecycle provenance, not a second copy of a result. Keep the
// routing and status facts needed to join a later request/response, while
// deliberately dropping the potentially large terminal body.
function compactTerminalClosure(envelope) {
  const payload = argsOf(envelope);
  return {
    id: envelope?.id || '',
    parent_id: envelope?.parent_id || '',
    correlation_id: envelope?.correlation_id || '',
    kind: 'response',
    type: envelope?.type || '',
    ts: envelope?.ts,
    sender: envelope?.sender,
    audience: envelope?.audience,
    visibility: envelope?.visibility,
    payload: {
      body: {
        status: payload.status,
        ...terminalRetainedFields(payload),
      },
    },
  };
}

// The request is only needed when a surviving terminal row has lost its
// parent row. Scalar body fields keep a closure useful for rendering/routing
// without retaining an arbitrarily large request payload in the memory index.
function compactClosureRequest(request) {
  if (!request?.id) return null;
  const body = argsOf(request);
  const compactBody = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      compactBody[key] = value;
    } else if (typeof value === 'string' && value.length <= 4096) {
      compactBody[key] = value;
    }
  }
  return {
    id: request.id,
    parent_id: request.parent_id || '',
    correlation_id: request.correlation_id || '',
    kind: 'request',
    type: request.type || '',
    ts: request.ts,
    sender: request.sender,
    audience: request.audience,
    visibility: request.visibility,
    payload: { body: compactBody },
  };
}

function terminalClosureMatchesRow(closure, item) {
  if (!(
    closure
    && item
    && Number(closure.seq) === Number(item.seq)
    && closure.envelope?.id
    && closure.envelope.id === item.envelope?.id
  )) return false;
  try {
    return JSON.stringify(closure.envelope) === JSON.stringify(compactTerminalClosure(item.envelope));
  } catch {
    return false;
  }
}

function buildTurn(request, requestSeq, responses) {
  const provisional = [];
  let terminal = null;
  let terminalSeq = 0;
  let lastSeq = requestSeq;
  let terminalClosureOnly = false;
  for (const response of [...(responses || [])].sort((left, right) => left.seq - right.seq)) {
    lastSeq = Math.max(lastSeq, response.seq);
    if (FINAL.has(argsOf(response.envelope)?.status)) {
      // The first terminal in ledger order is authoritative. A later final
      // is a conflict, never a replacement that can change a closed turn
      // back to a different outcome.
      if (!terminal) {
        terminal = response.envelope;
        terminalSeq = response.seq;
        terminalClosureOnly = response.closureOnly === true;
      }
    } else provisional.push({ seq: response.seq, envelope: response.envelope });
  }
  return {
    requestId: request.id, request, requestSeq, lastSeq, provisional, terminal, terminalSeq,
    terminalClosureOnly,
    status: terminal ? String(argsOf(terminal)?.status || 'completed') : 'pending',
  };
}

function reconcileTurn(previous, next) {
  if (!previous) return next;
  Object.assign(previous, next);
  return previous;
}

function reconcileTimelineEntry(previous, next) {
  if (!previous || previous.kind !== next.kind) return next;
  if (next.kind !== 'turn') {
    if (previous.envelope?.id !== next.envelope?.id) return next;
    Object.assign(previous, next);
    return previous;
  }
  if (previous.turn?.requestId !== next.turn?.requestId) return next;
  previous.seq = next.seq;
  previous.turn = reconcileTurn(previous.turn, next.turn);
  const children = new Map((previous.thread || []).map((entry) => [entry.turn?.requestId, entry]));
  const reconciled = next.thread.map((entry) => (
    reconcileTimelineEntry(children.get(entry.turn?.requestId), entry)
  ));
  if (!Array.isArray(previous.thread)) previous.thread = [];
  previous.thread.splice(0, previous.thread.length, ...reconciled);
  return previous;
}

function requestParentID(request) {
  const parentID = String(request?.parent_id || '');
  return parentID && parentID !== String(request?.id || '') ? parentID : '';
}

// Trimming is allowed to move the materialized window, but it must not cut a
// still-running turn in half. This is deliberately derived from the current
// timeline rather than stored as another lifecycle: an open child also pins
// every request ancestor so the surviving child cannot become a rootless
// projection after the next rebuild.
function openTurnFloor(state) {
  const requests = new Map();
  const requestSeqs = new Map();
  for (const [seq, envelope] of state.rows) {
    if (envelope?.kind !== 'request' || !envelope.id) continue;
    const id = String(envelope.id);
    requests.set(id, envelope);
    requestSeqs.set(id, seq);
  }

  let floor = Number.POSITIVE_INFINITY;
  const visit = (entry) => {
    if (entry?.kind !== 'turn' || !entry.turn) return;
    if (!entry.turn.terminal) {
      let requestID = String(entry.turn.requestId || '');
      const visited = new Set();
      while (requestID && !visited.has(requestID)) {
        visited.add(requestID);
        const requestSeq = requestSeqs.get(requestID);
        if (Number.isSafeInteger(requestSeq)) floor = Math.min(floor, requestSeq);
        const parentID = requestParentID(requests.get(requestID));
        if (!parentID || !requests.has(parentID)) break;
        requestID = parentID;
      }
    }
    for (const child of entry.thread || []) visit(child);
  };
  for (const entry of state.timeline || []) visit(entry);
  return floor;
}

function retainTerminalClosure(state, requestID, request, requestSeq, terminalSeq, terminal) {
  if (!requestID || !terminal || !FINAL.has(argsOf(terminal)?.status)) return;
  const closures = state._unmatchedTerminalClosures;
  if (!(closures instanceof Map)) return;
  const current = closures.get(requestID);
  if (current && Number(current.seq) <= Number(terminalSeq)) return;
  closures.set(requestID, {
    seq: terminalSeq,
    closureOnly: true,
    envelope: compactTerminalClosure(terminal),
    request: compactClosureRequest(request),
    requestSeq: numeric(requestSeq),
  });
}

// Capture closure provenance before rows cross the trim cut. This covers both
// a matched turn and a terminal-first suffix that has never had a request in
// the current materialized window. The latter deliberately stores no guessed
// request: a future exact request is required before a turn can be projected.
function retainTrimmedTerminalClosures(state, cut) {
  const requestRows = new Map();
  const orderedRows = [...state.rows.entries()].sort((left, right) => left[0] - right[0]);
  for (const [seq, envelope] of orderedRows) {
    if (hasProjectionBody(envelope) && envelope?.kind === 'request' && envelope.id) {
      requestRows.set(envelope.id, { seq, envelope });
    }
  }

  const visit = (entry) => {
    if (entry?.kind !== 'turn' || !entry.turn?.terminal) return;
    const turn = entry.turn;
    const terminalSeq = numeric(turn.terminalSeq);
    const requestSeq = numeric(turn.requestSeq);
    if (terminalSeq >= cut && requestSeq >= cut) return;
    retainTerminalClosure(
      state,
      String(turn.requestId || ''),
      turn.request || requestRows.get(turn.requestId)?.envelope,
      requestSeq || requestRows.get(turn.requestId)?.seq || 0,
      terminalSeq,
      turn.terminal,
    );
    for (const child of entry.thread || []) visit(child);
  };
  for (const entry of state.timeline || []) visit(entry);

  // A response-first terminal may not have a materialized timeline entry at
  // all. Retain only the exact parent-id fact; do not manufacture a request.
  for (const [seq, envelope] of orderedRows) {
    if (seq >= cut || envelope?.kind !== 'response' || !envelope.parent_id) continue;
    if (!FINAL.has(argsOf(envelope)?.status)) continue;
    const requestRow = requestRows.get(envelope.parent_id);
    retainTerminalClosure(
      state,
      String(envelope.parent_id),
      requestRow?.envelope,
      requestRow?.seq || 0,
      seq,
      envelope,
    );
  }
}

// Replica is the only mutable materialized ledger. Every source commits here;
// the fold is derived from that canonical row set so out-of-order cache,
// history and live delivery cannot create competing folds. Reconciliation
// keeps surviving turn identities stable for Presentation's content path.
//
// This function is the DEFINITION of that fold: it reads nothing but `rows`
// (plus retained closures) and is order-independent by construction. It stays
// the authority forever. `foldRow` below is an incremental implementation of
// the same function for the arrival shapes that admit one; anything it cannot
// express in closed form falls back here, and the fold audit asserts the two
// agree row by row.
function rebuildStateFull(state) {
  const orderedRows = [...state.rows.entries()].sort((left, right) => left[0] - right[0]);
  const requests = new Map();
  const requestSeqs = new Map();
  const responses = new Map();
  const standalone = [];
  state._envelopesById = new Map();
  state.narration = [];
  for (const [seq, envelope] of orderedRows) {
    if (!envelope) continue;
    // Historical flat payloads remain durable transport rows, but never
    // become lifecycle, narration, or standalone business entries.
    if (!hasProjectionBody(envelope)) continue;
    if (envelope.id) state._envelopesById.set(envelope.id, envelope);
    if (envelope.visibility === 'system') { state.narration.push({ seq, envelope }); continue; }
    if (envelope.kind === 'request' && envelope.id) {
      requests.set(envelope.id, envelope);
      requestSeqs.set(envelope.id, seq);
    } else if (envelope.kind === 'response' && envelope.parent_id) {
      const list = responses.get(envelope.parent_id) || [];
      list.push({ seq, envelope });
      responses.set(envelope.parent_id, list);
    } else standalone.push({ kind: 'standalone', seq, envelope });
  }

  // Merge compact lifecycle proof with whatever full rows remain. A closure
  // is removed only once both its exact request and exact terminal row are
  // present; until then it may complete a raw request or pair a surviving
  // terminal with its compact parent. No closure can create a turn without a
  // real terminal row or an exact request re-admission.
  const closureResponses = new Map();
  for (const [requestID, retained] of state._unmatchedTerminalClosures || []) {
    const rawResponses = responses.get(requestID) || [];
    // A history page can deliver an older terminal after a newer suffix has
    // already established the closure. Reconcile the retained proof to the
    // earliest raw FINAL immediately, so a later trim cannot discard that
    // earlier fact and resurrect the newer outcome.
    const earlier = rawResponses
      .filter((item) => FINAL.has(argsOf(item.envelope)?.status)
        && Number(item.seq) < Number(retained.seq))
      .sort((left, right) => left.seq - right.seq)[0];
    let closure = retained;
    if (earlier) {
      closure = {
        ...retained,
        seq: earlier.seq,
        envelope: compactTerminalClosure(earlier.envelope),
        request: requests.get(requestID)
          ? compactClosureRequest(requests.get(requestID))
          : retained.request,
        requestSeq: requests.get(requestID)
          ? numeric(requestSeqs.get(requestID))
          : retained.requestSeq,
      };
      state._unmatchedTerminalClosures.set(requestID, closure);
    }
    const exactTerminal = rawResponses.some((item) => terminalClosureMatchesRow(closure, item));
    if (exactTerminal && requests.has(requestID)) {
      state._unmatchedTerminalClosures.delete(requestID);
      continue;
    }
    if (!rawResponses.some((item) => terminalClosureMatchesRow(closure, item))) {
      closureResponses.set(requestID, {
        seq: closure.seq,
        envelope: closure.envelope,
        closureOnly: true,
      });
    }
    // A request row can be projected from closure provenance only when the
    // terminal is still a raw row. If both rows were trimmed, keep the exact
    // closure solely in `_envelopesById` to block stale local Waiting echoes.
    if (!requests.has(requestID)
      && closure.request?.id
      && rawResponses.some((item) => FINAL.has(argsOf(item.envelope)?.status))) {
      requests.set(requestID, closure.request);
      requestSeqs.set(requestID, numeric(closure.requestSeq));
    }
  }
  for (const [requestID, closureResponse] of closureResponses) {
    const list = responses.get(requestID) || [];
    // Put the retained first terminal before a same-seq conflicting reread;
    // ledger order, not the latest full body, remains authoritative.
    responses.set(requestID, [closureResponse, ...list]);
  }
  for (const [requestID, closure] of state._unmatchedTerminalClosures || []) {
    const known = state._envelopesById.get(requestID);
    if (!known) {
      state._envelopesById.set(requestID, {
        ...(closure.request || { id: requestID, kind: 'request' }),
        __terminalClosureRequest: true,
      });
    }
  }
  const roots = new Map();
  for (const [id, request] of requests) {
    const rootId = rootRequestId(request, requests) || id;
    if (rootId === id) {
      roots.set(id, {
        kind: 'turn', seq: requestSeqs.get(id), thread: [],
        turn: buildTurn(request, requestSeqs.get(id), responses.get(id)),
      });
    }
  }
  for (const [id, request] of requests) {
    const rootId = rootRequestId(request, requests) || id;
    if (rootId === id) continue;
    roots.get(rootId)?.thread.push({
      kind: 'turn', seq: requestSeqs.get(id), thread: [],
      turn: buildTurn(request, requestSeqs.get(id), responses.get(id)),
    });
  }
  for (const root of roots.values()) root.thread.sort((left, right) => left.seq - right.seq);
  const previous = new Map((state.timeline || []).map((entry) => [
    entry.kind === 'turn' ? entry.turn?.requestId : entry.envelope?.id,
    entry,
  ]));
  const nextTimeline = [...roots.values(), ...standalone]
    .sort((left, right) => left.seq - right.seq)
    .map((entry) => reconcileTimelineEntry(
      previous.get(entry.kind === 'turn' ? entry.turn?.requestId : entry.envelope?.id),
      entry,
    ));
  state.timeline.splice(0, state.timeline.length, ...nextTimeline);
  state.lastSeq = orderedRows.at(-1)?.[0] || 0;
  // The incremental index is a pure projection of the values this fold just
  // computed, never a second source. Rebuilding it here is what makes the
  // fallback total: whatever `foldRow` declines to express, the next row
  // resumes from an index the authority itself wrote.
  publishFoldIndex(state, requests, requestSeqs, responses);
}

// ---------------------------------------------------------------------------
// Incremental fold
//
// `rebuildStateFull` above is O(rows) per admitted row, so a channel that is
// never trimmed pays more for its newest message the longer it has been open.
// The cost is not inherent to the invariant it protects: the fold is a
// function of `rows`, and a single arrival touches a closed, small part of it.
// What follows maintains that part directly. It is deliberately partial —
// every shape it cannot prove locally returns false and defers to the
// authority, so correctness never depends on this file being exhaustive.
// ---------------------------------------------------------------------------

// Ledger order is the only ordering fact, and seqs are unique per channel, so
// an insert position is exact rather than a stable-sort tie-break.
function insertBySeq(list, item) {
  if (!list.length || list[list.length - 1].seq <= item.seq) { list.push(item); return list; }
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid].seq <= item.seq) low = mid + 1; else high = mid;
  }
  list.splice(low, 0, item);
  return list;
}

// The id a request's root walk can traverse: `rootRequestId` climbs parent_id
// only, so admitting that id is the one edge that can move this request.
function requestPointers(request) {
  const id = String(request?.id || '');
  const parent = String(request?.parent_id || '');
  return parent && parent !== id ? [parent] : [];
}

function publishFoldIndex(state, requests, requestSeqs, responses) {
  const rootOf = new Map();
  const pointedBy = new Map();
  for (const [id, request] of requests) {
    rootOf.set(id, rootRequestId(request, requests) || id);
    for (const target of requestPointers(request)) {
      let pointers = pointedBy.get(target);
      if (!pointers) { pointers = new Set(); pointedBy.set(target, pointers); }
      pointers.add(id);
    }
  }
  const roots = new Map();
  const entryOf = new Map();
  for (const entry of state.timeline) {
    if (entry?.kind !== 'turn') continue;
    const id = String(entry.turn?.requestId || '');
    roots.set(id, entry);
    entryOf.set(id, entry);
    for (const child of entry.thread || []) entryOf.set(String(child.turn?.requestId || ''), child);
  }
  // `commit` needs a request view of `_envelopesById`, including system
  // narration requests and closure placeholders, to attribute a change-log
  // entry. Deriving it here removes the per-commit rescan of that map.
  const allRequests = new Map();
  for (const envelope of state._envelopesById.values()) {
    if (envelope?.kind === 'request') allRequests.set(envelope.id, envelope);
  }
  state._fold = { requests, requestSeqs, responses, rootOf, pointedBy, roots, entryOf, allRequests };
}

// Narration is read by identity in a few projections, so a change replaces the
// array exactly as the authoritative fold does; an unrelated row now leaves it
// alone instead of handing every consumer a fresh array per commit.
function insertNarration(state, seq, envelope) {
  const next = [...(state.narration || [])];
  let index = next.length;
  while (index > 0 && next[index - 1].seq > seq) index -= 1;
  next.splice(index, 0, { seq, envelope });
  state.narration = next;
}

function detachTurnEntry(state, requestID) {
  const fold = state._fold;
  const entry = fold.entryOf.get(requestID);
  if (!entry) return;
  if (fold.roots.get(requestID) === entry) {
    fold.roots.delete(requestID);
    const index = state.timeline.indexOf(entry);
    if (index >= 0) state.timeline.splice(index, 1);
    return;
  }
  const thread = fold.roots.get(String(fold.rootOf.get(requestID) || ''))?.thread;
  if (!Array.isArray(thread)) return;
  const index = thread.indexOf(entry);
  if (index >= 0) thread.splice(index, 1);
}

// Placement mirrors the authoritative fold exactly, including its refusal to
// project a request whose resolved root is not itself a root entry.
function attachTurnEntry(state, requestID) {
  const fold = state._fold;
  const request = fold.requests.get(requestID);
  if (!request) return;
  const requestSeq = fold.requestSeqs.get(requestID);
  const turn = buildTurn(request, requestSeq, fold.responses.get(requestID));
  let entry = fold.entryOf.get(requestID);
  if (!entry) {
    entry = { kind: 'turn', seq: requestSeq, thread: [], turn };
    fold.entryOf.set(requestID, entry);
  } else {
    entry.seq = requestSeq;
    entry.turn = reconcileTurn(entry.turn, turn);
    // Threads are one level deep in this fold; every child of a moved root is
    // itself in the affected set and is re-attached in the same pass.
    entry.thread.length = 0;
  }
  const rootID = String(fold.rootOf.get(requestID) || requestID);
  if (rootID === requestID) {
    fold.roots.set(requestID, entry);
    insertBySeq(state.timeline, entry);
    return;
  }
  const rootEntry = fold.roots.get(rootID);
  if (rootEntry) insertBySeq(rootEntry.thread, entry);
}

function applyStandaloneRow(state, seq, envelope) {
  insertBySeq(state.timeline, { kind: 'standalone', seq, envelope });
  return true;
}

// A response only ever changes the turn of its exact parent: it cannot move a
// root, reorder the timeline, or reach any other entry. This is the shape the
// streaming path spends almost all of its rows on.
function applyResponseRow(state, seq, envelope) {
  const fold = state._fold;
  const parentID = String(envelope.parent_id);
  const responses = insertBySeq(fold.responses.get(parentID) || [], { seq, envelope });
  fold.responses.set(parentID, responses);
  const entry = fold.entryOf.get(parentID);
  const request = fold.requests.get(parentID);
  if (!entry || !request) return true;
  entry.turn = reconcileTurn(entry.turn, buildTurn(request, fold.requestSeqs.get(parentID), responses));
  return true;
}

// Admitting a request can adopt earlier rootless requests. The set that can
// move is exactly the closure of the reverse pointer graph below the new id:
// a request's root is decided by walking its own pointers upward, so it can
// only be affected by an id it can reach that way. Everything outside that
// closure is provably untouched, which is what keeps this bounded by the turn
// rather than by the channel.
function applyRequestRow(state, seq, envelope) {
  const fold = state._fold;
  const id = String(envelope.id);
  fold.requests.set(id, envelope);
  fold.requestSeqs.set(id, seq);
  for (const target of requestPointers(envelope)) {
    let pointers = fold.pointedBy.get(target);
    if (!pointers) { pointers = new Set(); fold.pointedBy.set(target, pointers); }
    pointers.add(id);
  }

  const affected = [];
  const visited = new Set();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (fold.requests.has(current)) affected.push(current);
    for (const pointer of fold.pointedBy.get(current) || []) {
      if (!visited.has(pointer)) queue.push(pointer);
    }
  }

  // Detach against the previous roots — a request can keep its root and still
  // change placement because that root stopped being a root entry.
  for (const affectedID of affected) detachTurnEntry(state, affectedID);
  const nextRoots = new Map(affected.map((affectedID) => [
    affectedID,
    rootRequestId(fold.requests.get(affectedID), fold.requests) || affectedID,
  ]));
  for (const [affectedID, rootID] of nextRoots) fold.rootOf.set(affectedID, rootID);
  for (const [affectedID, rootID] of nextRoots) if (rootID === affectedID) attachTurnEntry(state, affectedID);
  for (const [affectedID, rootID] of nextRoots) if (rootID !== affectedID) attachTurnEntry(state, affectedID);
  return true;
}

function applyRowIncremental(state, seq, envelope) {
  const fold = state._fold;
  if (!fold) return false;
  // Retained closures are lifecycle proof that has to be re-merged against the
  // whole surviving row set; that merge has no local form. A trimmed replica
  // therefore stays on the authority until its closures drain, which is also
  // the only profile where the row window is bounded anyway.
  if (state._unmatchedTerminalClosures?.size) return false;
  const projected = hasProjectionBody(envelope);
  // An id-less projection row collides with every other id-less entry in the
  // authority's reconciliation key. Rather than reproduce that, defer.
  if (projected && !envelope.id) return false;

  // Rows only leave through trim, which runs the authority, so the head is a
  // running maximum rather than a second ordered index over `rows`.
  state.lastSeq = Math.max(numeric(state.lastSeq), seq);
  // Rows without a canonical body stay durable transport evidence and are
  // deliberately invisible to every projection.
  if (!projected) return true;

  state._envelopesById.set(envelope.id, envelope);
  if (envelope.kind === 'request') fold.allRequests.set(envelope.id, envelope);
  if (envelope.visibility === 'system') { insertNarration(state, seq, envelope); return true; }
  if (envelope.kind === 'request') return applyRequestRow(state, seq, envelope);
  if (envelope.kind === 'response' && envelope.parent_id) return applyResponseRow(state, seq, envelope);
  return applyStandaloneRow(state, seq, envelope);
}

// A value-level signature of the fold. Object identity legitimately differs
// between the two implementations — the incremental path keeps more entries
// alive across an adoption — so equivalence is asserted on what consumers read.
function foldSignature(state) {
  const entrySignature = (entry) => (entry?.kind !== 'turn'
    ? { kind: entry?.kind, seq: entry?.seq, envelope: entry?.envelope?.id || '' }
    : {
      kind: 'turn',
      seq: entry.seq,
      turn: {
        requestId: entry.turn?.requestId || '',
        request: entry.turn?.request?.id || '',
        requestSeq: entry.turn?.requestSeq,
        lastSeq: entry.turn?.lastSeq,
        status: entry.turn?.status,
        terminal: entry.turn?.terminal?.id || '',
        terminalSeq: entry.turn?.terminalSeq,
        terminalClosureOnly: entry.turn?.terminalClosureOnly === true,
        provisional: (entry.turn?.provisional || []).map((item) => `${item.seq}:${item.envelope?.id || ''}`),
      },
      thread: (entry.thread || []).map(entrySignature),
    });
  return JSON.stringify({
    timeline: (state.timeline || []).map(entrySignature),
    narration: (state.narration || []).map((item) => `${item.seq}:${item.envelope?.id || ''}`),
    envelopes: [...state._envelopesById.keys()].sort(),
    lastSeq: state.lastSeq,
  });
}

// The audit re-runs the authoritative fold, so it costs exactly what this
// change exists to remove. Bounding it by row count keeps every branch of the
// incremental fold covered — each one is reachable within a handful of rows —
// while a test that deliberately floods a single channel does not pay a
// quadratic price to re-prove a shape the first rows already proved.
const FOLD_AUDIT_MAX_ROWS = 512;

let foldAudit = false;
try {
  foldAudit = globalThis.process?.env?.NODE_ENV === 'test'
    || globalThis.__ATOLL_REPLICA_FOLD_AUDIT__ === true;
} catch { foldAudit = false; }

// Opt-in outside tests. Within the bound above, every existing Replica,
// timeline and projection test becomes an equivalence test for free, which is
// the point: the guard is carried by the suite that already describes the
// fold, not by new assertions that only restate this file.
export function setReplicaFoldAudit(enabled) {
  const previous = foldAudit;
  foldAudit = enabled === true;
  return previous;
}

export function replicaFoldSignature(state) {
  return foldSignature(state);
}

// Re-derives the fold from `rows` alone. Exposed so a test can compare a state
// that reached its shape incrementally against the authority, including the
// trimmed-closure shapes the audit deliberately does not reach.
export function replicaRefold(state) {
  rebuildStateFull(state);
  return foldSignature(state);
}

function foldRow(state, seq, envelope) {
  if (!applyRowIncremental(state, seq, envelope)) { rebuildStateFull(state); return; }
  if (!foldAudit || state.rows.size > FOLD_AUDIT_MAX_ROWS) return;
  const incremental = foldSignature(state);
  rebuildStateFull(state);
  const authoritative = foldSignature(state);
  if (incremental === authoritative) return;
  throw Object.assign(new Error('replica incremental fold diverged from the authoritative fold'), {
    code: 'replica_fold_divergence',
    seq,
    envelopeId: envelope?.id || '',
    incremental,
    authoritative,
  });
}

function humanPrincipal(id) {
  const [kind, principal] = String(id || '').split(':');
  return kind === 'human' ? principal : '';
}

function createState(channelId) {
  const state = {
    channelId, rows: new Map(), timeline: [], narration: [], lastSeq: 0,
    _envelopesById: new Map(), _timelineRevision: 0, _timelineProjectionVersion: 0,
    // Exact parent-id lifecycle proofs survive row-window eviction. Complete
    // envelopes remain exclusively in `rows`; this map only says that a
    // terminal was observed, plus the fields required to join a later page.
    _unmatchedTerminalClosures: new Map(),
    _timelineChangeBase: 0, _timelineChangeLog: [],
  };
  return state;
}

export function createChannelReplicaStore() {
  let states = new Map();
  const records = new Map();

  function ensure(channelId) {
    let record = records.get(channelId);
    if (record) return record;
    const state = createState(channelId);
    record = { channelId, state, revision: 0, headSeq: 0, durableCoverage: [], materializedCoverage: [] };
    records.set(channelId, record);
    states.set(channelId, state);
    return record;
  }

  function commit(row, selfId = '', transform = (value) => value, { source = row?.source || '' } = {}) {
    const prepared = transform(row);
    const channelId = prepared?.channel_id;
    const seq = numeric(prepared?.seq);
    const envelope = prepared?.envelope;
    if (!channelId || !seq || !envelope) return { accepted: false, record: null, reason: 'invalid-row' };
    const record = ensure(channelId);
    if (record.state.rows.has(seq)) return { accepted: false, record, reason: 'duplicate-seq' };
    const knownEnvelope = envelope.id ? record.state._envelopesById.get(envelope.id) : null;
    const closurePlaceholder = knownEnvelope?.__terminalClosureRequest === true;
    if (envelope.id && knownEnvelope && !(closurePlaceholder && envelope.kind === 'request')) {
      return { accepted: false, record, reason: 'duplicate-envelope' };
    }
    record.state.rows.set(seq, envelope);
    foldRow(record.state, seq, envelope);
    record.revision += 1;
    record.headSeq = Math.max(record.headSeq, seq);
    record.materializedCoverage = mergeReplicaCoverage(record.materializedCoverage, { lowSeq: seq, highSeq: seq });
    // Durable ingress and canonical projection have different clocks. A
    // historical flat payload is retained in rows for transport/cache
    // evidence, but the fold deliberately exposes no business entry for
    // it. Do not invalidate projection consumers for a row they cannot see.
    if (hasProjectionBody(envelope)) {
      record.state._timelineRevision += 1;
      record.state._timelineProjectionVersion += 1;
      const rootID = rootRequestId(envelope, record.state._fold.allRequests) || envelope.id || '';
      record.state._timelineChangeLog.push({
        revision: record.state._timelineRevision,
        kind: envelope.kind === 'response' ? 'content' : 'structure',
        id: rootID,
        subjectID: envelope.parent_id || envelope.id || '',
      });
      if (record.state._timelineChangeLog.length > 256) {
        const removed = record.state._timelineChangeLog.splice(0, record.state._timelineChangeLog.length - 256);
        record.state._timelineChangeBase = removed.at(-1)?.revision || record.state._timelineChangeBase;
      }
    }
    return { accepted: true, record, row: prepared };
  }

  function installMeta(channelId, { headSeq = 0, newestSeq = 0, coverage = [] } = {}) {
    const record = ensure(channelId);
    record.headSeq = Math.max(record.headSeq, numeric(headSeq || newestSeq));
    record.durableCoverage = (Array.isArray(coverage) ? coverage : [])
      .reduce((all, range) => mergeReplicaCoverage(all, range), []);
    return record;
  }

  function trim(channelId, maximumRows) {
    const record = records.get(channelId);
    const limit = numeric(maximumRows);
    if (!record || !limit || record.state.rows.size <= limit) return 0;
    const seqs = [...record.state.rows.keys()].sort((a, b) => a - b);
    const ordinaryCut = seqs[record.state.rows.size - limit];
    const floor = openTurnFloor(record.state);
    const cut = Number.isFinite(floor) && floor > 0
      ? Math.min(ordinaryCut, floor)
      : ordinaryCut;
    const remove = seqs.filter((seq) => seq < cut);
    const projectionChanged = remove.some((seq) => hasProjectionBody(record.state.rows.get(seq)));
    retainTrimmedTerminalClosures(record.state, cut);
    for (const seq of remove) record.state.rows.delete(seq);
    // Keep a response whose parent is outside this materialized window in the
    // canonical rows map. A later request may legally arrive first/after a
    // separate history batch; the fold will merge that raw response once
    // its exact parent_id is present. Rows remain the only full-envelope
    // buffer; terminal closures carry lifecycle proof only.
    const removed = remove.length;
    if (!removed) return 0;
    rebuildStateFull(record.state);
    record.materializedCoverage = [...record.state.rows.keys()].sort((a, b) => a - b)
      .reduce((all, seq) => mergeReplicaCoverage(all, { lowSeq: seq, highSeq: seq }), []);
    record.revision += 1;
    if (projectionChanged) {
      record.state._timelineRevision += 1;
      record.state._timelineProjectionVersion += 1;
    }
    return removed;
  }

  function reset(channelId = '') {
    if (channelId) {
      states.delete(channelId);
      records.delete(channelId);
      return;
    }
    states = new Map();
    records.clear();
  }
  const bounds = (channelId) => [...(records.get(channelId)?.state.rows.keys() || [])];
  return Object.freeze({
    destroy: reset, ensure, commit, installMeta, trim, afterTrim: (channelId) => records.get(channelId), reset,
    states: () => states,
    state: (channelId) => records.get(channelId)?.state,
    record: (channelId) => records.get(channelId),
    revision: (channelId) => records.get(channelId)?.revision || 0,
    hasRow: (channelId, seq) => records.get(channelId)?.state.rows.has(numeric(seq)) === true,
    visibleOldest: (channelId) => { const seqs = bounds(channelId); return seqs.length ? Math.min(...seqs) : 0; },
    visibleNewest: (channelId) => records.get(channelId)?.state.lastSeq || 0,
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('replica cache request failed'));
  });
}

function openCache(indexedDB) {
  if (!indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DATABASE, CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('rows')) db.createObjectStore('rows', { keyPath: ['owner', 'channelId', 'seq'] });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: ['owner', 'channelId'] });
    };
    // Another page holding an older version open must not hang every read
    // and write behind this open: the cache degrades to memory instead.
    let settled = false;
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error || new Error('replica cache open failed'));
    };
  });
}

// Rows are keyed [owner, channelId, seq]. A longer array with an equal prefix
// sorts after its prefix, and an array sorts after every string or number, so
// these bounds select exactly one owner's (or one channel's) rows.
function ownerRange(owner) {
  return globalThis.IDBKeyRange?.bound([owner], [owner, []]);
}

function channelRange(owner, channelId, beforeSeq = Number.MAX_SAFE_INTEGER) {
  return globalThis.IDBKeyRange?.bound([owner, channelId, 0], [owner, channelId, beforeSeq], false, true);
}

// Walk one channel's rows newest-first below `beforeSeq`, stopping after
// `count` rows. Only the rows a page needs cross into the page thread.
function readChannelDescending(db, owner, channelId, beforeSeq, count) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const request = db.transaction('rows', 'readonly').objectStore('rows')
      .openCursor(channelRange(owner, channelId, beforeSeq), 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length >= count) { resolve(rows); return; }
      rows.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error('replica cache read failed'));
  });
}

function readChannelOldestSeq(db, owner, channelId) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('rows', 'readonly').objectStore('rows')
      .openCursor(channelRange(owner, channelId), 'next');
    request.onsuccess = () => resolve(numeric(request.result?.value?.seq));
    request.onerror = () => reject(request.error || new Error('replica cache read failed'));
  });
}

export function replicaResumeSnapshot(meta) {
  return Object.fromEntries([...meta].map(([channelId, value]) => [channelId, numeric(value?.headSeq || value?.newestSeq)]));
}

// Durable cache belongs to the Replica boundary but never bypasses commit.
export function createChannelReplicaCache({ indexedDB = globalThis.indexedDB } = {}) {
  let owner = '';
  let ownerEpoch = 0;
  // An unopenable cache is a memory cache, not a failed page.
  let dbPromise = openCache(indexedDB).catch(() => null);
  let meta = new Map();
  const quotaBounds = new Map();
  let operationTail = Promise.resolve();
  const enqueue = (operation) => {
    const run = operationTail.then(operation, operation);
    operationTail = run.catch(() => {});
    return run;
  };
  const memoryForOwner = () => {
    if (!memoryCache.has(owner)) memoryCache.set(owner, { rows: new Map(), meta: new Map() });
    return memoryCache.get(owner);
  };

  const ownerChanged = () => Object.assign(new Error('replica cache owner changed'), { code: 'cache_owner_changed' });
  const assertOwner = (operationOwner, epoch) => {
    if (epoch !== ownerEpoch || operationOwner !== owner) throw ownerChanged();
  };
  const copyMeta = (value = {}) => {
    const copied = {
      ...value,
      coverage: mergeReplicaCoverage(value.coverage || []),
    };
    const quotaTailRows = numeric(value.quotaTailRows);
    if (quotaTailRows > 0) copied.quotaTailRows = quotaTailRows;
    else delete copied.quotaTailRows;
    return copied;
  };
  const physicalCoverage = (entries = []) => {
    const seqs = [...new Set(entries.map((entry) => numeric(entry?.seq)).filter((seq) => seq > 0))]
      .sort((left, right) => left - right);
    return seqs.reduce((ranges, seq) => mergeReplicaCoverage(ranges, { lowSeq: seq, highSeq: seq }), []);
  };
  const metadataForEntries = (entries, base = {}) => {
    const seqs = entries.map((entry) => numeric(entry?.seq)).filter(Boolean);
    return {
      ...copyMeta(base),
      headSeq: Math.max(numeric(base.headSeq), ...seqs),
      oldestSeq: seqs.length ? Math.min(...seqs) : 0,
      newestSeq: seqs.length ? Math.max(...seqs) : 0,
      rowCount: seqs.length,
    };
  };
  const metadataForPhysicalEntries = (entries, base = {}, quotaTailRows = 0) => {
    const value = metadataForEntries(entries, { ...base, headSeq: 0, coverage: [] });
    value.headSeq = value.newestSeq;
    value.coverage = physicalCoverage(entries);
    if (numeric(quotaTailRows) > 0) value.quotaTailRows = numeric(quotaTailRows);
    else delete value.quotaTailRows;
    return value;
  };

  function mergePhysicalRecords(existing = [], incoming = [], operationOwner, channelId) {
    const bySeq = new Map();
    for (const entry of existing) {
      const seq = numeric(entry?.seq);
      if (seq > 0) bySeq.set(seq, {
        owner: operationOwner,
        channelId,
        seq,
        row: entry.row,
        ...(entry.redacted ? { redacted: true } : {}),
      });
    }
    for (const row of incoming) {
      const seq = numeric(row?.seq);
      if (seq > 0) bySeq.set(seq, {
        owner: operationOwner,
        channelId,
        seq,
        row: structuredClone(row),
      });
    }
    return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
  }

  // A bounded cache is a newest-tail window. Older network refill rows are
  // allowed to be dropped when the tail is already full; protecting every
  // incoming row would evict the existing newer tail (for example 8..14 for
  // an older 1..7 refill). The network page is still applied to Replica by
  // Feed, while durable rows/meta remain one bounded physical window.
  function physicalWindow(existing, incoming, limit, operationOwner, channelId, recovering = false) {
    const retainedExisting = recovering
      ? existing.slice(-Math.floor(existing.length / 2))
      : existing;
    const merged = mergePhysicalRecords(retainedExisting, incoming, operationOwner, channelId);
    const maximum = numeric(limit);
    if (!maximum || merged.length <= maximum) return merged;
    return merged.slice(-maximum);
  }

  async function ownedRows(db, operationOwner, epoch) {
    assertOwner(operationOwner, epoch);
    if (!db) {
      const memory = memoryForOwner();
      return [...memory.rows.values()]
        .filter((row) => row?.channel_id)
        .map((row) => ({ owner: operationOwner, channelId: row.channel_id, seq: numeric(row.seq), row }));
    }
    const records = await requestResult(db.transaction('rows', 'readonly').objectStore('rows')
      .getAll(ownerRange(operationOwner)));
    assertOwner(operationOwner, epoch);
    return records.filter((entry) => entry.owner === operationOwner);
  }

  async function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      transaction.oncomplete = () => finish(resolve);
      transaction.onabort = () => finish(reject, transaction.error || new Error('replica cache transaction aborted'));
      transaction.onerror = () => {
        // IndexedDB aborts the transaction after the error event. Keep the
        // rejection on onabort so a synchronous request exception and a
        // request-level error share one settlement path.
      };
    });
  }

  async function persistBatch(db, operationOwner, epoch, rows, touched) {
    assertOwner(operationOwner, epoch);
    if (!db) {
      const memory = memoryForOwner();
      for (const row of rows) memory.rows.set(`${row.channel_id}\u0000${row.seq}`, structuredClone(row));
      for (const [channelId, value] of touched) meta.set(channelId, copyMeta(value));
      memory.meta = new Map([...meta].map(([channelId, value]) => [channelId, copyMeta(value)]));
      return;
    }
    const transaction = db.transaction(['rows', 'meta'], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      for (const row of rows) {
        transaction.objectStore('rows').put({
          owner: operationOwner,
          channelId: row.channel_id,
          seq: numeric(row.seq),
          row,
        });
      }
      for (const [channelId, value] of touched) {
        transaction.objectStore('meta').put({
          owner: operationOwner,
          channelId,
          value: structuredClone(copyMeta(value)),
        });
      }
    } catch (error) {
      try { transaction.abort(); } catch { /* already inactive */ }
      try { await completion; } catch { /* preserve original request error */ }
      throw error;
    }
    await completion;
    assertOwner(operationOwner, epoch);
    for (const [channelId, value] of touched) meta.set(channelId, copyMeta(value));
  }

  // Quota recovery is one clear/rebuild transaction. The old implementation
  // trimmed in one transaction, appended in another, and copied the old
  // broad coverage into Meta; a later failure could therefore leave physical
  // rows and Meta describing different windows. The replacement below deletes
  // only this owner/channel's known rows, installs the retained redacted
  // window, and commits its physical coverage together with the rows.
  async function replaceChannelRows(db, operationOwner, epoch, replacements) {
    assertOwner(operationOwner, epoch);
    if (!replacements.size) return;
    if (!db) {
      const memory = memoryForOwner();
      for (const [channelId, replacement] of replacements) {
        for (const entry of replacement.existing) {
          memory.rows.delete(`${channelId}\u0000${numeric(entry.seq)}`);
        }
        for (const entry of replacement.target) {
          memory.rows.set(`${channelId}\u0000${numeric(entry.seq)}`, structuredClone(redactSensitive(entry.row)));
        }
        meta.set(channelId, copyMeta(replacement.value));
      }
      memory.meta = new Map([...meta].map(([id, item]) => [id, copyMeta(item)]));
      return;
    }
    const transaction = db.transaction(['rows', 'meta'], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      const rowsStore = transaction.objectStore('rows');
      const metaStore = transaction.objectStore('meta');
      for (const [channelId, replacement] of replacements) {
        for (const entry of replacement.existing) {
          rowsStore.delete([operationOwner, channelId, numeric(entry.seq)]);
        }
        for (const entry of replacement.target) rowsStore.put({
          owner: operationOwner,
          channelId,
          seq: numeric(entry.seq),
          row: structuredClone(redactSensitive(entry.row)),
        });
        metaStore.put({
          owner: operationOwner,
          channelId,
          value: structuredClone(copyMeta(replacement.value)),
        });
      }
    } catch (error) {
      try { transaction.abort(); } catch { /* already inactive */ }
      try { await completion; } catch { /* preserve original request error */ }
      throw error;
    }
    await completion;
    assertOwner(operationOwner, epoch);
    for (const [channelId, replacement] of replacements) {
      meta.set(channelId, copyMeta(replacement.value));
    }
  }

  // Startup treats the physical rows as the durable source of truth. Old Meta
  // can describe a window that was only half committed, so reconcile it to
  // the rows that actually exist, preserve only a known quota tail bound, and
  // redact every survivor before publishing the in-memory snapshot.
  async function reconcileOwnerRows(db, operationOwner, epoch) {
    assertOwner(operationOwner, epoch);
    const physical = await ownedRows(db, operationOwner, epoch);
    const byChannel = new Map();
    for (const entry of physical) {
      const channel = byChannel.get(entry.channelId) || [];
      const { row, changed } = sanitizedCacheRow(entry.row);
      channel.push({ ...entry, row, redacted: changed });
      byChannel.set(entry.channelId, channel);
    }

    const targets = new Map();
    const nextMeta = new Map();
    for (const [channelId, entries] of byChannel) {
      entries.sort((left, right) => numeric(left.seq) - numeric(right.seq));
      const previous = meta.get(channelId) || {};
      const quotaTailRows = numeric(previous.quotaTailRows);
      const target = quotaTailRows > 0
        ? physicalWindow(entries, [], quotaTailRows, operationOwner, channelId)
        : entries;
      const value = metadataForPhysicalEntries(target, previous, quotaTailRows);
      targets.set(channelId, { existing: entries, target, value });
      nextMeta.set(channelId, value);
    }

    if (!db) {
      const memory = memoryForOwner();
      for (const entry of physical) memory.rows.delete(`${entry.channelId}\u0000${numeric(entry.seq)}`);
      for (const [channelId, replacement] of targets) {
        for (const entry of replacement.target) {
          memory.rows.set(`${channelId}\u0000${numeric(entry.seq)}`, structuredClone(redactSensitive(entry.row)));
        }
      }
      meta = nextMeta;
      memory.meta = new Map([...meta].map(([channelId, value]) => [channelId, copyMeta(value)]));
      quotaBounds.clear();
      for (const [channelId, value] of meta) {
        const limit = numeric(value.quotaTailRows);
        if (limit > 0) quotaBounds.set(channelId, limit);
      }
      return;
    }

    // Most opens find nothing to repair. Only rows that fall outside a quota
    // window or still carry unredacted fields are rewritten; the rest is
    // left exactly where it is.
    const transaction = db.transaction(['rows', 'meta'], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      const rowsStore = transaction.objectStore('rows');
      const metaStore = transaction.objectStore('meta');
      for (const [channelId, replacement] of targets) {
        const kept = new Set(replacement.target.map((entry) => numeric(entry.seq)));
        for (const entry of replacement.existing) {
          if (!kept.has(numeric(entry.seq))) rowsStore.delete([operationOwner, channelId, numeric(entry.seq)]);
        }
        for (const entry of replacement.target) {
          if (!entry.redacted) continue;
          rowsStore.put({
            owner: operationOwner,
            channelId,
            seq: numeric(entry.seq),
            row: structuredClone(entry.row),
          });
        }
        metaStore.put({
          owner: operationOwner,
          channelId,
          value: structuredClone(copyMeta(replacement.value)),
        });
      }
      for (const channelId of meta.keys()) {
        if (!nextMeta.has(channelId)) metaStore.delete([operationOwner, channelId]);
      }
    } catch (error) {
      try { transaction.abort(); } catch { /* already inactive */ }
      try { await completion; } catch { /* preserve original request error */ }
      throw error;
    }
    await completion;
    assertOwner(operationOwner, epoch);
    meta = nextMeta;
    quotaBounds.clear();
    for (const [channelId, value] of meta) {
      const limit = numeric(value.quotaTailRows);
      if (limit > 0) quotaBounds.set(channelId, limit);
    }
  }

  let ownerSelection = null;
  function ensureOwner(principalId, { world = '' } = {}) {
    const selectedOwner = `${String(principalId || '')}\u0000${String(world || '')}`;
    // Re-selecting the owner already selected keeps what it holds: a
    // reconnect to the same world is not a reason to forget the snapshot or
    // to read the store again.
    if (selectedOwner === owner && ownerSelection) {
      return ownerSelection.then(() => ({ changed: false, boot: world, meta: new Map(meta) }));
    }
    const epoch = ++ownerEpoch;
    owner = selectedOwner;
    // A different owner's facts are not this owner's.
    meta = new Map();
    quotaBounds.clear();
    const selection = enqueue(async () => {
      const db = await dbPromise;
      assertOwner(selectedOwner, epoch);
      if (!db) meta = new Map(memoryForOwner().meta);
      else {
        const entries = await requestResult(db.transaction('meta', 'readonly').objectStore('meta')
          .getAll(ownerRange(selectedOwner)));
        assertOwner(selectedOwner, epoch);
        for (const entry of entries) if (entry.owner === selectedOwner) {
          meta.set(entry.channelId, copyMeta(entry.value));
        }
      }
      await reconcileOwnerRows(db, selectedOwner, epoch);
      return { changed: false, boot: world, meta: new Map(meta) };
    });
    ownerSelection = selection;
    selection.catch(() => { if (ownerSelection === selection) ownerSelection = null; });
    return selection;
  }

  async function saveRowsNow(rows, { coverage } = {}, operationOwner, epoch) {
    const accepted = (rows || []).filter((row) => row?.channel_id && numeric(row?.seq));
    const persistedRows = accepted.map((row) => redactSensitive(row));
    const db = await dbPromise;
    assertOwner(operationOwner, epoch);
    const touchedChannels = new Set(accepted.map((row) => row.channel_id));
    if (coverage?.channelId) touchedChannels.add(coverage.channelId);
    if (!accepted.length && !touchedChannels.size) return 0;

    const buildTouched = () => {
      const touched = new Map();
      for (const row of accepted) {
        const channelId = row.channel_id;
        const seq = numeric(row.seq);
        const known = touched.get(channelId) || copyMeta(meta.get(channelId));
        const current = {
          ...known,
          headSeq: Math.max(numeric(known.headSeq), seq),
          newestSeq: Math.max(numeric(known.newestSeq), seq),
          oldestSeq: numeric(known.oldestSeq) ? Math.min(numeric(known.oldestSeq), seq) : seq,
          rowCount: numeric(known.rowCount) + 1,
          coverage: mergeReplicaCoverage(known.coverage, { lowSeq: seq, highSeq: seq }),
        };
        touched.set(channelId, current);
      }
      if (coverage?.channelId) {
        const known = touched.get(coverage.channelId) || copyMeta(meta.get(coverage.channelId));
        touched.set(coverage.channelId, {
          ...known,
          coverage: mergeReplicaCoverage(known.coverage, coverage),
        });
      }
      return touched;
    };

    const incomingByChannel = new Map();
    for (const row of persistedRows) {
      if (!incomingByChannel.has(row.channel_id)) incomingByChannel.set(row.channel_id, []);
      incomingByChannel.get(row.channel_id).push(row);
    }

    const replacementFor = async (channels, { recovering = false, bounds = new Map() } = {}) => {
      const physical = await ownedRows(db, operationOwner, epoch);
      const touched = buildTouched();
      const replacements = new Map();
      for (const channelId of channels) {
        const existing = physical
          .filter((entry) => entry.channelId === channelId)
          .sort((left, right) => numeric(left.seq) - numeric(right.seq));
        const incoming = incomingByChannel.get(channelId) || [];
        const limit = numeric(bounds.get(channelId) || quotaBounds.get(channelId));
        const target = physicalWindow(
          existing,
          incoming,
          limit || Math.max(QUOTA_MIN_RETAINED_ROWS, existing.length),
          operationOwner,
          channelId,
          recovering,
        );
        const value = metadataForPhysicalEntries(
          target,
          touched.get(channelId) || meta.get(channelId),
          limit,
        );
        replacements.set(channelId, { existing, target, value });
      }
      return replacements;
    };

    const persist = () => persistBatch(db, operationOwner, epoch, persistedRows, buildTouched());
    const boundedTouched = [...touchedChannels].filter((channelId) => quotaBounds.has(channelId));
    if (boundedTouched.length) {
      // Once a channel has hit quota, every later write to it uses the same
      // atomic physical-window transaction. This also clips an explicit broad
      // coverage hint to rows that really exist after a reload.
      const replacements = await replacementFor(boundedTouched);
      try {
        await replaceChannelRows(db, operationOwner, epoch, replacements);
      } catch (error) {
        if (isQuotaError(error)) throw cacheUnavailableError();
        throw error;
      }
      const unboundedChannels = [...touchedChannels].filter((channelId) => !quotaBounds.has(channelId));
      const unboundedRows = persistedRows.filter((row) => !quotaBounds.has(row.channel_id));
      if (unboundedChannels.length && (unboundedRows.length || coverage?.channelId && unboundedChannels.includes(coverage.channelId))) {
        const unboundedTouched = new Map([...buildTouched()]
          .filter(([channelId]) => unboundedChannels.includes(channelId)));
        await persistBatch(db, operationOwner, epoch, unboundedRows, unboundedTouched);
      }
      return accepted.length;
    }

    try {
      await persist();
    } catch (error) {
      if (!isQuotaError(error)) throw error;

      // The failed transaction is rolled back before eviction. Rebuild every
      // touched channel in one rows+meta transaction so a retry either
      // commits a physically represented window or leaves the old window and
      // its metadata untouched.
      const bounds = new Map();
      for (const channelId of touchedChannels) {
        const records = (await ownedRows(db, operationOwner, epoch))
          .filter((entry) => entry.channelId === channelId);
        const count = records.length;
        if (count || (incomingByChannel.get(channelId) || []).length) {
          bounds.set(channelId, Math.max(QUOTA_MIN_RETAINED_ROWS, count));
        }
      }
      const replacements = await replacementFor(touchedChannels, { recovering: true, bounds });
      try {
        await replaceChannelRows(db, operationOwner, epoch, replacements);
      } catch (retryError) {
        if (isQuotaError(retryError)) throw cacheUnavailableError();
        throw retryError;
      }
      for (const [channelId, limit] of bounds) quotaBounds.set(channelId, limit);
    }
    return accepted.length;
  }

  function saveRows(rows, options = {}) {
    const operationOwner = owner;
    const epoch = ownerEpoch;
    return enqueue(() => saveRowsNow(rows, options, operationOwner, epoch));
  }

  async function readBefore(channelId, beforeSeq = Number.MAX_SAFE_INTEGER, limit = 128, byteLimit = 1024 * 1024) {
    const operationOwner = owner;
    const epoch = ownerEpoch;
    const before = numeric(beforeSeq) || Number.MAX_SAFE_INTEGER;
    const maximum = Math.max(1, numeric(limit) || 128);
    const maximumBytes = Math.max(1, numeric(byteLimit) || 1024 * 1024);
    const db = await dbPromise;
    if (epoch !== ownerEpoch || operationOwner !== owner) throw Object.assign(new Error('replica cache owner changed'), { code: 'cache_owner_changed' });
    let available;
    let physicalOldestSeq = 0;
    if (!db) {
      const memory = memoryForOwner();
      available = [];
      for (const [key, cachedRow] of memory.rows) {
        const { row, changed } = sanitizedCacheRow(cachedRow);
        if (changed) memory.rows.set(key, row);
        if (row.channel_id === channelId) {
          const seq = numeric(row.seq);
          physicalOldestSeq = physicalOldestSeq ? Math.min(physicalOldestSeq, seq) : seq;
          if (seq < before) available.push(row);
        }
      }
      available.sort((left, right) => numeric(right.seq) - numeric(left.seq));
    } else {
      // One page plus one row answers both "what is on this page" and "is
      // there anything older below it"; the channel's oldest row closes EOF.
      const [records, oldestSeq] = await Promise.all([
        readChannelDescending(db, operationOwner, channelId, before, maximum + 1),
        readChannelOldestSeq(db, operationOwner, channelId),
      ]);
      if (epoch !== ownerEpoch || operationOwner !== owner) throw Object.assign(new Error('replica cache owner changed'), { code: 'cache_owner_changed' });
      physicalOldestSeq = oldestSeq;
      available = records.map((entry) => sanitizedCacheRow(entry.row).row);
    }
    const selected = [];
    let bytes = 0;
    for (const row of available) {
      const size = rowBytes(row);
      if (selected.length >= maximum || (selected.length && bytes + size > maximumBytes)) break;
      selected.push(row);
      bytes += size;
    }
    selected.sort((left, right) => numeric(left.seq) - numeric(right.seq));
    // A short page is not proof of remote EOF when the local physical window
    // starts above sequence 1. In particular, beforeSeq=9 with only row 8
    // available must continue to network refill instead of publishing
    // exhausted=true. A physical lower boundary at sequence 1 closes the
    // local source only when every requested sequence below the cursor is
    // represented; a sparse [1, 3] window still has an unknown row 2.
    const localFrontier = before > 0 ? before - 1 : 0;
    let contiguousPrefix = localFrontier === 0;
    if (!contiguousPrefix && available.length) {
      let expected = 1;
      contiguousPrefix = true;
      for (let index = available.length - 1; index >= 0; index -= 1) {
        if (numeric(available[index]?.seq) !== expected) {
          contiguousPrefix = false;
          break;
        }
        expected += 1;
      }
      contiguousPrefix = contiguousPrefix && expected === localFrontier + 1;
    }
    const exhausted = available.length <= selected.length
      && physicalOldestSeq > 0
      && physicalOldestSeq <= 1
      && contiguousPrefix;
    return {
      rows: selected,
      nextBeforeSeq: selected.length ? numeric(selected[0].seq) : before,
      exhausted,
      bytes,
    };
  }

  async function clearNow(operationOwner, epoch) {
    const db = await dbPromise;
    assertOwner(operationOwner, epoch);
    if (!db) {
      memoryCache.delete(operationOwner);
      meta = new Map();
      quotaBounds.clear();
      return;
    }
    const keysByStore = new Map();
    for (const storeName of ['rows', 'meta']) {
      const keys = await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys());
      keysByStore.set(storeName, keys.filter((key) => key[0] === operationOwner));
    }
    const transaction = db.transaction(['rows', 'meta'], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      for (const storeName of ['rows', 'meta']) {
        const store = transaction.objectStore(storeName);
        for (const key of keysByStore.get(storeName)) store.delete(key);
      }
    } catch (error) {
      try { transaction.abort(); } catch { /* already inactive */ }
      try { await completion; } catch { /* preserve original request error */ }
      throw error;
    }
    await completion;
    assertOwner(operationOwner, epoch);
    memoryCache.delete(operationOwner);
    meta = new Map();
    quotaBounds.clear();
  }

  function clear() {
    const operationOwner = owner;
    const epoch = ownerEpoch;
    return enqueue(() => clearNow(operationOwner, epoch));
  }

  return Object.freeze({
    ensureOwner, saveRows, readBefore, clear,
    saveCoverage: (channelId, lowSeq, highSeq) => saveRows([], { coverage: { channelId, lowSeq, highSeq } }),
    metaSnapshot: () => new Map(meta),
    // The snapshot only speaks for the owner it was read for.
    metaSnapshotFor: (principalId, world) => (
      owner === `${String(principalId || '')}\u0000${String(world || '')}` ? new Map(meta) : new Map()
    ),
    destroy: async () => { const db = await dbPromise; db?.close(); dbPromise = Promise.resolve(null); },
  });
}
