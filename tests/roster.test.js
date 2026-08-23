import { describe, expect, it } from 'vitest';
import { createRoster } from '../src/model/roster.js';


const observation = {
  items: [{
    key: 'human:root',
    declared: { id: 'human:root', kind: 'human', name: 'Root' },
    actual: { measures: [
      { name: 'bound', value: true, unknown: false },
      { name: 'device_online', value: null, unknown: true },
    ] },
  }],
};

describe('roster self fallback', () => {
  it('does not mistake a missing principal field for the current human', async () => {
    const roster = createRoster({
      obs: { channelActors: async () => observation },
      me: '',

    });
    await roster.refresh('c0');
    expect(roster.self('c0')).toBe('');
    roster.close();
  });

  it('learns and persists self by matching receipt message id to feed sender', () => {
    const roster = createRoster({
      obs: { channelActors: async () => observation },
      me: 'principal-root',

    });
    roster.recordSubmission('c0', 'message-1');
    expect(roster.observeFeed('c0', {
      id: 'message-1',
      kind: 'request',
      sender: { kind: 'human', id: 'human:root' },
    })).toBe('human:root');
    expect(roster.self('c0')).toBe('human:root');
    roster.close();
  });
});
