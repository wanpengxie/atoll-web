import { describe, expect, it } from 'vitest';
import { createSubmissionCorrelationPort } from '../src/ui/composer/submission-correlation-port.js';

const identity = (channelId, messageId) => ({ channelId, messageId });

describe('Composer submission correlation port', () => {
  it('keeps a stable frozen port with channel-scoped pending and landed identities', () => {
    const port = createSubmissionCorrelationPort();
    const first = identity('c0', 'same-id');
    const otherChannel = identity('c1', 'same-id');

    expect(Object.isFrozen(port)).toBe(true);
    expect(port.record(first)).toBe(true);
    expect(port.record(otherChannel)).toBe(true);
    expect(port.pending).toEqual([first, otherChannel]);
    expect(Object.isFrozen(port.pending)).toBe(true);
    expect(port.owns(first)).toBe(true);
    expect(port.owns(identity('c2', 'same-id'))).toBe(false);

    expect(port.markLanded(first)).toBe(true);
    expect(port.pending).toEqual([otherChannel]);
    expect(port.landed).toEqual([first]);
    // A duplicate durable record cannot move a landed identity back to
    // pending, which keeps a feed fact authoritative across retries.
    expect(port.record(first)).toBe(true);
    expect(port.pending).toEqual([otherChannel]);
    expect(port.owns(first)).toBe(true);
  });

  it('forgets exact identities and resets both phases without changing the port', () => {
    const port = createSubmissionCorrelationPort();
    const first = identity('c0', 'm1');
    const second = identity('c0', 'm2');

    expect(port.forget(first)).toBe(false);
    port.record(first);
    port.markLanded(second);
    expect(port.forget(first)).toBe(true);
    expect(port.forget(first)).toBe(false);
    expect(port.owns(first)).toBe(false);
    expect(port.owns(second)).toBe(true);

    port.reset();
    expect(port.pending).toEqual([]);
    expect(port.landed).toEqual([]);
    expect(port.owns(second)).toBe(false);
  });

  it('rejects malformed identities instead of creating an unscoped correlation', () => {
    const port = createSubmissionCorrelationPort();
    for (const value of [null, undefined, {}, { channelId: 'c0' }, { messageId: 'm1' }, ['c0', 'm1']]) {
      expect(port.record(value)).toBe(false);
      expect(port.markLanded(value)).toBe(false);
      expect(port.owns(value)).toBe(false);
      expect(port.forget(value)).toBe(false);
    }
    expect(port.pending).toEqual([]);
    expect(port.landed).toEqual([]);
  });
});
