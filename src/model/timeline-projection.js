import { argsOf } from '../protocol/envelope.js';
import {
  HIDDEN_TURN_TYPES,
  isUiProtocolType,
  timelineTurnVisible,
} from './conversation-visibility.js';
import { orderedTimeline } from './fold.js';
import {
  entryMatchesActors,
  entryMatchesScope,
  relatedEnvelopeIds,
  relatedEnvelopeIdsIncremental,
  TIMELINE_SCOPE,
} from './timeline-scope.js';
import { TYPES } from '../protocol/vocab.js';

export { presentationEntryId } from './conversation-presentation.js';

const LOCAL_ECHO_HIDDEN_TYPES = new Set([
  ...HIDDEN_TURN_TYPES,
  TYPES.agentSelect,
  TYPES.agentNew,
]);
const projectionCache = new WeakMap();

function isTransientEntry(entry) {
  return entry.kind === 'standalone'
    && (argsOf(entry.envelope)?.transient === true || entry.envelope?.type === 'mock.channel.pulse');
}

// ui.* is an operation stream between an agent and one browser tab, not a
// conversation with the person. Keep it in "all" for ledger inspection, but
// remove both root UI turns and nested UI calls from the person's chat view.
function withoutUiProtocol(entry) {
  if (entry.kind === 'turn' && isUiProtocolType(entry.turn?.request?.type)) return null;
  if (!entry.thread?.some((item) => isUiProtocolType(item.turn?.request?.type))) return entry;
  return { ...entry, thread: entry.thread.filter((item) => !isUiProtocolType(item.turn?.request?.type)) };
}

function timelineEntryVisible(entry, editingTargetId, editingReplacementId) {
  if (entry.kind === 'standalone' && entry.envelope?.type === 'terminal.session') return false;
  if (entry.kind !== 'turn') return true;
  // The edit command may be materialized before the target's reciprocal
  // terminal arrives. Keep that exact candidate out of Presentation until the
  // edit transaction can replace old→new in one committed visual slot.
  if (editingReplacementId && entry.turn?.requestId === editingReplacementId) return false;
  return timelineTurnVisible(entry.turn, editingTargetId);
}

