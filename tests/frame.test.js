import { describe, expect, it } from 'vitest';
import {
  FRAME_VERSION,
  FrameValidationError,
  frame,
  parseDownstream,
  upstreamPayloadFields,
} from '../src/protocol/frame.js';

describe('frame ABI', () => {
	it('builds the exact v5 envelope and requires generation-tagged history', () => {
	expect(frame('attach', 'attach-1', { since: { c0: 3 }, focus: 'c0', history_protocol: 5, generation: 1 })).toEqual({
      v: FRAME_VERSION,
      frame_type: 'attach',
      ref: 'attach-1',
	  payload: { since: { c0: 3 }, focus: 'c0', history_protocol: 5, generation: 1 },
    });
	expect(frame('attach', '', { focus: '', history_protocol: 5, generation: 2 })).toEqual({ v: 5, frame_type: 'attach', payload: { focus: '', history_protocol: 5, generation: 2 } });
  });

  it('rejects version mismatch and must-ignore unknown downstream types', () => {
    expect(parseDownstream('{"v":1,"frame_type":"feed"}').kind).toBe('bad_version');
	expect(parseDownstream('{"v":5,"frame_type":"future"}')).toMatchObject({
      kind: 'unknown',
	  frame: { v: 5, frame_type: 'future' },
    });
  });

  it('parses known downstream frames', () => {
	expect(parseDownstream('{"v":5,"frame_type":"receipt","ref":"x","payload":{"message_id":"m"}}')).toMatchObject({
      kind: 'receipt',
      payload: { message_id: 'm' },
    });
  });

  it('blocks unknown upstream fields before serialization', () => {
    expect(() => frame('submit', 'submit-1', {
      channel_id: 'c0',
      msg_type: 'agent.ask',
      payload: { text: 'hello' },
      channelId: 'wrong',
    })).toThrow(FrameValidationError);
    expect(upstreamPayloadFields('submit')).toMatchInlineSnapshot(`
      [
        "channel_id",
        "id",
        "msg_type",
        "kind",
        "payload",
        "audience",
        "visibility",
        "parent_id",
        "expires_at_ms",
      ]
    `);
  });

  it('keeps directory creation inside the resource payload contract', () => {
	expect(frame('resource', 'mkdir-1', {
	  channel_id: 'c0', op: 'create', address: 'daemon://local-device/c0/docs', node_type: 'directory',
	}).payload.node_type).toBe('directory');
	expect(() => frame('resource', 'bad-dir', {
	  channel_id: 'c0', op: 'create', address: 'daemon://local-device/c0/docs', node_type: 'directory', with_content: true,
	})).toThrow(FrameValidationError);
  });
});
