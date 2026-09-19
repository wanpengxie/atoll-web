import { argsOf, FINAL } from '../protocol/envelope.js';
import { isNarrationEnvelope } from '../protocol/vocab.js';
import { LIVE_ARRIVAL_RECEIPT } from './live-arrivals.js';
import { isViewportNotifiableDisposition, notificationDisposition } from './notification-policy.js';

const CACHE_DATABASE = 'atoll-channel-replica-v1';
const CACHE_VERSION = 1;
const LIVE_ARRIVAL_LIMIT = 1_024;
const LIVE_PRESENTATION_ARRIVAL_LIMIT = 1_024;
const memoryCache = new Map();

function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function rowBytes(row) {
  try { return new TextEncoder().encode(JSON.stringify(row)).byteLength; }
  catch { return 0; }
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

function rootRequestId(envelope, requests) {
  if (envelope?.kind === 'request') {
    const correlation = String(envelope.correlation_id || '');
    if (correlation && correlation !== envelope.id && requests.has(correlation)) return correlation;
    let parent = String(envelope.parent_id || '');
    const visited = new Set();
    while (parent && requests.has(parent) && !visited.has(parent)) {
      visited.add(parent);
      const request = requests.get(parent);
      const next = String(request.parent_id || request.correlation_id || '');
      if (!next || next === parent || !requests.has(next)) return parent;
      parent = next;
    }
    return envelope.id;
  }
  let parent = String(envelope?.parent_id || envelope?.correlation_id || '');
  const visited = new Set();
  while (parent && requests.has(parent) && !visited.has(parent)) {
    visited.add(parent);
    const request = requests.get(parent);
    const next = String(request.parent_id || request.correlation_id || '');
    if (!next || next === parent || !requests.has(next)) return parent;
    parent = next;
  }
  return '';
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
  const parentID = String(request?.parent_id || request?.correlation_id || '');
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
    if (envelope?.kind === 'request' && envelope.id) {
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
// the fold is recomputed from that canonical row set so out-of-order cache,
// history and live delivery cannot create competing folds. Reconciliation
// keeps surviving turn identities stable for Presentation's content path.
function rebuildState(state) {
  const orderedRows = [...state.rows.entries()].sort((left, right) => left[0] - right[0]);
  const requests = new Map();
  const requestSeqs = new Map();
  const responses = new Map();
  const standalone = [];
  state._envelopesById = new Map();
  state.narration = [];
  for (const [seq, envelope] of orderedRows) {
    if (!envelope) continue;
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
}

function humanPrincipal(id) {
  const [kind, principal] = String(id || '').split(':');
  return kind === 'human' ? principal : '';
}

function isSelfActor(actorId, selfId) {
  if (!actorId || !selfId) return false;
  if (actorId === selfId) return true;
  const principal = humanPrincipal(selfId);
  return Boolean(principal && principal === humanPrincipal(actorId));
}

function entryEnvelopes(entry) {
  if (entry?.kind !== 'turn') return [entry?.envelope].filter(Boolean);
  const envelopes = [entry.turn?.request, entry.turn?.terminal];
  for (const provisional of entry.turn?.provisional || []) envelopes.push(provisional?.envelope);
  for (const child of entry.thread || []) envelopes.push(...entryEnvelopes(child));
  return envelopes.filter(Boolean);
}

function entryContainsEnvelope(entry, envelopeID) {
  return Boolean(envelopeID && entryEnvelopes(entry).some((envelope) => envelope?.id === envelopeID));
}

function entryInvolves(entry, selfId) {
  return entryEnvelopes(entry).some((envelope) => (
    isSelfActor(envelope?.sender?.id, selfId)
    || envelope?.audience?.some((audience) => isSelfActor(audience, selfId))
  ));
}

function rootTimelineEntry(state, envelope) {
  return (state?.timeline || []).find((entry) => entryContainsEnvelope(entry, envelope?.id));
}

function rootTurnID(envelope, entry) {
  if (entry?.kind === 'turn') return entry.turn.requestId;
  if (envelope?.kind === 'request') return envelope.id || '';
  return envelope?.correlation_id || envelope?.parent_id || envelope?.id || entry?.envelope?.id || '';
}

function recordLiveTimelineArrival(state, envelope, seq, selfId) {
  if (!selfId || isSelfActor(envelope?.sender?.id, selfId)) return;
  const disposition = notificationDisposition(state, envelope, selfId);
  const entry = rootTimelineEntry(state, envelope);
  let rowID = '';
  let key = '';
  if (disposition === 'request' || disposition === 'final') {
    key = rootTurnID(envelope, entry);
    rowID = entry?.kind === 'turn' ? key : envelope.id || key;
  } else if (disposition === 'event') {
    rowID = envelope.id || '';
    key = rowID;
  }
  if (!isViewportNotifiableDisposition(disposition) || !rowID || !entryInvolves(entry, selfId)) return;

  const previousRevision = state._liveArrivalRevision;
  const hadUndisposedArrival = state._liveArrivalAckRevision < previousRevision;
  const event = Object.freeze({
    revision: previousRevision + 1,
    key: String(key || rowID),
    rowID: String(rowID),
    seq,
  });
  state._liveArrivalRevision = event.revision;
  state._liveArrivalLog.push(event);
  if (state._liveArrivalLog.length > LIVE_ARRIVAL_LIMIT) {
    const removed = state._liveArrivalLog.splice(0, state._liveArrivalLog.length - LIVE_ARRIVAL_LIMIT);
    for (const item of removed) {
      if (item.revision <= state._liveArrivalAckRevision) continue;
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
  if (!state._liveArrivalConsumerTokens.size && !hadUndisposedArrival) {
    state._liveArrivalAckRevision = event.revision;
    state._liveArrivalLog = [];
    state._liveArrivalOverflow.clear();
  }
}

function livePresentationRowIDs(state, envelope, seq, entry) {
  const ids = new Set();
  if (isNarrationEnvelope(envelope)) {
    const narrationSeq = Number(state.narration?.[0]?.seq || seq || 0);
    if (narrationSeq > 0) ids.add(`narration:${narrationSeq}`);
  }
  if (envelope.kind === 'request' || envelope.kind === 'response') {
    const rootID = rootTurnID(envelope, entry);
    if (rootID) ids.add(String(rootID));
  }
  if (envelope.id) ids.add(String(envelope.id));
  return Object.freeze([...ids]);
}

function recordLivePresentationArrival(state, envelope, seq) {
  if (!state._livePresentationArrivalConsumerTokens.size) return;
  const rowIDs = livePresentationRowIDs(state, envelope, seq, rootTimelineEntry(state, envelope));
  if (!rowIDs.length) return;
  const event = Object.freeze({
    revision: state._livePresentationArrivalRevision + 1,
    rowIDs,
    seq,
    sourceRevision: state._timelineRevision,
  });
  state._livePresentationArrivalRevision = event.revision;
  state._livePresentationArrivalLog.push(event);
  if (state._livePresentationArrivalLog.length > LIVE_PRESENTATION_ARRIVAL_LIMIT) {
    const removed = state._livePresentationArrivalLog.splice(
      0,
      state._livePresentationArrivalLog.length - LIVE_PRESENTATION_ARRIVAL_LIMIT,
    );
    state._livePresentationArrivalAckRevision = Math.max(
      state._livePresentationArrivalAckRevision,
      Number(removed.at(-1)?.revision || 0),
    );
  }
}

function timelineArrivalSnapshot(state) {
  const overflow = [...state._liveArrivalOverflow.values()];
  const hot = [...state._liveArrivalLog];
  return Object.freeze({
    revision: state._liveArrivalRevision,
    acknowledgedRevision: state._liveArrivalAckRevision,
    events: Object.freeze([...overflow, ...hot].sort((left, right) => left.revision - right.revision)),
  });
}

function presentationArrivalSnapshot(state, throughSourceRevision = Number.POSITIVE_INFINITY) {
  const events = [];
  let revision = state._livePresentationArrivalAckRevision;
  for (const event of state._livePresentationArrivalLog) {
    if (event.revision <= state._livePresentationArrivalAckRevision) continue;
    if (event.sourceRevision > Number(throughSourceRevision)) break;
    events.push(event);
    revision = event.revision;
  }
  return Object.freeze({
    revision,
    headRevision: state._livePresentationArrivalRevision,
    acknowledgedRevision: state._livePresentationArrivalAckRevision,
    events: Object.freeze(events),
  });
}

function acknowledgeTimelineArrivals(state, throughRevision) {
  const revision = Math.min(
    state._liveArrivalRevision,
    Math.max(state._liveArrivalAckRevision, numeric(throughRevision)),
  );
  state._liveArrivalAckRevision = revision;
  state._liveArrivalLog = state._liveArrivalLog.filter((event) => event.revision > revision);
  for (const [key, event] of state._liveArrivalOverflow) {
    if (event.revision <= revision) state._liveArrivalOverflow.delete(key);
  }
  return revision;
}

function acknowledgePresentationArrivals(state, throughRevision) {
  const revision = Math.min(
    state._livePresentationArrivalRevision,
    Math.max(state._livePresentationArrivalAckRevision, numeric(throughRevision)),
  );
  state._livePresentationArrivalAckRevision = revision;
  state._livePresentationArrivalLog = state._livePresentationArrivalLog
    .filter((event) => event.revision > revision);
  return revision;
}

function arrivalReceiptPort(state) {
  return Object.freeze({
    timeline: () => timelineArrivalSnapshot(state),
    presentation: (throughSourceRevision) => presentationArrivalSnapshot(state, throughSourceRevision),
    attachTimelineConsumer(consumerToken) {
      state._liveArrivalConsumerTokens.add(consumerToken);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        state._liveArrivalConsumerTokens.delete(consumerToken);
      };
    },
    attachPresentationConsumer(consumerToken) {
      if (state._livePresentationArrivalConsumerTokens.size === 0) {
        acknowledgePresentationArrivals(state, state._livePresentationArrivalRevision);
      }
      state._livePresentationArrivalConsumerTokens.add(consumerToken);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        state._livePresentationArrivalConsumerTokens.delete(consumerToken);
        if (state._livePresentationArrivalConsumerTokens.size === 0) {
          acknowledgePresentationArrivals(state, state._livePresentationArrivalRevision);
        }
      };
    },
    dispatch(command) {
      if (command?.type === LIVE_ARRIVAL_RECEIPT.acknowledgeTimeline) {
        return acknowledgeTimelineArrivals(state, command.throughRevision);
      }
      if (command?.type === LIVE_ARRIVAL_RECEIPT.acknowledgePresentation) {
        return acknowledgePresentationArrivals(state, command.throughRevision);
      }
      throw new TypeError('Unknown live-arrival receipt command');
    },
  });
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
    _liveArrivalRevision: 0, _liveArrivalAckRevision: 0,
    _liveArrivalLog: [], _liveArrivalConsumerTokens: new Set(), _liveArrivalOverflow: new Map(),
    _livePresentationArrivalRevision: 0, _livePresentationArrivalAckRevision: 0,
    _livePresentationArrivalLog: [], _livePresentationArrivalConsumerTokens: new Set(),
  };
  state.arrivalReceipts = arrivalReceiptPort(state);
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
    rebuildState(record.state);
    record.revision += 1;
    record.headSeq = Math.max(record.headSeq, seq);
    record.materializedCoverage = mergeReplicaCoverage(record.materializedCoverage, { lowSeq: seq, highSeq: seq });
    record.state._timelineRevision += 1;
    record.state._timelineProjectionVersion += 1;
    const requests = new Map([...record.state._envelopesById.values()]
      .filter((value) => value.kind === 'request').map((value) => [value.id, value]));
    const rootID = rootRequestId(envelope, requests) || envelope.id || '';
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
    if (source === 'live') {
      recordLiveTimelineArrival(record.state, envelope, seq, selfId);
      recordLivePresentationArrival(record.state, envelope, seq);
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
    retainTrimmedTerminalClosures(record.state, cut);
    for (const seq of remove) record.state.rows.delete(seq);
    // Keep a response whose parent is outside this materialized window in the
    // canonical rows map. A later request may legally arrive first/after a
    // separate history batch; rebuildState will merge that raw response once
    // its exact parent_id is present. Rows remain the only full-envelope
    // buffer; terminal closures carry lifecycle proof only.
    const removed = remove.length;
    if (!removed) return 0;
    rebuildState(record.state);
    record.materializedCoverage = [...record.state.rows.keys()].sort((a, b) => a - b)
      .reduce((all, seq) => mergeReplicaCoverage(all, { lowSeq: seq, highSeq: seq }), []);
    record.revision += 1;
    record.state._timelineRevision += 1;
    record.state._timelineProjectionVersion += 1;
    return removed;
  }

  function reset() { states = new Map(); records.clear(); }
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('replica cache open failed'));
  });
}

