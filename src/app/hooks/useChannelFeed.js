import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createChannelFeedRuntime,
  HISTORY_RESERVOIR_SIZE,
} from '../../model/channel-feed-runtime.js';

export { HISTORY_RESERVOIR_SIZE };

// React owns only the subscription and commit lifecycle. Cache, cursors,
// hydration, Replica and HistoryScheduler are one ChannelFeedRuntime lifetime.
export function useChannelFeed(options) {
  const runtimeRef = useRef(null);
  if (runtimeRef.current === null) runtimeRef.current = createChannelFeedRuntime(options);
  const runtime = runtimeRef.current;
  const runtimeSnapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useLayoutEffect(() => runtime.bind(options), [runtime, options]);
  useEffect(() => runtime.mount(), [runtime]);

  return useMemo(
    () => runtime.getOwnerSnapshot(options.ownerToken ?? null, runtimeSnapshot),
    [options.ownerToken, runtime, runtimeSnapshot],
  );
}
