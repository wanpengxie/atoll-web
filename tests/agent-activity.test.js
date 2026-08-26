import { describe, expect, it, vi } from 'vitest';
import { agentActivityDuration, createAgentActivityTracker } from '../src/model/agent-activity.js';

function row({ source = 'live', generation = 1, channelId = 'c0', requestId = 'req-1', agentId = 'agent:codex:1', status = 'processing', ts = 1_000, type = 'agent.ask', process } = {}) {
  return {
    source,
    generation,
    channel_id: channelId,
    seq: ts,
    envelope: {
      id: `${requestId}-${status}-${ts}`,
      channel_id: channelId,
      kind: 'response',
      type,
      parent_id: requestId,
      sender: { id: agentId, kind: 'agent' },
      ts,
      payload: { status, ...(process ? { process } : {}) },
    },
  };
}

describe('connection-scoped Agent activity', () => {
  it('is created only by current-generation live processing and settles on terminal', () => {
    const onChange = vi.fn();
    const tracker = createAgentActivityTracker({ onChange });
    tracker.attach({ boot: 'boot-a', generation: 1 });

    expect(tracker.observe(row({ source: 'history' }))).toBe(false);
    expect(tracker.snapshot().byChannel).toEqual({});
    expect(tracker.observe(row({ generation: 0 }))).toBe(false);

    expect(tracker.observe(row({ process: { kind: 'turn', phase: 'started' } }))).toBe(true);
    expect(tracker.snapshot().byChannel.c0.active).toEqual([
      expect.objectContaining({ requestId: 'req-1', agentId: 'agent:codex:1', startedAt: 1_000 }),
    ]);

    tracker.observe(row({ status: 'completed', ts: 4_000 }));
    const settled = tracker.snapshot().byChannel.c0;
    expect(settled.active).toEqual([]);
    expect(settled.agents['agent:codex:1']).toEqual({ active: 0, settled: 1, state: 'settled' });
    expect(tracker.acknowledge('c0', 'agent:codex:1')).toBe(true);
    expect(tracker.snapshot().byChannel).toEqual({});
  });

  it('hides old-generation work after reconnect until live progress confirms it', () => {
    const tracker = createAgentActivityTracker();
    tracker.attach({ boot: 'boot-a', generation: 1 });
    tracker.observe(row());
    tracker.disconnect();
    expect(tracker.snapshot().byChannel).toEqual({});

    tracker.attach({ boot: 'boot-a', generation: 2 });
    expect(tracker.snapshot().byChannel).toEqual({});
    // Historical provisional state is not liveness evidence.
    tracker.observe(row({ source: 'history', generation: 2, ts: 2_000 }));
    expect(tracker.snapshot().byChannel).toEqual({});
    tracker.observe(row({ generation: 2, ts: 3_000 }));
    expect(tracker.snapshot().byChannel.c0.active).toHaveLength(1);
  });

  it('lets history close retained work but never resurrect it, and clears on boot change', () => {
    const tracker = createAgentActivityTracker();
    tracker.attach({ boot: 'boot-a', generation: 1 });
    tracker.observe(row());
    tracker.disconnect();
    tracker.attach({ boot: 'boot-a', generation: 2 });
    tracker.observe(row({ source: 'history', generation: 2, status: 'failed', ts: 2_000 }));
    expect(tracker.snapshot().byChannel.c0.agents['agent:codex:1'].state).toBe('settled');

    tracker.attach({ boot: 'boot-b', generation: 3 });
    expect(tracker.snapshot().byChannel).toEqual({});
    tracker.observe(row({ source: 'history', generation: 3, ts: 3_000 }));
    expect(tracker.snapshot().byChannel).toEqual({});
  });

  it('ignores connection housekeeping and formats the shared timer', () => {
    const tracker = createAgentActivityTracker();
    tracker.attach({ boot: 'boot-a', generation: 1 });
    tracker.observe(row({ type: 'agent.context' }));
    expect(tracker.snapshot().byChannel).toEqual({});
    expect(agentActivityDuration(1_000, 66_000)).toBe('01:05');
  });
});
