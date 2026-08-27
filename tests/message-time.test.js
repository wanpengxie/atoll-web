import { describe, expect, it } from 'vitest';
import { messageTimeLabel } from '../src/util/time.js';

describe('messageTimeLabel', () => {
  const now = new Date(2026, 7, 27, 9, 30).getTime(); // 2026-08-27 09:30 local

  it('shows only the clock for a message from today', () => {
    expect(messageTimeLabel(new Date(2026, 7, 27, 0, 5).getTime(), now)).toBe('00:05');
    expect(messageTimeLabel(new Date(2026, 7, 27, 23, 59).getTime(), now)).toBe('23:59');
  });

  it('adds the day once the message is not from today', () => {
    expect(messageTimeLabel(new Date(2026, 7, 26, 23, 59).getTime(), now)).toBe('8/26 23:59');
    expect(messageTimeLabel(new Date(2026, 0, 3, 8, 0).getTime(), now)).toBe('1/3 08:00');
  });

  it('adds the year once that differs too', () => {
    expect(messageTimeLabel(new Date(2025, 11, 31, 18, 45).getTime(), now)).toBe('2025/12/31 18:45');
  });

  it('is empty without a timestamp', () => {
    expect(messageTimeLabel(0, now)).toBe('');
    expect(messageTimeLabel(undefined, now)).toBe('');
  });
});
