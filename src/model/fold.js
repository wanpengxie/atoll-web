import { argsOf, correlationOf, FINAL, PROVISIONAL } from '../protocol/envelope.js';
import { isNarrationEnvelope, TYPES } from '../protocol/vocab.js';
import { isViewportNotifiableDisposition, notificationDisposition } from './notification-policy.js';
import { isSelfActor, relatedEnvelopeIdsIncremental } from './timeline-scope.js';

// subjectgate 只让这两个词走 resolve 帧（platform/internal/humancell）。
const RESOLVABLE = new Set([TYPES.humanAsk, TYPES.humanApprove]);
// 由客户端自己受理的词。刻意不进 approvals：那一栏是"等你回答的事"，
// 而这些不需要人参与，混进去就是给人看一堆他不该操心的待办。
const UI_WORDS = new Set([TYPES.uiState, TYPES.uiNavigate, TYPES.uiOpen]);
const BUSINESS_PROVISIONAL = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*$/;
const timelineCache = new WeakMap();
const TIMELINE_CHANGE_LIMIT = 1_024;
const LIVE_ARRIVAL_LIMIT = 1_024;
const LIVE_PRESENTATION_ARRIVAL_LIMIT = 1_024;

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
    // Only the live transport may append to this semantic arrival
    // journal. Cache/history hydration can change Presentation membership, but
    // it cannot manufacture a "new dynamic" notification. Consumers join the
    // stable row id against their current visible projection.
    _liveArrivalRevision: 0,
    _liveArrivalAckRevision: 0,
    _liveArrivalLog: [],
    _liveArrivalConsumers: 0,
    _liveArrivalConsumerTokens: new Set(),
    // The hot journal has a fixed budget. If a synchronous feed batch outruns
    // React consumption, retain one exact record per not-yet-acknowledged
    // stable identity instead of silently dropping the notification or
    // growing a second unbounded row log.
    _liveArrivalOverflow: new Map(),
    // Ephemeral paint provenance for a currently mounted Timeline. This is
    // deliberately separate from notification/read truth above: it carries no
    // payload or status, is never persisted, and only says which stable row
    // identities were accepted from the live transport while a visual consumer
    // existed. Presentation still decides whether any identity became a new row.
    _livePresentationArrivalRevision: 0,
    _livePresentationArrivalAckRevision: 0,
    _livePresentationArrivalLog: [],
    _livePresentationArrivalConsumerTokens: new Set(),
    _requestVersion: 0,
    _terminalVersion: 0,
  };
}

function rootTurnID(state, envelope) {
  let id = envelope?.kind === 'request'
    ? envelope.id
    : envelope?.parent_id || envelope?.correlation_id || '';
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const turn = state?.turns?.get?.(id);
    const parent = turn?.request?.parent_id;
    if (!parent || !state?.turns?.has?.(parent)) break;
    id = parent;
  }
  const unresolvedParent = state?.turns?.get?.(id)?.request?.parent_id;
  if (unresolvedParent && !state?.turns?.has?.(unresolvedParent)) {
    return state.turns.get(id)?.request?.correlation_id
      || envelope?.correlation_id
      || unresolvedParent;
  }
  if (!state?.turns?.has?.(id) && envelope?.correlation_id) return envelope.correlation_id;
  return id;
}

