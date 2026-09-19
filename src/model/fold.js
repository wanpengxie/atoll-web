import { argsOf, correlationOf, FINAL, hasCanonicalBody, PROVISIONAL } from '../protocol/envelope.js';
import { isNarrationEnvelope, TYPES } from '../protocol/vocab.js';
import { createLiveArrivalState } from './live-arrivals.js';
import { terminalRetainedFields } from './terminal-result.js';

// subjectgate 只让这两个词走 resolve 帧（platform/internal/humancell）。
const RESOLVABLE = new Set([TYPES.humanAsk, TYPES.humanApprove]);
// 由客户端自己受理的词。刻意不进 approvals：那一栏是"等你回答的事"，
// 而这些不需要人参与，混进去就是给人看一堆他不该操心的待办。
const UI_WORDS = new Set([TYPES.uiState, TYPES.uiNavigate, TYPES.uiOpen]);
const BUSINESS_PROVISIONAL = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/;
const timelineCache = new WeakMap();
const TIMELINE_CHANGE_LIMIT = 1_024;

// The mutable replica may grow a processing turn in place without changing
// timeline membership. Publish that fact as a small semantic change stream so
// Presentation can detach a fresh immutable body for just the affected row.
// Structural membership and control state keep their own versions.
function recordTimelineChange(state, id, kind = 'content', subjectID = id) {
  state._timelineRevision += 1;
  state._timelineChangeLog.push({ revision: state._timelineRevision, id, kind, subjectID });
  if (state._timelineChangeLog.length <= TIMELINE_CHANGE_LIMIT) return;
  const removed = state._timelineChangeLog.splice(0, state._timelineChangeLog.length - TIMELINE_CHANGE_LIMIT);
  state._timelineChangeBase = Number(removed.at(-1)?.revision || state._timelineChangeBase || 0);
}

// Presentation owns one row per visible root turn. A child turn mutates in
// place inside that row's `thread`, so its semantic change must name the root
// row rather than the child request id (which is not a Presentation entity).
// Respect stable roots already exposed by orderedTimeline: late history may
// reveal a parent, but it must not silently move an existing row underneath it.
function timelineOwnerTurnID(state, turn) {
  const stableRoots = timelineCache.get(state)?.stableRoots;
  const seen = new Set();
  let current = turn;
  while (current?.requestId && !seen.has(current.requestId)) {
    seen.add(current.requestId);
    if (stableRoots?.has(current.requestId)) return current.requestId;
    const parentID = current.request?.parent_id;
    const parent = parentID && parentID !== current.requestId
      ? state.turns.get(parentID)
      : null;
    if (!parent) return current.requestId;
    current = parent;
  }
  return turn?.requestId || '';
}

export function createChannelState(channelId = '') {
  return {
    channelId,
    rows: new Map(),
    turns: new Map(), // request id → RequestTurn
    correlations: new Map(), // correlation id → request ids[]
    narration: [],
    approvals: new Map(),
    uiRequests: new Map(), // 发给我、仍开着的 ui.* 请求
    standalone: [],
    orphans: [],
    anomalies: [],
    lastSeq: 0,
    _seenIds: new Set(),
    _envelopesById: new Map(),
    _unmatchedByParent: new Map(),
    // A history suffix can deliver a terminal before its older request. The
    // mobile row window may discard the full unmatched envelope before that
    // request is paged in, so retain one compact, earliest terminal per parent
    // until the canonical turn can absorb it. This is closure provenance, not
    // a second lifecycle projection.
    _unmatchedTerminalClosures: new Map(),
    // Map 没有“从上次迭代结束处继续”的可复用游标。保留一条只增的 seq
    // 日志，让上层派生索引只消费新行；真正的信封仍只在 rows 里。
    _rowOrder: [],
    // rowOrder 每个位置之前出现过的最大 seq。历史页会在 live tail 之后才插入，
    // 因而不能见到一条旧 seq 就停止倒扫；prefix max 让未读投影仍能在越过
    // 当前 read cursor 后立刻停止，而不是每帧遍历整本账。
    _rowMaxSeq: [],
    // Timeline 的成员集合/可见性只在结构或阶段变化时重投影。流式正文在 turn
    // 对象上原地增长，恒不需要为同一条 processing 帧重扫整本账。
    _timelineProjectionVersion: 0,
    _timelineControlVersion: 0,
    _timelineRevision: 0,
    _timelineChangeBase: 0,
    _timelineChangeLog: [],
    ...createLiveArrivalState(),
    _requestVersion: 0,
    _terminalVersion: 0,
  };
}

