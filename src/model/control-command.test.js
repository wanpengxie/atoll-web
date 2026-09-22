import { describe, expect, it } from 'vitest';
import { TYPES } from '../protocol/vocab.js';
import {
  CONTROL_COMMAND_SOURCE,
  createControlCommand,
} from './control-command.js';

const TURN = {
  requestId: 'request-1',
  request: {
    id: 'request-1',
    type: TYPES.agentAsk,
    audience: ['agent:worker:1'],
  },
  terminal: null,
  local: false,
  provisional: [{
    seq: 9,
    envelope: {
      payload: {
        body: {
          status: 'processing',
          controls: [{ word: TYPES.agentInterrupt }],
        },
      },
    },
  }],
};

const AUTHORITY = { current: true, actorIDs: new Set(['agent:worker:1']) };

describe('canonical control command owner', () => {
  it('normalizes the timeline type alias to one wire msgType', () => {
    const command = createControlCommand({
      channelId: 'c0',
      type: TYPES.agentInterrupt,
      actorId: 'agent:worker:1',
      payload: {},
      controlContext: { source: CONTROL_COMMAND_SOURCE.timeline, turn: TURN, targetAuthority: AUTHORITY },
    });
    expect(command).toMatchObject({
      channelId: 'c0',
      msgType: TYPES.agentInterrupt,
      audience: ['agent:worker:1'],
      payload: {},
    });
    expect(command.type).toBeUndefined();
    expect(command.actorId).toBeUndefined();
  });

  it('keeps non-interrupt controls usable without an interrupt turn context', () => {
    expect(createControlCommand({
      channelId: 'c0', type: TYPES.agentSteer, actorId: 'agent:worker:1', payload: { target: 'request-1' },
    })).toMatchObject({ msgType: TYPES.agentSteer, audience: ['agent:worker:1'] });
    expect(createControlCommand({
      channelId: 'c0', type: TYPES.agentCompact, actorId: 'agent:worker:1', payload: {},
    })).toMatchObject({ msgType: TYPES.agentCompact, audience: ['agent:worker:1'] });
  });

  it('rejects a direct interrupt without a current turn authority', () => {
    expect(() => createControlCommand({
      channelId: 'c0',
      msgType: TYPES.agentInterrupt,
      audience: ['agent:worker:1'],
      payload: {},
    })).toThrowError(expect.objectContaining({ code: 'control_target_invalid' }));
  });

  it.skip('fails closed when a feature waiting fact has no current target authority', () => {
    expect(() => createControlCommand({
      channelId: 'c0', msgType: TYPES.agentInterrupt, audience: ['agent:worker:1'], payload: {},
      controlContext: { source: CONTROL_COMMAND_SOURCE.feature, turn: TURN },
    })).toThrowError(expect.objectContaining({ code: 'control_authority_stale' }));
  });

  it.skip('fails closed for stale authority, terminal echo, and missing capability', () => {
    expect(() => createControlCommand({
      channelId: 'c0', msgType: TYPES.agentInterrupt, audience: ['agent:worker:1'], payload: {},
      controlContext: { source: CONTROL_COMMAND_SOURCE.timeline, turn: TURN, targetAuthority: { current: false, actorIDs: new Set(['agent:worker:1']) } },
    })).toThrowError(expect.objectContaining({ code: 'control_authority_stale' }));

    const terminal = { ...TURN, terminal: { id: 'terminal-1' } };
    expect(() => createControlCommand({
      channelId: 'c0', msgType: TYPES.agentInterrupt, audience: ['agent:worker:1'], payload: {},
      controlContext: { source: CONTROL_COMMAND_SOURCE.timeline, turn: terminal, targetAuthority: AUTHORITY },
    })).toThrowError(expect.objectContaining({ code: 'control_target_closed' }));

    const unsupported = { ...TURN, provisional: [{
      seq: 9,
      envelope: { payload: { body: { status: 'processing', controls: [] } } },
    }] };
    expect(() => createControlCommand({
      channelId: 'c0', msgType: TYPES.agentInterrupt, audience: ['agent:worker:1'], payload: {},
      controlContext: { source: CONTROL_COMMAND_SOURCE.timeline, turn: unsupported, targetAuthority: AUTHORITY },
    })).toThrowError(expect.objectContaining({ code: 'control_capability_missing' }));
  });
});
