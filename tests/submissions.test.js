import { describe, expect, it } from 'vitest';
import { createSubmission, isUncertainWireError, reconcileLanded, restoreSubmissionRecords, restoreSubmissions, saveSubmissions, transitionSubmission } from '../src/model/submissions.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

describe('submission state', () => {
  it('keeps a stable client message id and removes it only when feed lands', () => {
    const item = createSubmission({ id: 'm1', channelId: 'c0', text: 'hi', frame: { id: 'm1' } });
    expect(item).toMatchObject({ key: 'm1', messageId: 'm1', channelId: 'c0', state: 'transmitting' });
    const accepted = transitionSubmission(item, 'accepted');
    expect(transitionSubmission(accepted, 'delayed').state).toBe('delayed');
    expect(reconcileLanded([accepted], new Set(['m1']))).toEqual([]);
  });

  it('restores in-flight transmitting as uncertain and distinguishes definitive rejection', () => {
    const storage = new MemoryStorage();
    const item = createSubmission({ id: 'm1', channelId: 'c0.project', frame: { id: 'm1' } });
    saveSubmissions('root', [item], storage);
    expect(restoreSubmissions('root', storage)[0]).toMatchObject({ channelId: 'c0.project', state: 'uncertain' });
    expect(isUncertainWireError({ code: 'closed' })).toBe(true);
    expect(isUncertainWireError({ code: 'timeout' })).toBe(true);
    expect(isUncertainWireError({ code: 'forbidden' })).toBe(false);
  });

  it('persists a never-transmitted offline submission as queued', () => {
    const storage = new MemoryStorage();
    const item = createSubmission({ id: 'm2', channelId: 'c0', frame: { id: 'm2' }, state: 'queued' });
    saveSubmissions('root', [item], storage);
    expect(restoreSubmissions('root', storage)[0]).toMatchObject({ messageId: 'm2', state: 'queued' });
  });

  it('restores explicit recovery states, clears foreign leases, and never regresses accepted work', () => {
    const rows = ['transmitting', 'uncertain', 'rejected'].map((state, index) => ({
      messageId: `m${index}`,
      channelId: 'c0',
      frame: { id: `m${index}` },
      state,
      leaseOwner: 'dead-tab',
      leaseUntil: 99,
    }));
    expect(restoreSubmissionRecords(rows)).toEqual([
      expect.objectContaining({ messageId: 'm0', state: 'uncertain', leaseOwner: '', leaseUntil: 0 }),
      expect.objectContaining({ messageId: 'm1', state: 'uncertain', leaseOwner: '', leaseUntil: 0 }),
      expect.objectContaining({ messageId: 'm2', state: 'rejected', leaseOwner: '', leaseUntil: 0 }),
    ]);

    const accepted = transitionSubmission({ ...rows[0], state: 'accepted' }, 'queued');
    expect(accepted.state).toBe('accepted');
    expect(transitionSubmission(accepted, 'retry')).toBe(accepted);
  });
});
