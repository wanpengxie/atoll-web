import { terminalResultPayload } from '../../model/terminal-result.js';
import { TYPES } from '../../protocol/vocab.js';

function payloadValue(turn, actorId, requestID, expectedType) {
  if (turn?.requestId !== requestID
    || turn.request?.id !== requestID
    || turn.request.type !== expectedType
    || turn.request.audience?.length !== 1
    || turn.request.audience[0] !== actorId
    || turn.terminal?.kind !== 'response'
    || turn.terminal.type !== expectedType
    || turn.terminal.parent_id !== requestID
    || turn.terminal.sender?.id !== actorId) return null;
  const payload = terminalResultPayload(turn);
  if (!payload || payload.status !== 'completed') return null;
  return payload.value && typeof payload.value === 'object' ? payload.value : payload;
}

function ids(value) {
  return String(value || '').split('|').filter(Boolean);
}

// ChannelReplica owns the only ledger. Read the probe owner's exact request
// ids from its canonical public timeline, including correlated child turns;
// this projection retains no probe state and never scans unrelated history.
function timelineTurnIndex(state, requestIDs) {
  const wanted = new Set(Array.isArray(requestIDs) ? requestIDs.filter(Boolean) : ids(requestIDs));
  const turns = new Map();
  const visit = (entry) => {
    if (!entry || !wanted.size) return;
    if (entry.kind === 'turn') {
      const turn = entry.turn;
      if (turn?.requestId && wanted.has(turn.requestId)) {
        turns.set(turn.requestId, turn);
        wanted.delete(turn.requestId);
      }
    }
    for (const child of entry.thread || []) visit(child);
  };
  for (const entry of state?.timeline || []) visit(entry);
  return turns;
}

function timelineTurns(state) {
  const turns = [];
  const visit = (entry) => {
    if (!entry) return;
    if (entry.kind === 'turn' && entry.turn) turns.push(entry.turn);
    for (const child of entry.thread || []) visit(child);
  };
  for (const entry of state?.timeline || []) visit(entry);
  return turns;
}

function firstCompleted(turns, actorId, requestIDs, expectedType) {
  for (const requestID of ids(requestIDs)) {
    const turn = turns.get(requestID);
    const value = payloadValue(turn, actorId, requestID, expectedType);
    if (value) return { requestID, turn, value };
  }
  return null;
}

function optionView(value) {
  if (!Array.isArray(value?.models)) return null;
  const models = [];
  const selections = [];
  for (const entry of value.models) {
    const model = String(entry?.value || '').trim();
    if (!model) continue;
    const modelLabel = String(entry.label || model);
    models.push({ id: model, label: modelLabel, description: String(entry.description || '') });
    const efforts = Array.isArray(entry.efforts) ? entry.efforts : [];
    if (!efforts.length) selections.push({ model, effort: '', modelLabel, effortLabel: '' });
    for (const effortEntry of efforts) {
      const effort = String(effortEntry?.value || '').trim();
      if (!effort) continue;
      selections.push({
        model,
        effort,
        modelLabel,
        effortLabel: String(effortEntry.label || effort),
        description: String(effortEntry.description || ''),
      });
    }
  }
  if (!models.length) return null;
  return {
    models,
    selections,
    current: value.current?.model ? { model: String(value.current.model), effort: String(value.current.effort || '') } : null,
    client: value.client && typeof value.client === 'object' ? value.client : null,
    source: String(value.source || ''),
  };
}

// Older (and still valid) agents publish their selectable combinations on the
// live actor.describe schema instead of answering agent.options.  Keep this a
// projection of the current capability entry, not a second catalog: the
// schema's oneOf branches are the provider's authoritative legal pairs.
function describeOptionView(capability) {
  const word = capability?.describe?.types?.get?.(TYPES.agentSelect);
  const branches = Array.isArray(word?.inputSchema?.oneOf) ? word.inputSchema.oneOf : [];
  const selections = branches.map((branch) => {
    const model = branch?.properties?.model;
    const effort = branch?.properties?.effort;
    const modelID = typeof model?.const === 'string' ? model.const.trim() : '';
    const effortID = typeof effort?.const === 'string' ? effort.const.trim() : '';
    if (!modelID || !effortID) return null;
    return {
      model: modelID,
      effort: effortID,
      modelLabel: String(model.title || modelID),
      effortLabel: String(effort.title || effortID),
    };
  }).filter(Boolean);
  if (!selections.length) return null;
  const models = [...new Map(selections.map((row) => [row.model, {
    id: row.model,
    label: row.modelLabel,
    description: '',
  }])).values()];
  return { models, selections, current: null, client: null, source: 'describe' };
}

