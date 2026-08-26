import { describe, expect, it } from 'vitest';
import {
  downstreamFrame,
  FRAME_VERSION,
  MAX_FRAME_BYTES,
  PAYLOAD_FIELDS,
  validatePayload,
} from '../mock/protocol.mjs';

describe('mock protocol layer', () => {
	it('matches the wire v4 envelope baseline', () => {
	expect(FRAME_VERSION).toBe(4);
    expect(MAX_FRAME_BYTES).toBe(512 * 1024);
    expect(Object.keys(PAYLOAD_FIELDS).sort()).toEqual([
      'after', 'attach', 'cancel', 'cancel_timer', 'history_before', 'observe', 'resolve', 'resource', 'submit', 'unobserve',
    ]);
    expect(downstreamFrame('receipt', 'r1', { message_id: 'm1' })).toEqual({
	  v: 4,
      frame_type: 'receipt',
      ref: 'r1',
      payload: { message_id: 'm1' },
    });
  });

  it('rejects missing and unknown upstream fields', () => {
    expect(validatePayload('submit', { channel_id: 'c0' })).toContain('msg_type');
    expect(validatePayload('submit', { channel_id: 'c0', msg_type: 'agent.ask', extra: true }))
      .toContain('unknown field: extra');
    expect(validatePayload('missing', {})).toContain('unknown upstream frame_type');
  });

  it('accepts every minimal closed-set payload', () => {
    const values = {
	  attach: { focus: '', history_protocol: 4, generation: 1 },
      submit: { channel_id: 'c0', msg_type: 'agent.ask' },
      resolve: { channel_id: 'c0', req_id: 'r', decision: 'approved' },
      cancel: { channel_id: 'c0', req_id: 'r' },
      after: { channel_id: 'c0', duration_ms: 1, msg_type: 'agent.ask' },
      cancel_timer: { channel_id: 'c0', timer_id: 't' },
      resource: { channel_id: 'c0', op: 'list' },
      observe: { channel_id: 'c1' },
      unobserve: { channel_id: 'c1' },
	  history_before: { channel_id: 'c1', before_seq: 10, limit: 50, generation: 1, purpose: 'hydrate' },
    };
    for (const [type, payload] of Object.entries(values)) expect(validatePayload(type, payload)).toBe('');
  });

  it('validates resource requirements by operation instead of globally requiring resource_id', () => {
    expect(validatePayload('resource', { channel_id: 'c0', op: 'list' })).toBe('');
    expect(validatePayload('resource', { channel_id: 'c0', op: 'create', address: 'daemon://d/c0/file.txt', with_content: true })).toBe('');
    expect(validatePayload('resource', { channel_id: 'c0', op: 'create' })).toContain('resource_id or address');
    expect(validatePayload('resource', { channel_id: 'c0', op: 'read' })).toContain('requires resource_id');
    expect(validatePayload('resource', { channel_id: 'c0', op: 'explode' })).toContain('op must be one of');
  });

  it('rejects invalid timer durations', () => {
    expect(validatePayload('after', { channel_id: 'c0', duration_ms: 0, msg_type: 'agent.ask' })).toContain('positive');
  });
});
