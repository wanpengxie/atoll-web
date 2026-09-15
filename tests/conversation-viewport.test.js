import { describe, expect, it } from 'vitest';
import { reduceViewportMode, VIEWPORT_EVENT, VIEWPORT_MODE } from '../src/model/conversation-viewport.js';

describe('conversation viewport mode', () => {
  it('models an upward history transaction without geometry', () => {
    let mode = VIEWPORT_MODE.following;
    mode = reduceViewportMode(mode, VIEWPORT_EVENT.userBrowse);
    expect(mode).toBe(VIEWPORT_MODE.browsing);
    mode = reduceViewportMode(mode, VIEWPORT_EVENT.demandStarted);
    expect(mode).toBe(VIEWPORT_MODE.loadingBefore);
    mode = reduceViewportMode(mode, VIEWPORT_EVENT.demandSatisfied);
    expect(mode).toBe(VIEWPORT_MODE.restoring);
    mode = reduceViewportMode(mode, VIEWPORT_EVENT.anchorRestored);
    expect(mode).toBe(VIEWPORT_MODE.browsing);
  });

  it('returns to following only when the reader explicitly reaches the tail', () => {
    expect(reduceViewportMode(VIEWPORT_MODE.loadingBefore, VIEWPORT_EVENT.demandClosed, { followsTail: false }))
      .toBe(VIEWPORT_MODE.browsing);
    expect(reduceViewportMode(VIEWPORT_MODE.loadingBefore, VIEWPORT_EVENT.demandClosed, { followsTail: true }))
      .toBe(VIEWPORT_MODE.following);
    expect(reduceViewportMode(VIEWPORT_MODE.browsing, VIEWPORT_EVENT.tailReached))
      .toBe(VIEWPORT_MODE.following);
    expect(reduceViewportMode(VIEWPORT_MODE.browsing, VIEWPORT_EVENT.jumpLatest))
      .toBe(VIEWPORT_MODE.following);
  });

  it('ignores unknown adapter events', () => {
    expect(reduceViewportMode(VIEWPORT_MODE.restoring, 'row-measured'))
      .toBe(VIEWPORT_MODE.restoring);
  });
});
