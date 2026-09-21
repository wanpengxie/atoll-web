import { describe, expect, it, vi } from 'vitest';
import {
  correlationOf,
  FINAL,
  isTerminal,
  PROVISIONAL,
  visibilityOf,
} from '../src/protocol/envelope.js';

describe('envelope algebra', () => {
  it('[TC-0672][EH02-01] keeps final and provisional status sets disjoint', () => {
    expect([...FINAL]).toEqual(['completed', 'failed']);
    expect([...PROVISIONAL]).toEqual(['received', 'queued', 'processing', 'deferred', 'unavailable']);
    expect([...FINAL].some((status) => PROVISIONAL.has(status))).toBe(false);
  });

  it('only treats final responses as terminal', () => {
    expect(isTerminal({ kind: 'response', payload: { body: { status: 'completed' } } })).toBe(true);
    expect(isTerminal({ kind: 'response', payload: { body: { status: 'failed' } } })).toBe(true);
    expect(isTerminal({ kind: 'response', payload: { body: { status: 'processing' } } })).toBe(false);
    expect(isTerminal({ kind: 'event', payload: { body: { status: 'completed' } } })).toBe(false);
  });

  it('uses correlation_id and falls back to id', () => {
    expect(correlationOf({ id: 'm1', correlation_id: 'turn-1' })).toBe('turn-1');
    expect(correlationOf({ id: 'm1' })).toBe('m1');
  });

  it('shows unknown visibility as public with a warning', () => {
    const warn = vi.fn();
    expect(visibilityOf({ visibility: 'future' }, warn)).toBe('public');
    expect(warn).toHaveBeenCalledOnce();
  });
});