function usageView(value) {
  if (!value || typeof value !== 'object') return null;
  const usage = value.usage && typeof value.usage === 'object' ? value.usage : value;
  const model = String(usage.model || '');
  const effort = String(usage.effort || '');
  const contextTokens = Number.isFinite(Number(usage.context_tokens)) ? Number(usage.context_tokens) : null;
  const contextWindow = Number.isFinite(Number(usage.context_window)) ? Number(usage.context_window) : null;
  if (!model && contextTokens == null && contextWindow == null) return null;
  return { model, effort, contextTokens, contextWindow };
}

function mergeUsage(current, next) {
  if (!next) return current;
  return {
    model: next.model || current?.model || '',
    effort: next.model ? next.effort : (current?.effort || next.effort || ''),
    contextTokens: next.contextTokens ?? current?.contextTokens ?? null,
    contextWindow: next.contextWindow ?? current?.contextWindow ?? null,
  };
}

function turnSequence(turn) {
  for (const value of [turn?.terminalSeq, turn?.lastSeq, turn?.requestSeq]) {
    const sequence = Number(value);
    if (Number.isFinite(sequence) && sequence > 0) return sequence;
  }
  return 0;
}

function usageAfterContext(state, actorId, contextTurn, baseline) {
  const turns = timelineTurns(state);
  const contextIndex = turns.indexOf(contextTurn);
  if (contextIndex < 0) return baseline;
  const contextSeq = turnSequence(contextTurn);
  let usage = baseline;
  for (let index = contextIndex + 1; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn?.terminalClosureOnly === true) continue;
    const sequence = turnSequence(turn);
    // History can be appended after the probe in a sparse page. A known older
    // sequence is not current-session evidence even if it arrived later.
    if (contextSeq > 0 && sequence > 0 && sequence <= contextSeq) continue;
    if (turn?.request?.type !== TYPES.agentAsk
      || turn.request?.audience?.length !== 1
      || turn.request.audience[0] !== actorId) continue;
    const value = payloadValue(turn, actorId, turn.requestId, TYPES.agentAsk);
    const next = usageView(value?.usage);
    if (next) usage = mergeUsage(usage, next);
  }
  return usage;
}

function pendingView(turns, actorId, keys) {
  const requests = [
    ...ids(keys.options).map((requestID) => [requestID, TYPES.agentOptions]),
    ...ids(keys.context).map((requestID) => [requestID, TYPES.agentContext]),
  ];
  for (const [requestID, expectedType] of requests) {
    const turn = turns.get(requestID);
    if (!turn) continue;
    if (turn.request?.id !== requestID
      || turn.request.type !== expectedType
      || turn.request.audience?.length !== 1
      || turn.request.audience[0] !== actorId) continue;
    if (!turn.terminal) return { actorId, requestId: requestID, state: 'loading' };
    if (turn.terminal.kind !== 'response'
      || turn.terminal.type !== expectedType
      || turn.terminal.parent_id !== requestID
      || turn.terminal.sender?.id !== actorId) continue;
    const result = terminalResultPayload(turn);
    if (result && result.status === 'failed') {
      return { actorId, requestId: requestID, state: 'error', error: result.detail || result.error_code || 'Agent 参数读取失败' };
    }
  }
  return null;
}

// A current-only projection over the live probe's public timeline. It never
// scans old requests as a fallback: no live request id means no parameter
// truth. Once a completed context probe establishes the current-session
// boundary, later completed ask terminals may refresh usage; missing usage is
// deliberately ignored so a sparse terminal cannot clear a good reading.
export function projectAgentParameters({ state, actorId, requestKeys, capability }) {
  if (!actorId || !state) return Object.freeze({ view: null, pending: null });
  const keys = requestKeys || {};
  const turns = timelineTurnIndex(state, [...ids(keys.options), ...ids(keys.context)]);
  const optionsResult = firstCompleted(turns, actorId, keys.options, TYPES.agentOptions);
  const contextResult = firstCompleted(turns, actorId, keys.context, TYPES.agentContext);
  const options = optionView(optionsResult?.value) || describeOptionView(capability);
  const usage = contextResult
    ? usageAfterContext(state, actorId, contextResult.turn, usageView(contextResult.value))
    : null;
  const current = usage?.model ? { model: usage.model, effort: usage.effort } : options?.current || null;
  const view = options || usage ? Object.freeze({
    actorId,
    models: Object.freeze(options?.models || []),
    selections: Object.freeze(options?.selections || []),
    current,
    usage,
    client: options?.client || null,
    source: options?.source || '',
    configurable: Boolean(options?.selections?.length),
  }) : null;
  return Object.freeze({ view, pending: pendingView(turns, actorId, keys) });
}
