import { describe, expect, it, vi } from 'vitest';
import { createReadingNavigationCoordinator } from '../src/ui/timeline/reading-navigation-coordinator.js';

function harness() {
  vi.useFakeTimers();
  let at = 0;
  let generation = 0;
  const events = [];
  const coordinator = createReadingNavigationCoordinator({
    activationID: 'activation:a',
    now: () => at,
    onBegin: (transaction) => {
      events.push(['begin', transaction]);
      return { inputGeneration: ++generation };
    },
    onUpdate: (transaction, reason) => events.push(['update', reason, transaction]),
    onEnd: (transaction, reason) => events.push(['end', reason, transaction]),
    onCancel: (transaction, reason) => events.push(['cancel', reason, transaction]),
  });
  return {
    coordinator,
    events,
    advance(milliseconds) {
      at += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    },
  };
}

describe('reading navigation transaction coordinator', () => {
  it('groups a wheel burst into one generation and ends through the quiet fallback', () => {
    const h = harness();
    const input = (direction = 'older') => h.coordinator.recordInput({
      source: 'wheel', hostRole: 'following', direction, activationID: 'activation:a',
    });
    input();
    h.advance(60);
    input();
    h.advance(60);
    h.coordinator.recordScroll({
      hostRole: 'following', activationID: 'activation:a', direction: 'older', bookmark: { messageID: 'm2' },
    });
    expect(h.events.filter(([type]) => type === 'begin')).toHaveLength(1);
    h.advance(119);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(0);
    h.advance(1);
    expect(h.events.filter(([type]) => type === 'end')).toEqual([
      ['end', 'quiet-deadline', expect.objectContaining({ inputGeneration: 1, latestBookmark: { messageID: 'm2' } })],
    ]);
  });

  it('does not keep later wheel bursts in the old generation', () => {
    const h = harness();
    h.coordinator.recordInput({ source: 'wheel', hostRole: 'browsing', direction: 'older' });
    h.advance(121);
    h.coordinator.recordInput({ source: 'wheel', hostRole: 'browsing', direction: 'older' });
    expect(h.events.filter(([type]) => type === 'begin').map(([, value]) => value.id))
      .toEqual(['navigation:1', 'navigation:2']);
  });

  it('releases a settled top lease before the next native wheel', () => {
    const h = harness();
    const host = { activationID: 'activation:a', hostRole: 'browsing', hostToken: 'timeline' };
    const first = h.coordinator.recordInput({
      ...host, source: 'wheel', direction: 'older',
    });
    expect(h.coordinator.settle({
      ...host, gestureID: 'navigation:stale', inputEpoch: first.inputGeneration,
    })).toBe(false);
    expect(h.coordinator.settle({
      ...host, gestureID: first.id, inputEpoch: first.inputGeneration,
    })).toBe(true);
    expect(h.events).toContainEqual([
      'end', 'semantic-settled', expect.objectContaining({ id: 'navigation:1', inputGeneration: 1 }),
    ]);

    const second = h.coordinator.recordInput({
      ...host, source: 'wheel', direction: 'older',
    });
    expect(second.id).toBe('navigation:2');
    expect(second.inputGeneration).toBe(2);
    expect(h.events.filter(([type]) => type === 'begin')).toHaveLength(2);
  });

  it('uses native scrollend as an early wheel completion signal', () => {
    const h = harness();
    h.coordinator.recordInput({ source: 'wheel', hostRole: 'browsing', direction: 'older' });
    expect(h.coordinator.recordScrollEnd({ hostRole: 'browsing' })).toBe(true);
    expect(h.events.find(([type]) => type === 'end')).toEqual([
      'end', 'native-scrollend', expect.objectContaining({ inputGeneration: 1 }),
    ]);
    h.advance(200);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(1);
  });

  it('keeps touch momentum in one generation until scrollend or quiet after touchend', () => {
    const h = harness();
    h.coordinator.beginPotential({ source: 'touch', sourceID: 7, hostRole: 'following' });
    h.advance(80);
    h.coordinator.recordInput({ source: 'touch', sourceID: 7, hostRole: 'following', direction: 'older' });
    h.advance(30);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(0);
    h.coordinator.endContact({ source: 'touch', sourceID: 7, hostRole: 'following' });
    h.advance(60);
    h.coordinator.recordScroll({ hostRole: 'following', direction: 'older', bookmark: { messageID: 'after-inertia' } });
    h.advance(99);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(0);
    expect(h.coordinator.recordScrollEnd({ hostRole: 'following' })).toBe(true);
    expect(h.events.filter(([type]) => type === 'begin')).toHaveLength(1);
    expect(h.events.find(([type]) => type === 'end')).toEqual([
      'end', 'native-scrollend', expect.objectContaining({ latestBookmark: { messageID: 'after-inertia' } }),
    ]);
  });

  it('ends an unsupported-scrollend touch after bounded quiet and ends a zero-motion cancel explicitly', () => {
    const h = harness();
    h.coordinator.beginPotential({ source: 'touch', sourceID: 1, hostRole: 'following' });
    h.coordinator.recordInput({ source: 'touch', sourceID: 1, hostRole: 'following', direction: 'older' });
    h.coordinator.endContact({ source: 'touch', sourceID: 1, hostRole: 'following' });
    h.advance(100);
    expect(h.events.find(([type]) => type === 'end')?.[1]).toBe('quiet-deadline');

    h.coordinator.beginPotential({ source: 'touch', sourceID: 2, hostRole: 'following' });
    expect(h.coordinator.cancelContact({ source: 'touch', sourceID: 2, hostRole: 'following' })).toBe(true);
    expect(h.coordinator.getSnapshot().transaction).toBeNull();

    h.coordinator.beginPotential({ source: 'touch', sourceID: 3, hostRole: 'following' });
    h.coordinator.recordInput({ source: 'touch', sourceID: 3, hostRole: 'following', direction: 'older' });
    expect(h.coordinator.cancelContact({ source: 'touch', sourceID: 3, hostRole: 'following' })).toBe(true);
    expect(h.events.at(-1)).toEqual([
      'cancel', 'contact-cancel', expect.objectContaining({ inputGeneration: 2 }),
    ]);
  });

  it('groups key repeat until keyup but splits a different navigation key', () => {
    const h = harness();
    h.coordinator.recordInput({ source: 'key', sourceID: 'ArrowUp', hostRole: 'browsing', direction: 'older' });
    h.advance(500);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(0);
    h.coordinator.recordInput({ source: 'key', sourceID: 'ArrowUp', hostRole: 'browsing', direction: 'older' });
    expect(h.events.filter(([type]) => type === 'begin')).toHaveLength(1);
    h.coordinator.recordInput({ source: 'key', sourceID: 'PageUp', hostRole: 'browsing', direction: 'older' });
    expect(h.events.filter(([type]) => type === 'begin')).toHaveLength(2);
    expect(h.events.find(([type, reason]) => type === 'end' && reason === 'superseded-input')).toBeTruthy();
    h.coordinator.endContact({ source: 'key', sourceID: 'PageUp', hostRole: 'browsing' });
    h.advance(80);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(2);
  });

  it('updates a direction reversal without minting another generation', () => {
    const h = harness();
    h.coordinator.recordInput({ source: 'wheel', hostRole: 'browsing', direction: 'older' });
    h.coordinator.recordInput({ source: 'wheel', hostRole: 'browsing', direction: 'newer' });
    expect(h.events.filter(([type]) => type === 'begin')).toHaveLength(1);
    expect(h.events.some(([type, reason, value]) => (
      type === 'update' && reason === 'direction-change' && value.direction === 'newer'
    ))).toBe(true);
  });

  it('cancels an old activation and prevents its deadline from publishing an end', () => {
    const h = harness();
    h.coordinator.recordInput({ source: 'wheel', hostRole: 'following', direction: 'older' });
    expect(h.coordinator.replaceActivation('activation:b')).toBe(true);
    h.advance(200);
    expect(h.events.filter(([type]) => type === 'cancel')).toEqual([
      ['cancel', 'activation-replaced', expect.objectContaining({ activationID: 'activation:a' })],
    ]);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(0);
  });

  it('rejects events from a replacement host with the same semantic role', () => {
    const h = harness();
    h.coordinator.recordInput({
      source: 'wheel', hostRole: 'browsing', hostToken: 1, direction: 'older',
    });
    expect(h.coordinator.recordScroll({
      hostRole: 'browsing', hostToken: 2, direction: 'older',
    })).toBeNull();
    expect(h.coordinator.recordScroll({
      hostRole: 'browsing', hostToken: 1, direction: 'older',
    })).toMatchObject({ inputGeneration: 1, hostToken: 1 });
  });

  it('settles a pointer transaction through its cancellable quiet fallback', () => {
    const h = harness();
    h.coordinator.beginPotential({ source: 'scrollbar', sourceID: 9, hostRole: 'browsing' });
    h.coordinator.recordInput({
      source: 'scrollbar', sourceID: 9, hostRole: 'browsing', direction: 'browse', canFollowTail: true,
    });
    h.advance(500);
    expect(h.events.filter(([type]) => type === 'end')).toHaveLength(0);
    h.coordinator.endContact({ source: 'scrollbar', sourceID: 9, hostRole: 'browsing' });
    h.advance(100);
    expect(h.events.find(([type]) => type === 'end')).toEqual([
      'end', 'quiet-deadline', expect.objectContaining({ sourceID: '9', canFollowTail: true }),
    ]);
  });
});
