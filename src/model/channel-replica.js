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

function buildTurn(request, requestSeq, responses) {
  const provisional = [];
  let terminal = null;
  let terminalSeq = 0;
  let lastSeq = requestSeq;
  for (const response of responses || []) {
    lastSeq = Math.max(lastSeq, response.seq);
    if (FINAL.has(argsOf(response.envelope)?.status)) {
      if (response.seq >= terminalSeq) { terminal = response.envelope; terminalSeq = response.seq; }
    } else provisional.push({ seq: response.seq, envelope: response.envelope });
  }
  return {
    requestId: request.id, request, requestSeq, lastSeq, provisional, terminal, terminalSeq,
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
    if (envelope.id && record.state._envelopesById.has(envelope.id)) {
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
    const remove = [...record.state.rows.keys()].sort((a, b) => a - b).slice(0, record.state.rows.size - limit);
    for (const seq of remove) record.state.rows.delete(seq);
    rebuildState(record.state);
    record.materializedCoverage = [...record.state.rows.keys()].sort((a, b) => a - b)
      .reduce((all, seq) => mergeReplicaCoverage(all, { lowSeq: seq, highSeq: seq }), []);
    record.revision += 1;
    record.state._timelineRevision += 1;
    record.state._timelineProjectionVersion += 1;
    return remove.length;
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
