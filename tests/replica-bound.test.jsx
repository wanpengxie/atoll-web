// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function options() {
  return {
    wireRef: { current: { historyBefore: vi.fn(() => new Promise(() => {})), cancelHistory: vi.fn(async () => undefined) } },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(), onError: vi.fn(), onChannelsDiscovered: vi.fn(), onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(), onSubmissionFeed: vi.fn(), onAccessChanged: vi.fn(), onAgentActivity: vi.fn(),
  };
}
const envelope = (seq) => ({ id: `row-${seq}`, kind: 'event', type: 'human.note', payload: { body: { text: `row ${seq}` } } });

describe('a desktop page holds a bounded window per channel', () => {
  it('keeps at most 5000 rows of a channel; what is cut is older history again', async () => {
    const runtime = createChannelFeedRuntime(options());
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([{ channel_id: 'c0', head_seq: 0, has_rows: true }],
      { generation: 1, boot: 'bound-boot', focus: 'c0' });
    for (let seq = 1; seq <= 5_001; seq += 1) {
      snapshot.enqueue({ channel_id: 'c0', seq, source: 'live', generation: 1, envelope: envelope(seq) });
    }
    const seqs = [...runtime.getSnapshot().stateFor('c0').rows.keys()].sort((a, b) => a - b);
    expect(seqs).toHaveLength(4_500);
    expect(seqs.at(-1)).toBe(5_001);
    const history = runtime.getSnapshot().historyFor('c0');
    expect(history.hasOlder).toBe(true);
    expect(history.beforeSeq).toBe(seqs[0]);
    runtime.destroy();
  });
});