function newTurn(request, seq) {
  const correlationId = correlationOf(request);
  return {
    requestId: request.id,
    correlation: correlationId,
    correlationId,
    request,
    requestSeq: seq,
    provisional: [],
    terminal: null,
    terminalSeq: 0,
    // A compact terminal retained by the memory window is sufficient to
    // prove that this request is closed, but it is not the terminal's content
    // envelope.  Keep that provenance on the turn so a later reread of the
    // exact ledger row can restore the full body instead of being rejected as
    // a second terminal.
    terminalClosureOnly: false,
    phase: 'open',
    status: 'open',
    latestStatus: '',
    text: '',
    lastSeq: seq,
    anomalies: [],
    _controlSignature: '',
    _projectionParticipants: new Set([
      request?.sender?.id,
      ...(Array.isArray(request?.audience) ? request.audience : []),
    ].filter(Boolean)),
  };
}

// Timeline 的控制投影只依赖 status 帧里的这一小组事实。正文 delta 可以很大、
// 很频繁，却不会改变按钮、等待区位置或 work 状态；把整帧当缓存键等于重新引入
// 每个 token 都全量扫描 turns 的问题。
function responseControlSignature(envelope) {
  const payload = argsOf(envelope);
  if (payload?.status !== 'queued' && payload?.status !== 'processing') return '';
  return JSON.stringify({
    status: payload.status,
    controls: Array.isArray(payload.controls) ? payload.controls : [],
    turn_id: payload.turn_id || '',
    resumed: payload.resumed === true,
    steering: payload.steering === true,
    work_id: payload.work_id || '',
    work_state: payload.work_state || payload.state || '',
    stage: payload.stage || '',
    execution_state: payload.execution_state || '',
  });
}

function responseChangesControl(turn, envelope) {
  if (FINAL.has(argsOf(envelope)?.status)) return true;
  const signature = responseControlSignature(envelope);
  if (!signature) return false;
  const changed = signature !== turn._controlSignature;
  turn._controlSignature = signature;
  return changed;
}

function responseChangesProjection(turn, envelope) {
  const status = argsOf(envelope)?.status;
  if (FINAL.has(status) || turn.provisional.length === 0 || turn.latestStatus !== status) return true;
  const participants = turn._projectionParticipants;
  if (!participants) return true;
  const ids = [envelope?.sender?.id, ...(Array.isArray(envelope?.audience) ? envelope.audience : [])].filter(Boolean);
  return ids.some((id) => !participants.has(id));
}

function rememberProjectionParticipants(turn, envelope) {
  if (!turn._projectionParticipants) turn._projectionParticipants = new Set();
  if (envelope?.sender?.id) turn._projectionParticipants.add(envelope.sender.id);
  for (const id of envelope?.audience || []) if (id) turn._projectionParticipants.add(id);
}

function anomaly(state, code, seq, envelope, turn = null) {
  const value = { code, seq, envelopeId: envelope?.id || '', requestId: turn?.requestId || envelope?.parent_id || '' };
  state.anomalies.push(value);
  turn?.anomalies.push(value);
}

function sameEnvelope(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function pushMap(map, key, item) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(item);
  map.set(key, values);
}

function compactTerminalClosure(envelope) {
  const payload = argsOf(envelope);
  const retained = terminalRetainedFields(payload);
  return {
    id: envelope.id || '',
    parent_id: envelope.parent_id || '',
    correlation_id: envelope.correlation_id || '',
    kind: 'response',
    type: envelope.type || '',
    ts: envelope.ts,
    sender: envelope.sender,
    audience: envelope.audience,
    visibility: envelope.visibility,
    payload: {
      status: payload.status,
      ...retained,
    },
  };
}

