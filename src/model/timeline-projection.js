import { argsOf } from '../protocol/envelope.js';
import { agentMessageStage, isAgentMessageTurn } from './agent-control.js';
import { orderedTimeline } from './fold.js';
import {
  entryMatchesActors,
  entryMatchesScope,
  relatedEnvelopeIds,
  relatedEnvelopeIdsIncremental,
  TIMELINE_SCOPE,
} from './timeline-scope.js';
import { TYPES } from '../protocol/vocab.js';
import { projectPresentationRows } from './conversation-presentation.js';

export { presentationEntryId } from './conversation-presentation.js';

const HIDDEN_TURN_TYPES = new Set([
  TYPES.agentHold,
  TYPES.agentUnhold,
  TYPES.agentInterrupt,
  TYPES.agentContext,
  TYPES.agentOptions,
  TYPES.agentFork,
  TYPES.describe,
]);

const SELECT_OR_NEW = new Set([TYPES.agentSelect, TYPES.agentNew]);

function isTransientEntry(entry) {
  return entry.kind === 'standalone'
    && (argsOf(entry.envelope)?.transient === true || entry.envelope?.type === 'mock.channel.pulse');
}

function isUiProtocolTurn(turn) {
  return typeof turn?.request?.type === 'string' && turn.request.type.startsWith('ui.');
}

// ui.* is an operation stream between an agent and one browser tab, not a
// conversation with the person. Keep it in "all" for ledger inspection, but
// remove both root UI turns and nested UI calls from the person's chat view.
function withoutUiProtocol(entry) {
  if (entry.kind === 'turn' && isUiProtocolTurn(entry.turn)) return null;
  if (!entry.thread?.some((item) => isUiProtocolTurn(item.turn))) return entry;
  return { ...entry, thread: entry.thread.filter((item) => !isUiProtocolTurn(item.turn)) };
}

function timelineEntryVisible(entry, editingTargetId) {
  if (entry.kind === 'standalone' && entry.envelope?.type === 'terminal.session') return false;
  if (entry.kind !== 'turn') return true;
  if (HIDDEN_TURN_TYPES.has(entry.turn.request.type)) return false;
  if (SELECT_OR_NEW.has(entry.turn.request.type)) return argsOf(entry.turn.terminal)?.status === 'completed';
  if (entry.turn.requestId === editingTargetId) return true;
  if (isAgentMessageTurn(entry.turn)) return agentMessageStage(entry.turn) === 'timeline';
  return true;
}

// This is the only semantic visibility projection for Timeline. Rendering and
// history completion both consume this exact result; ledger-row counts never
// participate in the answer to "did the user get an older visible item?".
export function projectTimeline(state, {
  scope = TIMELINE_SCOPE.mine,
  selfId = '',
  actorFilter = new Set(),
  editingTargetId = '',
  showNarration = false,
  presentationProjector = null,
  // 「我的往来」用增量索引算(见 timeline-scope.js)。输出相同,代价从"每帧走一遍
  // 整本账"降到"每帧只判新来的那几行"。
  incremental = false,
} = {}) {
  const actorFilterApplies = scope === TIMELINE_SCOPE.mine;
  const mine = scope === TIMELINE_SCOPE.mine;
  const related = mine && selfId
    ? (incremental ? relatedEnvelopeIdsIncremental(state, selfId) : relatedEnvelopeIds(state, selfId))
    : null;
  const allEntries = [];
  const scoped = [];
  const filtered = [];

  // 一条 live frame 到达时这段会跑在输入同一条主线程上。过去先 filter、再 map、
  // 再 scope filter、再 actor filter，老频道每帧会把整条时间线复制四遍。这里保持
  // 三层结果供历史判断和 UI 使用，但在一次顺序扫描里同时生成它们。
  for (const rawEntry of orderedTimeline(state)) {
    if (!timelineEntryVisible(rawEntry, editingTargetId)) continue;
    allEntries.push(rawEntry);
    const entry = mine ? withoutUiProtocol(rawEntry) : rawEntry;
    if (!entry || (related && !entryMatchesScope(entry, related))) continue;
    scoped.push(entry);
    if (actorFilterApplies && actorFilter?.size && !entryMatchesActors(entry, actorFilter)) continue;
    filtered.push(entry);
  }

  const latestTransient = new Map();
  for (const entry of filtered) {
    if (isTransientEntry(entry)) {
      latestTransient.set(`${entry.envelope.sender?.id || ''}:${entry.envelope.type}`, entry);
    }
  }
  const visible = filtered.filter((entry) => (
    !isTransientEntry(entry)
    || latestTransient.get(`${entry.envelope.sender?.id || ''}:${entry.envelope.type}`) === entry
  ));
  const narrationSeq = state.narration?.[0]?.seq ?? Number.POSITIVE_INFINITY;
  let items = visible;
  if (showNarration && state.narration?.length) {
    const narration = { kind: 'narration', seq: narrationSeq };
    const insertion = visible.findIndex((entry) => entry.seq > narrationSeq);
    items = insertion < 0
      ? [...visible, narration]
      : [...visible.slice(0, insertion), narration, ...visible.slice(insertion)];
  }

  return {
    items,
    presentationRows: presentationProjector?.project
      ? presentationProjector.project(items)
      : projectPresentationRows(items),
    allEntries,
    scoped,
    filtered,
    actorFilterApplies,
    firstVisibleSeq: items[0]?.seq || 0,
    lastVisibleSeq: items.at(-1)?.seq || 0,
  };
}