export function replicaResumeSnapshot(meta) {
  return Object.fromEntries([...meta].map(([channelId, value]) => [channelId, numeric(value?.headSeq || value?.newestSeq)]));
}

// Durable cache belongs to the Replica boundary but never bypasses commit.
export function createChannelReplicaCache({ indexedDB = globalThis.indexedDB } = {}) {
  let owner = '';
  let ownerEpoch = 0;
  let dbPromise = openCache(indexedDB);
  let meta = new Map();
  const memoryForOwner = () => {
    if (!memoryCache.has(owner)) memoryCache.set(owner, { rows: new Map(), meta: new Map() });
    return memoryCache.get(owner);
  };

  async function ensureOwner(principalId, { world = '' } = {}) {
    const selectedOwner = `${String(principalId || '')}\u0000${String(world || '')}`;
    const epoch = ++ownerEpoch;
    owner = selectedOwner;
    meta = new Map();
    const db = await dbPromise;
    if (epoch !== ownerEpoch || selectedOwner !== owner) throw Object.assign(new Error('replica cache owner changed'), { code: 'cache_owner_changed' });
    if (!db) meta = new Map(memoryForOwner().meta);
    else {
      const entries = await requestResult(db.transaction('meta', 'readonly').objectStore('meta').getAll());
      if (epoch !== ownerEpoch || selectedOwner !== owner) throw Object.assign(new Error('replica cache owner changed'), { code: 'cache_owner_changed' });
      for (const entry of entries) if (entry.owner === selectedOwner) meta.set(entry.channelId, entry.value);
    }
    return { changed: false, boot: world, meta: new Map(meta) };
  }

  async function saveRows(rows, { coverage } = {}) {
    const operationOwner = owner;
    const epoch = ownerEpoch;
    const accepted = (rows || []).filter((row) => row?.channel_id && numeric(row?.seq));
    const touched = new Map();
    for (const row of accepted) {
      const channelId = row.channel_id;
      const seq = numeric(row.seq);
      const known = meta.get(channelId) || {};
      const current = touched.get(channelId) || { ...known, coverage: [...(known.coverage || [])] };
      current.headSeq = Math.max(numeric(current.headSeq), seq);
      current.newestSeq = Math.max(numeric(current.newestSeq), seq);
      current.oldestSeq = current.oldestSeq ? Math.min(numeric(current.oldestSeq), seq) : seq;
      current.rowCount = numeric(current.rowCount) + 1;
      current.coverage = mergeReplicaCoverage(current.coverage, { lowSeq: seq, highSeq: seq });
      touched.set(channelId, current);
    }
    if (coverage?.channelId) {
      const known = meta.get(coverage.channelId) || {};
      const current = touched.get(coverage.channelId) || { ...known, coverage: [...(known.coverage || [])] };
      current.coverage = mergeReplicaCoverage(current.coverage, coverage);
      touched.set(coverage.channelId, current);
    }
    if (!accepted.length && !touched.size) return 0;
    for (const [channelId, value] of touched) meta.set(channelId, value);
    const db = await dbPromise;
    if (epoch !== ownerEpoch || operationOwner !== owner) throw Object.assign(new Error('replica cache owner changed'), { code: 'cache_owner_changed' });
    if (!db) {
      const memory = memoryForOwner();
      for (const row of accepted) memory.rows.set(`${row.channel_id}\u0000${row.seq}`, structuredClone(row));
      memory.meta = new Map(meta);
      return accepted.length;
    }
    const transaction = db.transaction(['rows', 'meta'], 'readwrite');
    for (const row of accepted) transaction.objectStore('rows').put({ owner: operationOwner, channelId: row.channel_id, seq: numeric(row.seq), row });
    for (const [channelId, value] of touched) transaction.objectStore('meta').put({ owner: operationOwner, channelId, value });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('replica cache commit failed'));
    });
    return accepted.length;
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
    if (!db) {
      available = [...memoryForOwner().rows.values()]
        .filter((row) => row.channel_id === channelId && numeric(row.seq) < before)
        .sort((left, right) => numeric(right.seq) - numeric(left.seq));
    } else {
      const records = await requestResult(db.transaction('rows', 'readonly').objectStore('rows').getAll());
      available = records.filter((entry) => entry.owner === operationOwner && entry.channelId === channelId && entry.seq < before)
        .sort((left, right) => right.seq - left.seq).map((entry) => entry.row);
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
    return {
      rows: selected,
      nextBeforeSeq: selected.length ? numeric(selected[0].seq) : before,
      exhausted: available.length <= selected.length,
      bytes,
    };
  }

  async function clear() {
    const operationOwner = owner;
    const epoch = ownerEpoch;
    const db = await dbPromise;
    if (epoch !== ownerEpoch || operationOwner !== owner) throw Object.assign(new Error('replica cache owner changed'), { code: 'cache_owner_changed' });
    meta = new Map();
    memoryCache.delete(owner);
    if (!db) return;
    const keysByStore = new Map();
    for (const storeName of ['rows', 'meta']) {
      const keys = await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys());
      keysByStore.set(storeName, keys.filter((key) => key[0] === operationOwner));
    }
    const transaction = db.transaction(['rows', 'meta'], 'readwrite');
    for (const storeName of ['rows', 'meta']) {
      const store = transaction.objectStore(storeName);
      for (const key of keysByStore.get(storeName)) store.delete(key);
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('replica cache clear failed'));
    });
  }

  return Object.freeze({
    ensureOwner, saveRows, readBefore, clear,
    saveCoverage: (channelId, lowSeq, highSeq) => saveRows([], { coverage: { channelId, lowSeq, highSeq } }),
    metaSnapshot: () => new Map(meta),
    destroy: async () => { const db = await dbPromise; db?.close(); dbPromise = Promise.resolve(null); },
  });
}