export function retainTerminalClosure(state, seq, envelope) {
  const parentId = envelope?.parent_id || '';
  if (!parentId || !FINAL.has(argsOf(envelope)?.status)) return;
  // This exact parent-id proof is deliberately retained until the request row
  // is re-materialized and drainRequestMatches absorbs it. Do not replace it
  // with an evicted-seq range or a lossy bounded cache: history can be sparse,
  // so a range hit cannot prove that an unseen request in one of its holes is
  // terminal. A safe hard memory bound needs a persisted/queryable terminal
  // index at the Replica owner boundary; dropping identities here would either
  // resurrect completed work or hide genuinely queued work.
  const current = state._unmatchedTerminalClosures.get(parentId);
  // Duplicate rereads are idempotent. Conflicting terminals obey ledger order
  // even when a newer suffix was observed before the earlier page.
  if (current && current.seq <= seq) return;
  state._unmatchedTerminalClosures.set(parentId, {
    seq,
    closureOnly: true,
    envelope: compactTerminalClosure(envelope),
  });
}

// The Replica's answer to "has this request already closed?" for callers that
// only hold a request id — Waiting being the one that matters. A request whose
// turn the memory window evicted is still closed, and answering from the
// canonical replica is what keeps Waiting a stateless derivation instead of a
// second lifecycle.
export function requestClosure(state, requestId) {
  const id = String(requestId || '');
  if (!id) return null;
  const turn = state?.turns?.get?.(id);
  if (turn?.terminal) return {
    seq: turn.terminalSeq || 0,
    envelope: turn.terminal,
    source: turn.terminalClosureOnly ? 'closure' : 'turn',
  };
  const closure = state?._unmatchedTerminalClosures?.get?.(id);
  if (closure) return { seq: closure.seq, envelope: closure.envelope, source: 'closure' };
  return null;
}

export function isRequestClosed(state, requestId) {
  return requestClosure(state, requestId) !== null;
}

function findTurn(state, envelope) {
  if (!envelope.parent_id) return null;
  return state.turns.get(envelope.parent_id) || null;
}

function businessFields(payload = {}) {
  const { status: _status, ...rest } = payload || {};
  return rest;
}

function terminalText(payload = {}) {
  if (Object.prototype.hasOwnProperty.call(payload, 'text')) return String(payload.text ?? '');
  if (payload.status === 'failed') return [payload.reason, payload.error_code, payload.detail].filter(Boolean).join(': ');
  return '';
}

function applyProvisional(state, turn, seq, envelope) {
  if (turn.terminal) {
    anomaly(state, 'provisional_after_terminal', seq, envelope, turn);
    return;
  }
  const status = argsOf(envelope)?.status;
  const core = PROVISIONAL.has(status);
  const business = typeof status === 'string' && BUSINESS_PROVISIONAL.test(status) && !FINAL.has(status);
  if (!core && !business) {
    anomaly(state, 'unknown_response_status', seq, envelope, turn);
    state.orphans.push({ seq, envelope });
    return;
  }
  const process = argsOf(envelope)?.process;
  if (process?.kind === 'tool' && process.phase === 'ended' && process.tool_call_id) {
    const started = turn.provisional.some((item) => {
      const candidate = argsOf(item.envelope)?.process;
      return candidate?.kind === 'tool' && candidate.phase === 'started' && candidate.tool_call_id === process.tool_call_id;
    });
    if (!started) anomaly(state, 'tool_start_missing', seq, envelope, turn);
  }
  turn.provisional.push({ seq, envelope, status, core });
  turn.latestStatus = status;
  turn.lastSeq = Math.max(turn.lastSeq, seq);
  turn.phase = core ? status : 'business_provisional';
  turn.status = turn.phase;
}

function sameTerminalLedgerFact(turn, seq, envelope) {
  if (Number(turn.terminalSeq) !== Number(seq)) return false;
  // A closure deliberately forgot only the large terminal body.  Every fact
  // it did retain (identity, provenance, routing and final status) must still
  // agree before a full envelope may upgrade it.  Once full content exists,
  // idempotence requires exact envelope equality.
  return turn.terminalClosureOnly
    ? sameEnvelope(turn.terminal, compactTerminalClosure(envelope))
    : sameEnvelope(turn.terminal, envelope);
}