// Arrival provenance belongs to the Replica commit seam, not to Presentation.
// The caller invokes this after an accepted fact newly materializes the current
// tail, whether supplied live or by reconnect tail recovery. Deeper backfill
// never enters this journal. Queued and processing/progress mutate an existing
// turn and are deliberately not new dynamics. Terminal responses reuse the
// root's stable presentation identity; independently readable standalone
// events retain their own identity.
export function recordLiveTimelineArrival(state, envelope, seq, selfId = '') {
  if (!state || !envelope) return null;
  // Viewport notices are a personal attention surface, even while the ledger
  // itself is projected as "all". With no established viewer identity, or
  // for any incarnation of that viewer's own echo, there is no eligible
  // arrival to advertise.
  if (!selfId || isSelfActor(envelope.sender?.id, selfId)) return null;
  const disposition = notificationDisposition(state, envelope, selfId);
  let rowID = '';
  let key = '';
  if (disposition === 'request') {
    key = rootTurnID(state, envelope);
    rowID = state.turns?.has?.(key) ? key : envelope.id || key;
  }
  else if (disposition === 'final') {
    key = rootTurnID(state, envelope);
    // A live terminal can precede its historical request. Until hydration
    // supplies that root, Presentation exposes the orphan by envelope id; use
    // that visible row while retaining the root as the notification identity.
    rowID = state.turns?.has?.(key) ? key : envelope.id || key;
  } else if (disposition === 'event') {
    rowID = envelope.id || '';
    key = rowID;
  }
  if (!isViewportNotifiableDisposition(disposition)) return null;
  if (!rowID) return null;
  // The feed calls this seam after Replica has accepted the row, so the same
  // incremental relation index that powers @me can decide eligibility here.
  // Keep unrelated rows in the all-ledger projection and in raw unread truth;
  // merely decline to turn them into a personal "new dynamics" notice.
  const related = relatedEnvelopeIdsIncremental(state, selfId);
  if (!related.has(envelope.id) && !related.has(key) && !related.has(rowID)) return null;
  const previousRevision = Number(state._liveArrivalRevision || 0);
  const hadUndisposedArrival = Number(state._liveArrivalAckRevision || 0) < previousRevision;
  const revision = previousRevision + 1;
  const event = Object.freeze({
    revision,
    key: String(key || rowID),
    rowID: String(rowID),
    seq: Math.max(0, Number(seq) || 0),
  });
  state._liveArrivalRevision = revision;
  state._liveArrivalLog.push(event);
  if (state._liveArrivalLog.length > LIVE_ARRIVAL_LIMIT) {
    const removed = state._liveArrivalLog.splice(0, state._liveArrivalLog.length - LIVE_ARRIVAL_LIMIT);
    for (const item of removed) {
      if (item.revision <= Number(state._liveArrivalAckRevision || 0)) continue;
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
  // A channel that had no viewport delivery in flight delegates new arrivals
  // to the durable rail/read-cursor path and needs no second queue. Once a
  // mounted viewport has accepted an arrival but not durably disposed it,
  // however, temporarily having zero consumers (filter/channel activation
  // replacement) must preserve that backlog for the successor. A later
  // background arrival must not accidentally acknowledge the older handoff.
  if (Number(state._liveArrivalConsumers || 0) === 0 && !hadUndisposedArrival) {
    acknowledgeLiveTimelineArrivals(state, revision);
  }
  return event;
}

// Return an immutable render snapshot. Overflow identities are only the
// unacknowledged prefix displaced from the fixed hot journal.
export function liveTimelineArrivals(state) {
  const overflow = [...(state?._liveArrivalOverflow?.values?.() || [])];
  const hot = [...(state?._liveArrivalLog || [])];
  return Object.freeze({
    revision: Number(state?._liveArrivalRevision || 0),
    acknowledgedRevision: Number(state?._liveArrivalAckRevision || 0),
    events: Object.freeze([...overflow, ...hot].sort((left, right) => left.revision - right.revision)),
  });
}

export function acknowledgeLiveTimelineArrivals(state, throughRevision) {
  if (!state) return 0;
  const revision = Math.min(
    Number(state._liveArrivalRevision || 0),
    Math.max(Number(state._liveArrivalAckRevision || 0), Number(throughRevision || 0)),
  );
  state._liveArrivalAckRevision = revision;
  state._liveArrivalLog = (state._liveArrivalLog || []).filter((event) => event.revision > revision);
  for (const [key, event] of state._liveArrivalOverflow || []) {
    if (event.revision <= revision) state._liveArrivalOverflow.delete(key);
  }
  return revision;
}

export function registerLiveTimelineArrivalConsumer(state, consumerToken = Symbol('live-arrival-consumer')) {
  if (!state) return () => {};
  // Registration is keyed by the mounted Timeline, rather than accumulated by
  // setup calls. This keeps an accidental duplicate setup (and React's
  // setup-cleanup-setup StrictMode probe) from leaving the Replica permanently
  // subscribed after the one logical consumer has gone away.
  const consumers = state._liveArrivalConsumerTokens instanceof Set
    ? state._liveArrivalConsumerTokens
    : new Set();
  state._liveArrivalConsumerTokens = consumers;
  consumers.add(consumerToken);
  state._liveArrivalConsumers = consumers.size;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    consumers.delete(consumerToken);
    state._liveArrivalConsumers = consumers.size;
  };
}

function livePresentationRowIDs(state, envelope, seq) {
  if (!envelope) return Object.freeze([]);
  const ids = new Set();
  if (isNarrationEnvelope(envelope)) {
    const narrationSeq = Number(state.narration?.[0]?.seq || seq || 0);
    if (narrationSeq > 0) ids.add(`narration:${narrationSeq}`);
  }
  if (envelope.kind === 'request' || envelope.kind === 'response') {
    const rootID = rootTurnID(state, envelope);
    if (rootID) ids.add(String(rootID));
  }
  if (envelope.id) ids.add(String(envelope.id));
  return Object.freeze([...ids]);
}

// A live transport fact is only a CANDIDATE for visual entry. The Timeline
// intersects these exact stable identities with the committed Presentation's
// backInsertedIDs, so progress/content updates and already-present roots never
// become entry animations. No consumer means no backlog: returning to a cold
// channel must never replay old pixels as if they just arrived.
export function recordLivePresentationArrival(state, envelope, seq) {
  if (!state?._livePresentationArrivalConsumerTokens?.size) return null;
  const rowIDs = livePresentationRowIDs(state, envelope, seq);
  if (!rowIDs.length) return null;
  const revision = Number(state._livePresentationArrivalRevision || 0) + 1;
  const event = Object.freeze({
    revision,
    rowIDs,
    seq: Math.max(0, Number(seq) || 0),
    sourceRevision: Number(state._timelineRevision || 0),
  });
  state._livePresentationArrivalRevision = revision;
  state._livePresentationArrivalLog.push(event);
  if (state._livePresentationArrivalLog.length > LIVE_PRESENTATION_ARRIVAL_LIMIT) {
    const removed = state._livePresentationArrivalLog.splice(
      0,
      state._livePresentationArrivalLog.length - LIVE_PRESENTATION_ARRIVAL_LIMIT,
    );
    state._livePresentationArrivalAckRevision = Math.max(
      Number(state._livePresentationArrivalAckRevision || 0),
      Number(removed.at(-1)?.revision || 0),
    );
  }
  return event;
}

export function livePresentationArrivals(state, throughSourceRevision = Number.POSITIVE_INFINITY) {
  const acknowledgedRevision = Number(state?._livePresentationArrivalAckRevision || 0);
  const events = [];
  let revision = acknowledgedRevision;
  // Replica and Presentation use the same monotone timeline source clock. Only
  // expose the contiguous event prefix already represented by this committed
  // Presentation candidate; a newer live fact may land between render and
  // layout-effect consumption and must remain for the next commit.
  for (const event of state?._livePresentationArrivalLog || []) {
    if (Number(event.revision) <= acknowledgedRevision) continue;
    if (Number(event.sourceRevision) > Number(throughSourceRevision)) break;
    events.push(event);
    revision = Number(event.revision);
  }
  return Object.freeze({
    revision,
    headRevision: Number(state?._livePresentationArrivalRevision || 0),
    acknowledgedRevision,
    events: Object.freeze(events),
  });
}

export function acknowledgeLivePresentationArrivals(state, throughRevision) {
  if (!state) return 0;
  const revision = Math.min(
    Number(state._livePresentationArrivalRevision || 0),
    Math.max(
      Number(state._livePresentationArrivalAckRevision || 0),
      Number(throughRevision || 0),
    ),
  );
  state._livePresentationArrivalAckRevision = revision;
  state._livePresentationArrivalLog = (state._livePresentationArrivalLog || [])
    .filter((event) => Number(event.revision) > revision);
  return revision;
}

export function registerLivePresentationArrivalConsumer(
  state,
  consumerToken = Symbol('live-presentation-arrival-consumer'),
) {
  if (!state) return () => {};
  const consumers = state._livePresentationArrivalConsumerTokens instanceof Set
    ? state._livePresentationArrivalConsumerTokens
    : new Set();
  state._livePresentationArrivalConsumerTokens = consumers;
  if (consumers.size === 0) {
    acknowledgeLivePresentationArrivals(state, state._livePresentationArrivalRevision);
  }
  consumers.add(consumerToken);
  return () => {
    consumers.delete(consumerToken);
    if (consumers.size === 0) {
      acknowledgeLivePresentationArrivals(state, state._livePresentationArrivalRevision);
    }
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
      ...(payload.merged_into ? { merged_into: payload.merged_into } : {}),
      ...(payload.replaced_by ? { replaced_by: payload.replaced_by } : {}),
      ...(payload.preempted_by ? { preempted_by: payload.preempted_by } : {}),
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

// Lifecycle consumers may use `turn.terminal` (including a compact closure)
// to know that work is closed.  Presentation consumers that render an answer
// body use this boundary: a compact closure intentionally forgot the terminal
// body and is not a presentable final response.  Other model projections may
// still distinguish retained lifecycle fields from optional business fields.
export function terminalContentEnvelope(turn) {
  return turn?.terminal && turn.terminalClosureOnly !== true ? turn.terminal : null;
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
