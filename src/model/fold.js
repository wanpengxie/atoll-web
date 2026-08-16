import { correlationOf, FINAL, PROVISIONAL } from '../protocol/envelope.js';
import { isActivity, isSystemNarration, TYPES } from '../protocol/vocab.js';

export function createChannelState(channelId = '') {
  return {
    channelId,
    rows: new Map(),
    turns: new Map(),
    narration: [],
    approvals: new Map(),
    standalone: [],
    orphans: [],
    lastSeq: 0,
    _seenIds: new Set(),
    _requestTurns: new Map(),
  };
}

function newTurn(correlation, request, seq) {
  return {
    correlation,
    request,
    requestSeq: seq,
    provisional: [],
    activity: [],
    final: null,
    status: 'open',
    text: '',
    lastSeq: seq,
  };
}

function failedText(payload = {}) {
  return [payload.reason, payload.detail].filter(Boolean).join(': ');
}

function findTurn(state, envelope) {
  if (envelope.parent_id && state._requestTurns.has(envelope.parent_id)) {
    return state.turns.get(state._requestTurns.get(envelope.parent_id));
  }
  const correlation = envelope.correlation_id || '';
  return correlation ? state.turns.get(correlation) : null;
}

export function apply(state, row, selfId = '') {
  const { channel_id: channelId, seq: rawSeq, envelope } = row || {};
  const seq = Number(rawSeq);
  if (!state || !envelope || !Number.isFinite(seq)) return state;
  state.lastSeq = Math.max(state.lastSeq, seq);
  if (envelope.id && state._seenIds.has(envelope.id)) return state;
  if (envelope.id) state._seenIds.add(envelope.id);
  state.rows.set(seq, envelope);

  if (isActivity(envelope.type) && envelope.kind === 'event') {
    const turn = envelope.correlation_id ? state.turns.get(envelope.correlation_id) : null;
    if (turn) {
      turn.activity.push(envelope);
      turn.lastSeq = Math.max(turn.lastSeq, seq);
    } else {
      state.narration.push({ seq, envelope });
    }
    return state;
  }

  if (isSystemNarration(envelope.type) || envelope.visibility === 'system') {
    state.narration.push({ seq, envelope });
    return state;
  }

  if (envelope.kind === 'request') {
    const correlation = correlationOf(envelope);
    const turn = newTurn(correlation, envelope, seq);
    state.turns.set(correlation, turn);
    if (envelope.id) state._requestTurns.set(envelope.id, correlation);
    if (envelope.type === TYPES.humanApprove && selfId && envelope.audience?.includes(selfId)) {
      state.approvals.set(envelope.id, envelope);
    }
    return state;
  }

  if (envelope.kind === 'response') {
    const turn = findTurn(state, envelope);
    const status = envelope.payload?.status;
    if (!turn) {
      state.orphans.push({ seq, envelope });
    } else if (PROVISIONAL.has(status)) {
      turn.provisional.push(envelope);
      turn.status = 'processing';
      turn.lastSeq = Math.max(turn.lastSeq, seq);
    } else if (FINAL.has(status)) {
      turn.final = envelope;
      turn.status = status;
      turn.text = status === 'failed'
        ? failedText(envelope.payload)
        : (envelope.payload?.text ?? '');
      turn.lastSeq = Math.max(turn.lastSeq, seq);
    } else {
      state.orphans.push({ seq, envelope });
    }
    if (FINAL.has(status) && envelope.parent_id) {
      state.approvals.delete(envelope.parent_id);
    }
    return state;
  }

  state.standalone.push({ seq, envelope });
  return state;
}

export function reconcileApprovals(state, selfId) {
  state.approvals.clear();
  if (!selfId) return state;
  const closed = new Set();
  for (const envelope of state.rows.values()) {
    if (envelope.kind === 'response' && FINAL.has(envelope.payload?.status) && envelope.parent_id) {
      closed.add(envelope.parent_id);
    }
  }
  for (const envelope of state.rows.values()) {
    if (
      envelope.kind === 'request'
      && envelope.type === TYPES.humanApprove
      && envelope.audience?.includes(selfId)
      && !closed.has(envelope.id)
    ) {
      state.approvals.set(envelope.id, envelope);
    }
  }
  return state;
}

export function fold(rows, selfId = '') {
  const state = createChannelState(rows[0]?.channel_id || '');
  for (const row of rows) apply(state, row, selfId);
  return state;
}

export function orderedTimeline(state) {
  const entries = [];
  for (const turn of state.turns.values()) entries.push({ kind: 'turn', seq: turn.requestSeq, turn });
  for (const item of state.standalone) entries.push({ kind: 'standalone', ...item });
  for (const item of state.orphans) entries.push({ kind: 'orphan', ...item });
  return entries.sort((left, right) => left.seq - right.seq);
}
