import { argsOf } from '../protocol/envelope.js';
import { requestExpired } from './conversation-visibility.js';

// Where one request to an agent stands, as a pure function of ledger rows.
// Waiting and the timeline both read this; neither decides on its own.
//
//   closed      a terminal response exists
//   lost        the receiver restarted after the request's last frame, or the
//               request expired — the ledger will never carry another frame
//               for it, so it is neither waiting nor running
//   waiting     the receiver's latest core status is queued/received/deferred
//   processing  the receiver's latest core status is processing
//   pending     on the ledger but no lifecycle status yet
//
// A restart keeps the actor id and the restarted process does not take over
// the previous queue, and the node writes no terminal for it. Every request
// that was open at the restart and has no frame after it is therefore lost.
// Loaded history is a contiguous tail, so a loaded request always has every
// later frame and every later restart loaded with it.
export const LIFECYCLE = Object.freeze({
  closed: 'closed',
  lost: 'lost',
  waiting: 'waiting',
  processing: 'processing',
  pending: 'pending',
});

const WAITING_STATUSES = new Set(['queued', 'received', 'deferred']);
const restartCache = new WeakMap();

function completed(turn) {
  return argsOf(turn?.terminal)?.status === 'completed';
}

function allTurns(state) {
  const turns = [];
  const visit = (entry) => {
    if (entry?.kind === 'turn' && entry.turn) turns.push(entry.turn);
    for (const child of entry?.thread || []) visit(child);
  };
  for (const entry of state?.timeline || []) visit(entry);
  return turns;
}

// actor id -> seq of the latest completed restart of that member.
export function memberRestarts(state) {
  const revision = state?._timelineRevision ?? state?.lastSeq;
  const cached = state && typeof state === 'object' ? restartCache.get(state) : null;
  if (cached && cached.revision === revision && cached.timeline === state.timeline) return cached.restarts;
  const restarts = new Map();
  const note = (member, seq) => {
    const id = String(member || '');
    if (!id || !(seq > 0)) return;
    restarts.set(id, Math.max(restarts.get(id) || 0, seq));
  };
  for (const turn of allTurns(state)) {
    const type = turn.request?.type;
    if (type !== 'system.member.restart' && type !== 'system.member.restart_all') continue;
    if (!completed(turn)) continue;
    const seq = Number(turn.terminalSeq || 0);
    if (type === 'system.member.restart') {
      note(argsOf(turn.request)?.member || argsOf(turn.terminal)?.member, seq);
    } else {
      for (const member of argsOf(turn.terminal)?.restarted || []) note(member, seq);
    }
  }
  if (state && typeof state === 'object') restartCache.set(state, { revision, timeline: state.timeline, restarts });
  return restarts;
}

function lastFrameSeq(turn) {
  let seq = Number(turn?.requestSeq || 0);
  for (const item of turn?.provisional || []) seq = Math.max(seq, Number(item?.seq || 0));
  return seq;
}

function latestCoreStatus(turn) {
  return [...(turn?.provisional || [])]
    .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
    .map((item) => String(argsOf(item?.envelope)?.status || item?.status || ''))
    .filter(Boolean)
    .at(-1) || '';
}

export function requestLifecycle(turn, restarts = new Map(), now = Date.now()) {
  if (!turn) return LIFECYCLE.pending;
  if (turn.terminal) return LIFECYCLE.closed;
  if (Number(turn.requestSeq || 0) > 0) {
    const receiver = String(turn.request?.audience?.[0] || '');
    const restartSeq = restarts.get(receiver) || 0;
    if (restartSeq > lastFrameSeq(turn)) return LIFECYCLE.lost;
  }
  if (requestExpired(turn.request, now)) return LIFECYCLE.lost;
  const status = latestCoreStatus(turn);
  if (status === 'processing') return LIFECYCLE.processing;
  if (WAITING_STATUSES.has(status)) return LIFECYCLE.waiting;
  return LIFECYCLE.pending;
}

export function lostReason(turn, restarts = new Map(), now = Date.now()) {
  if (requestLifecycle(turn, restarts, now) !== LIFECYCLE.lost) return '';
  const receiver = String(turn.request?.audience?.[0] || '');
  return (restarts.get(receiver) || 0) > lastFrameSeq(turn) ? 'restart' : 'expired';
}