function applyTerminal(state, turn, seq, envelope, { closureOnly = false } = {}) {
  if (turn.terminal) {
    if (sameTerminalLedgerFact(turn, seq, envelope)) {
      if (turn.terminalClosureOnly && !closureOnly) {
        // The compact closure carried lifecycle evidence only.  Re-reading
        // the exact row upgrades it to the full immutable content fact.
        turn.terminal = envelope;
        turn.terminalClosureOnly = false;
        turn.text = terminalText(argsOf(envelope));
      }
      // The same full row (or the same compact proof) is idempotent.
      return;
    }
    if (turn.terminalClosureOnly && !closureOnly && seq < turn.terminalSeq) {
      // The closure can be absorbed before an older history page arrives.
      // Preserve the same earliest-ledger-terminal rule used while responses
      // are still unmatched: the older full fact becomes canonical, while the
      // displaced compact terminal remains visible as a protocol conflict.
      anomaly(state, 'terminal_conflict', turn.terminalSeq, turn.terminal, turn);
      turn.terminal = envelope;
      turn.terminalSeq = seq;
      turn.terminalClosureOnly = false;
      turn.phase = argsOf(envelope).status;
      turn.status = turn.phase;
      turn.latestStatus = argsOf(envelope).status;
      turn.text = terminalText(argsOf(envelope));
      if (envelope.parent_id) { state.approvals.delete(envelope.parent_id); state.uiRequests.delete(envelope.parent_id); }
      return;
    }
    anomaly(state, 'terminal_conflict', seq, envelope, turn);
    return;
  }
  turn.terminal = envelope;
  turn.terminalSeq = seq;
  turn.terminalClosureOnly = closureOnly;
  turn.phase = argsOf(envelope).status;
  turn.status = turn.phase;
  turn.latestStatus = argsOf(envelope).status;
  turn.text = terminalText(argsOf(envelope));
  turn.lastSeq = Math.max(turn.lastSeq, seq);
  if (envelope.parent_id) { state.approvals.delete(envelope.parent_id); state.uiRequests.delete(envelope.parent_id); }
}

function attachResponse(state, turn, seq, envelope, options) {
  // Every response routed to this turn belongs to the semantic row's ledger
  // range even when it is an invalid late provisional or a conflicting second
  // terminal. The accepted terminal/content remain unchanged, but a reader at
  // the visible row tail must be able to advance the read cursor past that
  // installed fact instead of leaving an unread badge that no row can clear.
  turn.lastSeq = Math.max(turn.lastSeq, seq);
  if (FINAL.has(argsOf(envelope)?.status)) applyTerminal(state, turn, seq, envelope, options);
  else applyProvisional(state, turn, seq, envelope);
}

function drainRequestMatches(state, turn) {
  const byParent = state._unmatchedByParent.get(turn.requestId) || [];
  const closure = state._unmatchedTerminalClosures.get(turn.requestId);
  state._unmatchedByParent.delete(turn.requestId);
  state._unmatchedTerminalClosures.delete(turn.requestId);
  if (closure && !byParent.some((item) => (
    item.seq === closure.seq && item.envelope?.id === closure.envelope?.id
  ))) byParent.push(closure);
  for (const item of byParent.sort((left, right) => left.seq - right.seq)) {
    attachResponse(state, turn, item.seq, item.envelope, { closureOnly: item.closureOnly === true });
  }
}

