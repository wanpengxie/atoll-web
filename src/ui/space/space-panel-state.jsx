import React from 'react';
import { terminalValue } from '../../model/space-administration.js';

export function stateFor(states, id) {
  return states.find((state) => state?.turns?.has(id)) || states[0];
}

export function resultRows(states, id) {
  const value = terminalValue(stateFor(states, id), id).value;
  if (Array.isArray(value)) return value;
  return value?.items || value?.templates || value?.declarations || [];
}

export function OperationState({ states, requestId }) {
  if (!requestId) return null;
  const result = terminalValue(stateFor(states, requestId), requestId);
  const label = result.phase === 'completed'
    ? '账本已完成'
    : result.phase === 'failed'
      ? `失败：${result.error}`
      : '请求已提交，等待账本终态';
  return <p className={`operation-state state-${result.phase}`} role="status">{label}</p>;
}
