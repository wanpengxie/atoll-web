import { useCallback, useEffect, useRef, useState } from 'react';
import { createCursors } from '../../model/cursors.js';
import { createFeedCache, resumeSnapshot } from '../../model/feed-cache.js';
import { apply, createChannelState, reconcileApprovals } from '../../model/fold.js';

const BATCH_SIZE = 250;

export function useChannelFeed({ rosterRef, accessRef, activeChannelRef, onRoster, onError, onChannelsDiscovered, onTimerFired, onSubmissionFeed, onAccessChanged }) {
  const [version, setVersion] = useState(0);
  const cursorsRef = useRef(createCursors());
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = createFeedCache();
  const statesRef = useRef(null);
  if (statesRef.current === null) {
    statesRef.current = cacheRef.current.restore();
    cursorsRef.current.reconcile(resumeSnapshot(statesRef.current));
  }
  const queueRef = useRef([]);
  const dirtyRef = useRef(new Set());
  const taskRef = useRef(null);

  const cancel = useCallback(() => {
    if (taskRef.current == null) return;
    if ('cancelIdleCallback' in window) window.cancelIdleCallback(taskRef.current);
    else clearTimeout(taskRef.current);
    taskRef.current = null;
  }, []);

  const process = useCallback(() => {
    taskRef.current = null;
    const batch = queueRef.current.splice(0, BATCH_SIZE);
    if (!batch.length) return;
    let rosterChanged = false;
    const unseenChannels = new Set();
    const landedMessageIds = new Set();
    const closedRequestIds = new Set();
    for (const row of batch) {
      let state = statesRef.current.get(row.channel_id);
      if (!state) {
        state = createChannelState(row.channel_id);
        statesRef.current.set(row.channel_id, state);
      }
      const roster = rosterRef.current;
      const selfId = roster?.self(row.channel_id) || '';
      apply(state, row, selfId);
      accessRef.current?.feed(row.channel_id);
      dirtyRef.current.add(row.channel_id);
      cursorsRef.current.advance(row.channel_id, row.seq);
      if (activeChannelRef.current === row.channel_id) cursorsRef.current.markRead(row.channel_id, row.seq);
      const learnedSelf = roster?.observeFeed(row.channel_id, row.envelope);
      if (learnedSelf) {
        reconcileApprovals(state, learnedSelf);
        accessRef.current?.self(row.channel_id, learnedSelf);
        rosterChanged = true;
      }
      roster?.handleEnvelope(row.channel_id, row.envelope, (rows, error) => {
        if (rows) onRoster(row.channel_id, rows);
        if (error) onError(error);
      });
      unseenChannels.add(row.channel_id);
      if (row.envelope?.id) {
        landedMessageIds.add(row.envelope.id);
        onTimerFired(row.envelope.id, row.envelope.ts || Date.now());
      }
      if (row.envelope?.kind === 'response' && ['completed', 'failed'].includes(row.envelope?.payload?.status) && row.envelope?.parent_id) closedRequestIds.add(`${row.channel_id}:${row.envelope.parent_id}:cancel`);
    }
    onChannelsDiscovered(unseenChannels);
    onSubmissionFeed(landedMessageIds, closedRequestIds);
    onAccessChanged();
    setVersion((value) => value + 1 + Number(rosterChanged));
    if (queueRef.current.length) {
      const run = () => process();
      taskRef.current = 'requestIdleCallback' in window ? window.requestIdleCallback(run, { timeout: 100 }) : setTimeout(run, 0);
    } else {
      for (const channelId of dirtyRef.current) cacheRef.current.save(statesRef.current.get(channelId));
      dirtyRef.current.clear();
    }
  }, [accessRef, activeChannelRef, onAccessChanged, onChannelsDiscovered, onError, onRoster, onSubmissionFeed, onTimerFired, rosterRef]);

  const enqueue = useCallback((channelId, seq, envelope) => {
    queueRef.current.push({ channel_id: channelId, seq, envelope });
    if (taskRef.current != null) return;
    const run = () => process();
    taskRef.current = 'requestIdleCallback' in window ? window.requestIdleCallback(run, { timeout: 100 }) : setTimeout(run, 0);
  }, [process]);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const clear = useCallback(() => {
    cancel();
    statesRef.current = new Map();
    queueRef.current = [];
    dirtyRef.current.clear();
    setVersion((value) => value + 1);
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  return { statesRef, cursorsRef, version, bump, enqueue, cancel, clear };
}
