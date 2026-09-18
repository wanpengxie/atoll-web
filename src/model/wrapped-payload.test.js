import { describe, expect, it } from 'vitest';
import { argsOf, isTerminal } from '../protocol/envelope.js';
import { fold } from './fold.js';
import { messagePresentation } from './message-presentation.js';
import { processObservations } from './turn-process.js';
import { abbreviateToolRow } from './payload-abbreviate.js';
import { decodeSystemEvent } from '../protocol/system-events.js';
import { TYPES } from '../protocol/vocab.js';

const wrap = (body) => ({ _context: { session: 'test-session' }, body });
const envelope = (id, kind, body, extra = {}) => ({
  id, kind, type: 'agent.ask', channel_id: 'dev', sender: { kind: 'agent', id: 'claude' },
  payload: wrap(body), ...extra,
});

describe('wrapped ledger payloads', () => {
  it.each(['request', 'response', 'event'])('reads canonical %s bodies and quietly ignores historical flat payloads', (kind) => {
    const body = { text: 'hello', status: 'completed' };
    expect(argsOf(envelope('a', kind, body))).toEqual(body);
    expect(argsOf({ kind, payload: body })).toEqual({});
  });

  it('keeps historical flat rows out of every business projection', () => {
    const state = fold([{ channel_id: 'dev', seq: 1, envelope: {
      id: 'old-development-row', kind: 'event', type: 'human.note',
      sender: { kind: 'human', id: 'me' }, payload: { text: 'old' },
    } }]);
    expect(state.rows.size).toBe(1);
    expect(state.turns.size).toBe(0);
    expect(state.standalone).toHaveLength(0);
    expect(state.orphans).toHaveLength(0);
    expect(state.narration).toHaveLength(0);
  });

  it('folds progress and final errors without creating empty standalone cards', () => {
    const messages = [
      envelope('ask', 'request', { text: '你好' }),
      envelope('progress', 'response', { status: 'processing', process: { kind: 'turn', phase: 'started', turn_index: 1 } }, { parent_id: 'ask' }),
      envelope('done', 'response', { status: 'completed', text: 'Prompt is too long' }, { parent_id: 'ask' }),
    ];
    const original = JSON.stringify(messages);
    const rows = messages.map((item, i) => ({ channel_id: 'dev', seq: i + 1, envelope: item }));
    const state = fold(rows);
    const turn = state.turns.get('ask');
    expect(turn.status).toBe('completed');
    expect(turn.text).toBe('Prompt is too long');
    expect(isTerminal(turn.terminal)).toBe(true);
    expect(messagePresentation(turn.terminal).text).toBe('Prompt is too long');
    expect(processObservations(turn)).toHaveLength(1);
    expect(state.orphans).toHaveLength(0);
    expect(state.standalone).toHaveLength(0);
    expect(JSON.stringify(messages)).toBe(original);
  });

  it('reads wrapped membership events', () => {
    const event = envelope('joined', 'event', { member: 'claude' }, { type: TYPES.narration.memberCreated });
    expect(decodeSystemEvent(event)).toMatchObject({ kind: 'member_joined', memberId: 'claude' });
  });

  it('abbreviates wrapped tool output only in the memory copy', () => {
    const row = { seq: 1, envelope: envelope('tool', 'response', { status: 'processing', process: { kind: 'tool', output: 'abcdef' } }) };
    const result = abbreviateToolRow(row, { head: 2, threshold: 3 });
    expect(argsOf(result.envelope).process.output).toContain('ab');
    expect(argsOf(result.envelope).process.output_abbreviated).toBe(true);
    expect(result.envelope.payload._context).toEqual(row.envelope.payload._context);
    expect(argsOf(row.envelope).process.output).toBe('abcdef');
  });
});
