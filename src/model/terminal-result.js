import { argsOf } from '../protocol/envelope.js';

const TERMINAL_RETAINED_FIELDS = Object.freeze([
  'merged_into',
  'replaced_by',
  'preempted_by',
]);

export function terminalRetainedFields(payload = {}) {
  const retained = {};
  for (const key of TERMINAL_RETAINED_FIELDS) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && value !== '') retained[key] = value;
  }
  return retained;
}

export function terminalRetainedValue(turn, key) {
  if (!TERMINAL_RETAINED_FIELDS.includes(key)) return undefined;
  return terminalRetainedFields(argsOf(turn?.terminal))[key];
}

export function terminalResultEnvelope(turn) {
  return turn?.terminal && turn.terminalClosureOnly !== true ? turn.terminal : null;
}

export function terminalResultPayload(turn) {
  const terminal = terminalResultEnvelope(turn);
  return terminal ? argsOf(terminal) : null;
}

export const TERMINAL_RESULT_UNAVAILABLE = '终态详情不可用，请刷新或重新进入频道';

export function terminalResultState(turn) {
  if (!turn?.terminal) return Object.freeze({ phase: 'waiting', error: '' });
  if (turn.terminalClosureOnly === true) {
    return Object.freeze({ phase: 'unavailable', error: TERMINAL_RESULT_UNAVAILABLE });
  }
  return Object.freeze({ phase: 'available', error: '' });
}

export function terminalContentEnvelope(turn) {
  return terminalResultEnvelope(turn);
}