// This is the only semantic visibility projection for Timeline. Rendering and
// history completion both consume this exact result; ledger-row counts never
// participate in the answer to "did the user get an older visible item?".
export function projectTimeline(state, {
  scope = TIMELINE_SCOPE.mine,
  selfId = '',
  actorFilter = new Set(),
  editingTargetId = '',
  editingReplacementId = '',
  showNarration = false,
  presentation = null,
  presentationAdmission = null,
  presentationKey = '',
  dataEpoch = '',
  localEchoes = [],
  // 「我的往来」用增量索引算(见 timeline-scope.js)。输出相同,代价从"每帧走一遍
  // 整本账"降到"每帧只判新来的那几行"。
  incremental = false,
} = {}) {
  const actorFilterApplies = scope === TIMELINE_SCOPE.mine;
  const mine = scope === TIMELINE_SCOPE.mine;
  const cacheKey = JSON.stringify([
    scope, selfId, [...(actorFilter || [])].sort(), editingTargetId, editingReplacementId, showNarration, incremental,
  ]);
  let stateCache = projectionCache.get(state);
  if (!stateCache) {
    stateCache = new Map();
    projectionCache.set(state, stateCache);
  }
  const projectionVersion = Number(state._timelineProjectionVersion || 0);
  let base = stateCache.get(cacheKey);
  if (!base || base.projectionVersion !== projectionVersion) {
    const related = mine && selfId
      ? (incremental ? relatedEnvelopeIdsIncremental(state, selfId) : relatedEnvelopeIds(state, selfId))
      : null;
    const allEntries = [];
    const scoped = [];
    const filtered = [];
    for (const rawEntry of orderedTimeline(state)) {
      if (!timelineEntryVisible(rawEntry, editingTargetId, editingReplacementId)) continue;
      allEntries.push(rawEntry);
      const entry = mine ? withoutUiProtocol(rawEntry) : rawEntry;
      if (!entry || (related && !entryMatchesScope(entry, related))) continue;
      scoped.push(entry);
      if (actorFilterApplies && actorFilter?.size && !entryMatchesActors(entry, actorFilter)) continue;
      filtered.push(entry);
    }
    const latestTransient = new Map();
    for (const entry of filtered) {
      if (isTransientEntry(entry)) latestTransient.set(`${entry.envelope.sender?.id || ''}:${entry.envelope.type}`, entry);
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
    base = { projectionVersion, allEntries, scoped, filtered, visible, items };
    stateCache.set(cacheKey, base);
  }
  const landedIndex = state._envelopesById?.has
    ? state._envelopesById
    : new Set([...(state.rows?.values?.() || [])].map((envelope) => envelope?.id).filter(Boolean));
  const echoes = (localEchoes || []).flatMap((submission, index) => {
    if (!submission?.messageId || landedIndex.has(submission.messageId)) return [];
    const frame = submission.frame || {};
    if (!frame.msg_type || LOCAL_ECHO_HIDDEN_TYPES.has(frame.msg_type) || String(frame.msg_type).startsWith('ui.')) return [];
    const envelope = {
        id: submission.messageId,
        type: frame.msg_type,
        kind: frame.kind || 'request',
        payload: frame.payload || { text: submission.text || '' },
        audience: frame.audience || [],
        parent_id: frame.parent_id || '',
        visibility: frame.visibility || 'public',
        ts: submission.createdAt || Date.now() + index,
        sender: { id: selfId, kind: 'human' },
        local_submission_state: submission.state,
    };
    // A pending request already has its permanent message identity and kind.
    // Render the same request shell it will have after ledger confirmation;
    // otherwise confirmation replaces Standalone with TurnCard and destroys
    // the clicked control, fold identity, and DOM reading anchor.
    const entry = envelope.kind === 'request' ? {
      kind: 'turn', seq: 0, local: true, thread: [],
      turn: {
        requestId: envelope.id, request: envelope, requestSeq: 0,
        lastSeq: 0, provisional: [], terminal: null,
        status: 'local', local: true,
      },
    } : { kind: 'standalone', seq: 0, local: true, envelope };
    if (actorFilterApplies && actorFilter?.size && !entryMatchesActors(entry, actorFilter)) return [];
    return [entry];
  });
  const rawItems = echoes.length ? [...base.items, ...echoes] : base.items;
  const admissionMeta = {
    viewID: presentationKey,
    epoch: dataEpoch,
    sourceRevision: Number(state._timelineRevision ?? state.lastSeq ?? 0),
  };
  const items = presentationAdmission?.admit
    ? presentationAdmission.admit(state.channelId, rawItems, admissionMeta)
    : rawItems;
  const admissionSourceFence = presentationAdmission?.sourceFence?.(state.channelId);
  const projectedSourceRevision = admissionSourceFence == null
    ? Number(state._timelineRevision ?? state.lastSeq ?? 0)
    : admissionSourceFence;
  const presentationSnapshot = presentation?.project
    ? presentation.project(items, {
      epoch: dataEpoch,
      nextViewID: presentationKey,
      sourceRevision: projectedSourceRevision,
      sourceChangeBase: Number(state._timelineChangeBase || 0),
      sourceChanges: (state._timelineChangeLog || [])
        .filter((change) => Number(change.revision || 0) <= projectedSourceRevision),
    })
    : null;

  return {
    items,
    presentation: presentationSnapshot,
    presentationRows: presentationSnapshot?.rows || [],
    allEntries: base.allEntries,
    scoped: base.scoped,
    filtered: base.filtered,
    localEchoes: echoes,
    actorFilterApplies,
    firstVisibleSeq: items[0]?.seq || 0,
    lastVisibleSeq: items.at(-1)?.seq || 0,
  };
}
