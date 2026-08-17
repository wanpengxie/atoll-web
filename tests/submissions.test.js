import { describe, expect, it } from 'vitest';
import { createSubmission, isUncertainWireError, reconcileLanded, restoreSubmissions, saveSubmissions, transitionSubmission } from '../src/model/submissions.js';

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
});