export function apply(state, row, selfId = '') {
  const { channel_id: channelId, seq: rawSeq, envelope } = row || {};
  const seq = Number(rawSeq);
  if (!state || !envelope || !Number.isSafeInteger(seq) || seq < 0) return state;
  state.lastSeq = Math.max(state.lastSeq, seq);
  if (state.channelId && channelId && state.channelId !== channelId) {
    anomaly(state, 'channel_mismatch', seq, envelope);
    return state;
  }
  if (envelope.id && state._seenIds.has(envelope.id)) {
    if (!sameEnvelope(state._envelopesById.get(envelope.id), envelope)) anomaly(state, 'message_id_content_conflict', seq, envelope);
    else anomaly(state, 'duplicate_envelope_id', seq, envelope);
    return state;
  }
  if (envelope.id) {
    state._seenIds.add(envelope.id);
    state._envelopesById.set(envelope.id, envelope);
  }
  state.rows.set(seq, envelope);
  state._rowOrder?.push(seq);
  state._rowMaxSeq?.push(Math.max(seq, state._rowMaxSeq.at(-1) || 0));

  // Pre-canonical development rows remain part of raw ledger continuity but
  // do not enter any business projection. They are neither errors nor UI
  // records and cannot create empty cards, turns, or notifications.
  if (!hasCanonicalBody(envelope)) return state;

  if (isNarrationEnvelope(envelope)) {
    state.narration.push({ seq, envelope });
    state._timelineProjectionVersion += 1;
    recordTimelineChange(state, envelope.id || `narration:${seq}`, 'structure');
    return state;
  }

  if (envelope.kind === 'request') {
    if (!envelope.id) {
      anomaly(state, 'request_id_missing', seq, envelope);
      state.orphans.push({ seq, envelope });
      return state;
    }
    // Re-admitting a request row is not a new turn. The memory window drops
    // evicted envelope ids from `_seenIds`, so a history page can legitimately
    // deliver a request whose turn is still folded — with its progress frames
    // and its terminal. Replacing that turn would make an already answered
    // task queued again, which is finality going backwards. The canonical turn
    // keeps every fact it already absorbed; only the request envelope and its
    // ledger position are refreshed.
    const existing = state.turns.get(envelope.id);
    const turn = existing || newTurn(envelope, seq);
    if (existing) {
      existing.request = envelope;
      existing.requestSeq = seq;
      existing.lastSeq = Math.max(existing.lastSeq || 0, seq);
      rememberProjectionParticipants(existing, envelope);
    } else state.turns.set(envelope.id, turn);
    const correlationRequests = state.correlations.get(turn.correlationId) || [];
    correlationRequests.push(envelope.id);
    state.correlations.set(turn.correlationId, correlationRequests);
    if (RESOLVABLE.has(envelope.type) && selfId && envelope.audience?.includes(selfId)) {
      state.approvals.set(envelope.id, envelope);
    }
    if (UI_WORDS.has(envelope.type) && selfId && envelope.audience?.includes(selfId)) {
      state.uiRequests.set(envelope.id, envelope);
    }
    drainRequestMatches(state, turn);
    state._timelineProjectionVersion += 1;
    state._timelineControlVersion += 1;
    state._requestVersion += 1;
    recordTimelineChange(state, timelineOwnerTurnID(state, turn), 'structure', turn.requestId);
    return state;
  }

  if (envelope.kind === 'response') {
    const turn = findTurn(state, envelope);
    if (turn) {
      const changesProjection = responseChangesProjection(turn, envelope);
      const changesControl = responseChangesControl(turn, envelope);
      attachResponse(state, turn, seq, envelope);
      rememberProjectionParticipants(turn, envelope);
      recordTimelineChange(
        state,
        timelineOwnerTurnID(state, turn),
        changesProjection ? 'structure' : 'content',
        turn.requestId,
      );
      if (changesProjection) state._timelineProjectionVersion += 1;
      if (changesControl) state._timelineControlVersion += 1;
      if (turn.terminal === envelope) state._terminalVersion += 1;
    }
    else if (envelope.parent_id) {
      pushMap(state._unmatchedByParent, envelope.parent_id, { seq, envelope });
      retainTerminalClosure(state, seq, envelope);
    }
    else {
      anomaly(state, 'response_parent_missing', seq, envelope);
      state.orphans.push({ seq, envelope });
      state._timelineProjectionVersion += 1;
      recordTimelineChange(state, envelope.id || `orphan:${seq}`, 'structure');
    }
    return state;
  }

  state.standalone.push({ seq, envelope });
  state._timelineProjectionVersion += 1;
  recordTimelineChange(state, envelope.id || `standalone:${seq}`, 'structure');
  if (envelope.type === TYPES.agentHoldExpired) {
    state._timelineControlVersion += 1;
  }
  return state;
}

export function reconcileApprovals(state, selfId) {
  state.approvals.clear();
  state.uiRequests.clear();
  if (!selfId) return state;
  for (const turn of state.turns.values()) {
    const request = turn.request;
    if (
      RESOLVABLE.has(request.type)
      && request.audience?.includes(selfId)
      && !turn.terminal
    ) state.approvals.set(request.id, request);
    if (UI_WORDS.has(request.type) && request.audience?.includes(selfId) && !turn.terminal) {
      state.uiRequests.set(request.id, request);
    }
  }
  return state;
}

export function fold(rows, selfId = '') {
  const state = createChannelState(rows[0]?.channel_id || '');
  for (const row of rows) apply(state, row, selfId);
  return state;
}

