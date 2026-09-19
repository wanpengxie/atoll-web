import { terminalResultPayload } from '../../model/terminal-result.js';

function payloadValue(turn) {
  const payload = terminalResultPayload(turn);
  if (!payload || payload.status !== 'completed') return null;
  return payload.value && typeof payload.value === 'object' ? payload.value : payload;
}

function ids(value) {
  return String(value || '').split('|').filter(Boolean);
}

function firstCompleted(state, requestIDs) {
  for (const requestID of ids(requestIDs)) {
    const turn = state?.turns?.get?.(requestID);
    const value = payloadValue(turn);
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

function pendingView(state, actorId, keys) {
  const requestIDs = [...ids(keys.options), ...ids(keys.context)];
  for (const requestID of requestIDs) {
    const turn = state?.turns?.get?.(requestID);
    if (!turn) continue;
    if (!turn.terminal) return { actorId, requestId: requestID, state: 'loading' };
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
  const optionsResult = firstCompleted(state, keys.options);
  const contextResult = firstCompleted(state, keys.context);
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
  return Object.freeze({ view, pending: pendingView(state, actorId, keys) });
}
