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

// A current-only projection over probe-owned request ids. It never scans old
// requests as a fallback: no live request id means no parameter truth.
export function projectAgentParameters({ state, actorId, requestKeys }) {
  if (!actorId || !state) return Object.freeze({ view: null, pending: null });
  const keys = requestKeys || {};
  const turns = timelineTurnIndex(state, [...ids(keys.options), ...ids(keys.context)]);
  const optionsResult = firstCompleted(turns, actorId, keys.options, TYPES.agentOptions);
  const contextResult = firstCompleted(turns, actorId, keys.context, TYPES.agentContext);
  const options = optionView(optionsResult?.value);
  const usage = usageView(contextResult?.value);
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