// 一个 agent 在回合中调用别的 actor，发出的是它自己的 request，`parent_id` 指着
// 那条把它叫起来的请求。所以账本本来就是棵树，只是过去被摊平成同一层：人问的一句
// 和 agent 顺手查的六次成员列表挤在一起，读的人分不出哪句是主线。
//
// 这里按 parent_id 把树收回来：只有根请求进时间线，被叫出来的那些挂在它的 thread 上
// （深度优先、按账本序号，孙代也在同一条 thread 里，带 depth 供缩进）。判据用
// parent_id 而不是 correlation_id —— 同一个 correlation 里的请求是平级还是父子，
// 只有 parent_id 说得清。
function threadOf(turn, childrenByParent, depth = 1, out = []) {
  for (const child of childrenByParent.get(turn.requestId) || []) {
    out.push({ turn: child, depth });
    threadOf(child, childrenByParent, depth + 1, out);
  }
  return out;
}

export function orderedTimeline(state) {
  const signature = `${state.turns.size}:${state.standalone.length}:${state.orphans.length}`;
  const cached = timelineCache.get(state);
  if (cached?.signature === signature) return cached.entries;

  // 最常见的结构变化是 live event 落在账尾。它没有改变请求树，且 seq 比现有
  // 时间线都大时，直接追加即可；旧实现会为这一条 event 重建、重排整棵时间线。
  // 历史 prepend、孤儿补齐和新 request 仍走下面的完整构造。
  if (cached
    && cached.turnCount === state.turns.size
    && cached.standaloneCount <= state.standalone.length
    && cached.orphanCount <= state.orphans.length) {
    const additions = [
      ...state.standalone.slice(cached.standaloneCount).map((item) => ({ kind: 'standalone', ...item })),
      ...state.orphans.slice(cached.orphanCount).map((item) => ({ kind: 'orphan', ...item })),
    ].sort((left, right) => left.seq - right.seq);
    const expected = (state.standalone.length - cached.standaloneCount) + (state.orphans.length - cached.orphanCount);
    if (additions.length === expected && additions.every((entry) => entry.seq > cached.lastEntrySeq)) {
      const entries = [...cached.entries, ...additions];
      timelineCache.set(state, {
        signature,
        entries,
        stableRoots: cached.stableRoots || new Set(),
        turnCount: state.turns.size,
        standaloneCount: state.standalone.length,
        orphanCount: state.orphans.length,
        lastEntrySeq: entries.at(-1)?.seq || 0,
      });
      return entries;
    }
  }

  const childrenByParent = new Map();
  const roots = [];
  // A request whose parent was not available when it first entered the
  // presentation is a stable root for this projector cache. Keep that visual
  // history out of the channel replica: the ledger still retains parent_id,
  // while pagination cannot turn a prepend into remove+reparent.
  const stableRoots = cached?.stableRoots || new Set();
  for (const turn of state.turns.values()) {
    const parentId = turn.request?.parent_id;
    const parentAvailable = parentId && parentId !== turn.requestId && state.turns.has(parentId);
    if (!parentAvailable) stableRoots.add(turn.requestId);
    // Presentation topology is monotonic. Once a request was exposed as a
    // root, an older history page is not allowed to move it under its parent.
    // The relationship remains available on request.parent_id for detail and
    // diagnostics; only the visual ownership is frozen.
    if (parentAvailable && !stableRoots.has(turn.requestId)) {
      pushMap(childrenByParent, parentId, turn);
    } else roots.push(turn);
  }
  for (const values of childrenByParent.values()) values.sort((left, right) => left.requestSeq - right.requestSeq);

  const entries = [];
  for (const turn of roots) entries.push({ kind: 'turn', seq: turn.requestSeq, turn, thread: threadOf(turn, childrenByParent) });
  for (const item of state.standalone) entries.push({ kind: 'standalone', ...item });
  for (const item of state.orphans) entries.push({ kind: 'orphan', ...item });
  entries.sort((left, right) => left.seq - right.seq);
  timelineCache.set(state, {
    signature,
    entries,
    stableRoots,
    turnCount: state.turns.size,
    standaloneCount: state.standalone.length,
    orphanCount: state.orphans.length,
    lastEntrySeq: entries.at(-1)?.seq || 0,
  });
  return entries;
}

export function structuredBusinessPayload(payload = {}) {
  return businessFields(payload);
}
