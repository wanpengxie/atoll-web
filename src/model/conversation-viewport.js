export const VIEWPORT_MODE = Object.freeze({
  following: 'following',
  browsing: 'browsing',
  loadingBefore: 'loading-before',
  restoring: 'restoring',
});

export const VIEWPORT_EVENT = Object.freeze({
  userBrowse: 'user-browse',
  demandStarted: 'demand-started',
  demandSatisfied: 'demand-satisfied',
  demandClosed: 'demand-closed',
  anchorRestored: 'anchor-restored',
  tailReached: 'tail-reached',
  jumpLatest: 'jump-latest',
});

// Pure interaction state. Geometry is deliberately absent: scrollTop and row
// height belong to the render adapter, not to the reader's intent model.
export function reduceViewportMode(mode = VIEWPORT_MODE.following, event, { followsTail = false } = {}) {
  switch (event) {
    case VIEWPORT_EVENT.userBrowse:
      return VIEWPORT_MODE.browsing;
    case VIEWPORT_EVENT.demandStarted:
      return VIEWPORT_MODE.loadingBefore;
    case VIEWPORT_EVENT.demandSatisfied:
      return VIEWPORT_MODE.restoring;
    case VIEWPORT_EVENT.anchorRestored:
      return VIEWPORT_MODE.browsing;
    case VIEWPORT_EVENT.demandClosed:
      return followsTail ? VIEWPORT_MODE.following : VIEWPORT_MODE.browsing;
    case VIEWPORT_EVENT.tailReached:
    case VIEWPORT_EVENT.jumpLatest:
      return VIEWPORT_MODE.following;
    default:
      return mode;
  }
}
