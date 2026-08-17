import { beforeEach, describe, expect, it } from 'vitest';
import { cancelTimerRecord, restoreTimers, saveTimers, timerPayload, timerRecord } from '../src/model/timers.js';

describe('timer model', () => {
  beforeEach(() => {
    const values = new Map();
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
    };
  });
  it('uses the real after field set', () => {
    expect(timerPayload({ channelId: 'c0', durationMs: 1000, msgType: 'human.text', payload: { text: 'hi' } })).toEqual({ channel_id: 'c0', duration_ms: 1000, msg_type: 'human.text', payload: { text: 'hi' } });
    expect(() => timerPayload({ channelId: 'c0', durationMs: 0, msgType: 'x' })).toThrow('正整数');
  });
  it('persists only browser-local timer records and transitions cancellation', () => {
    const row = timerRecord({ timerId: 't1', channelId: 'c0', durationMs: 100, msgType: 'x', createdAt: 10 });
    saveTimers('root', [row]);
    expect(restoreTimers('root')).toEqual([row]);
    expect(cancelTimerRecord([row], 't1')[0]).toMatchObject({ state: 'cancelled' });
  });
});
