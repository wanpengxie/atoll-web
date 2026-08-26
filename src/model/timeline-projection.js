import { agentMessageStage, isAgentMessageTurn } from './agent-control.js';
import { orderedTimeline } from './fold.js';
import { filterEntriesByActors, scopeEntries, TIMELINE_SCOPE } from './timeline-scope.js';
import { TYPES } from '../protocol/vocab.js';

const HIDDEN_TURN_TYPES = new Set([
  TYPES.agentHold,
  TYPES.agentUnhold,
  TYPES.agentInterrupt,
  TYPES.agentContext,
  TYPES.agentFork,
  TYPES.describe,
]);

const SELECT_OR_NEW = new Set([TYPES.agentSelect, TYPES.agentNew]);

function isTransientEntry(entry) {
  return entry.kind === 'standalone'
    && (entry.envelope?.payload?.transient === true || entry.envelope?.type === 'mock.channel.pulse');
}

function timelineEntryVisible(entry, editingTargetId) {
  if (entry.kind === 'standalone' && entry.envelope?.type === 'terminal.session') return false;
  if (entry.kind !== 'turn') return true;
  if (HIDDEN_TURN_TYPES.has(entry.turn.request.type)) return false;
  if (SELECT_OR_NEW.has(entry.turn.request.type)) return entry.turn.terminal?.payload?.status === 'completed';
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
} = {}) {
  const allEntries = orderedTimeline(state).filter((entry) => timelineEntryVisible(entry, editingTargetId));
  const scoped = scopeEntries(allEntries, { scope, state, selfId });
  const actorFilterApplies = scope === TIMELINE_SCOPE.mine;
  const filtered = actorFilterApplies ? filterEntriesByActors(scoped, actorFilter) : scoped;

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
  const items = [...visible, ...(showNarration && state.narration?.length
    ? [{ kind: 'narration', seq: narrationSeq }]
    : [])].sort((left, right) => left.seq - right.seq);

  return {
    items,
    allEntries,
    scoped,
    filtered,
    actorFilterApplies,
    firstVisibleSeq: items[0]?.seq || 0,
    lastVisibleSeq: items.at(-1)?.seq || 0,
  };
}
