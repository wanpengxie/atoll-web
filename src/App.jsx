import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCursors, unreadCount } from './model/cursors.js';
import { apply, createChannelState, reconcileApprovals } from './model/fold.js';
import { createRoster } from './model/roster.js';
import { createIdentityClient } from './net/identity.js';
import { createObsClient, ObsError } from './net/obs.js';
import { createWire } from './net/wire.js';
import { Auth } from './ui/Auth.jsx';
import { ChannelList } from './ui/ChannelList.jsx';
import { Composer } from './ui/Composer.jsx';
import { Roster } from './ui/Roster.jsx';
import { Timeline } from './ui/Timeline.jsx';

const PRINCIPAL_KEY = 'atoll.principal';
const FEED_BATCH_SIZE = 250;

function savedPrincipal() {
  try {
    return JSON.parse(localStorage.getItem(PRINCIPAL_KEY) || 'null');
  } catch {
    return null;
  }
}

function displayError(error) {
  if (error instanceof ObsError && error.status === 503) return '频道未在服务';
  return error?.detail || error?.message || String(error);
}

async function loadChannelTree(obs) {
  const found = new Map();
  const queue = [undefined];
  const expanded = new Set();
  while (queue.length) {
    const parentId = queue.shift();
    const marker = parentId || '__root__';
    if (expanded.has(marker)) continue;
    expanded.add(marker);
    const observation = await obs.spaceChannels(parentId);
    for (const item of observation.items || []) {
      const row = item.declared || {};
      if (row.status !== 'present' || !row.id) continue;
      found.set(row.id, row);
      if (!expanded.has(row.id)) queue.push(row.id);
    }
  }
  return found;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState(null);
  const [channels, setChannels] = useState(new Map());
  const [activeChannelId, setActiveChannelId] = useState('');
  const [wireState, setWireState] = useState('closed');
  const [topError, setTopError] = useState('');
  const [feedVersion, setFeedVersion] = useState(0);
  const [rosters, setRosters] = useState(new Map());
  const [rosterBusy, setRosterBusy] = useState(false);
  const [pending, setPending] = useState([]);
  const [approvalStates, setApprovalStates] = useState({});

  const identityRef = useRef(createIdentityClient());
  const obsRef = useRef(null);
  const wireRef = useRef(null);
  const rosterRef = useRef(null);
  const cursorsRef = useRef(createCursors());
  const channelStatesRef = useRef(new Map());
  const feedQueueRef = useRef([]);
  const feedTaskRef = useRef(null);
  const activeChannelRef = useRef('');
  const pendingTimersRef = useRef(new Map());

  useEffect(() => {
    activeChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  const expireSession = useCallback(() => {
    wireRef.current?.close();
    wireRef.current = null;
    channelStatesRef.current = new Map();
    feedQueueRef.current = [];
    setChannels(new Map());
    setActiveChannelId('');
    setPending([]);
    setRosters(new Map());
    setMe(null);
    setBooting(false);
    setWireState('closed');
  }, []);

  useEffect(() => {
    let alive = true;
    const obs = createObsClient();
    (async () => {
      try {
        const principals = await obs.spacePrincipals();
        if (!alive) return;
        const saved = savedPrincipal();
        const row = (principals.items || [])
          .map((item) => item.declared || {})
          .find((item) => item.id === saved?.id);
        setMe(saved ? { ...saved, ...row } : { id: '', display_name: '已登录用户' });
      } catch (error) {
        if (alive && error?.status !== 401) setTopError(displayError(error));
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const cancelFeedTask = useCallback(() => {
    if (feedTaskRef.current == null) return;
    if ('cancelIdleCallback' in window) window.cancelIdleCallback(feedTaskRef.current);
    else clearTimeout(feedTaskRef.current);
    feedTaskRef.current = null;
  }, []);

  const processFeed = useCallback(() => {
    feedTaskRef.current = null;
    const batch = feedQueueRef.current.splice(0, FEED_BATCH_SIZE);
    if (!batch.length) return;
    let rosterChanged = false;
    const unseenChannels = new Set();
    const landedMessageIds = new Set();
    for (const row of batch) {
      let state = channelStatesRef.current.get(row.channel_id);
      if (!state) {
        state = createChannelState(row.channel_id);
        channelStatesRef.current.set(row.channel_id, state);
      }
      const roster = rosterRef.current;
      const selfId = roster?.self(row.channel_id) || '';
      apply(state, row, selfId);
      cursorsRef.current.advance(row.channel_id, row.seq);
      if (activeChannelRef.current === row.channel_id) {
        cursorsRef.current.markRead(row.channel_id, row.seq);
      }

      const learnedSelf = roster?.observeFeed(row.channel_id, row.envelope);
      if (learnedSelf) {
        reconcileApprovals(state, learnedSelf);
        rosterChanged = true;
      }
      roster?.handleEnvelope(row.channel_id, row.envelope, (rows, error) => {
        if (rows) setRosters((current) => new Map(current).set(row.channel_id, rows));
        if (error) setTopError(displayError(error));
      });

      unseenChannels.add(row.channel_id);
      if (row.envelope?.id) landedMessageIds.add(row.envelope.id);
    }
    setChannels((current) => {
      const missing = [...unseenChannels].filter((channelId) => !current.has(channelId));
      if (!missing.length) return current;
      const next = new Map(current);
      for (const channelId of missing) {
        next.set(channelId, { id: channelId, name: channelId.slice(0, 8), status: 'present' });
      }
      return next;
    });
    if (landedMessageIds.size) {
      setPending((current) => {
        const landed = current.filter((item) => item.messageId && landedMessageIds.has(item.messageId));
        if (!landed.length) return current;
        for (const item of landed) {
          const timer = pendingTimersRef.current.get(item.key);
          if (timer) clearTimeout(timer);
          pendingTimersRef.current.delete(item.key);
        }
        return current.filter((item) => !item.messageId || !landedMessageIds.has(item.messageId));
      });
    }
    setFeedVersion((value) => value + 1 + Number(rosterChanged));
    if (feedQueueRef.current.length) {
      const run = () => processFeed();
      feedTaskRef.current = 'requestIdleCallback' in window
        ? window.requestIdleCallback(run, { timeout: 100 })
        : setTimeout(run, 0);
    }
  }, []);

  const enqueueFeed = useCallback((channelId, seq, envelope) => {
    feedQueueRef.current.push({ channel_id: channelId, seq, envelope });
    if (feedTaskRef.current != null) return;
    const run = () => processFeed();
    feedTaskRef.current = 'requestIdleCallback' in window
      ? window.requestIdleCallback(run, { timeout: 100 })
      : setTimeout(run, 0);
  }, [processFeed]);

  useEffect(() => {
    if (!me) return undefined;
    setTopError('');
    const obs = createObsClient({ onUnauthorized: expireSession });
    const roster = createRoster({ obs, me: me.id });
    obsRef.current = obs;
    rosterRef.current = roster;

    let alive = true;
    loadChannelTree(obs)
      .then((result) => {
        if (!alive) return;
        setChannels((current) => new Map([...current, ...result]));
      })
      .catch((error) => { if (alive && error?.status !== 401) setTopError(displayError(error)); });

    setWireState('connecting');
    const wire = createWire({
      since: () => cursorsRef.current.snapshot(),
      onFeed: enqueueFeed,
      onError: (error) => setTopError(`${error.code}: ${displayError(error)}`),
      onObserveEnded: (channelId, reason) => setTopError(`${channelId} 旁听已结束：${reason}`),
      onState: (state) => {
        if (state === 'attached') setWireState('open');
        else if (state === 'reconnecting') setWireState('reconnecting');
        else if (state === 'closed') setWireState('closed');
        else if (state === 'open') setWireState((current) => current === 'open' ? current : 'connecting');
      },
    });
    wireRef.current = wire;

    return () => {
      alive = false;
      wire.close();
      roster.close();
      cancelFeedTask();
      obsRef.current = null;
      rosterRef.current = null;
      wireRef.current = null;
    };
  }, [cancelFeedTask, enqueueFeed, expireSession, me]);

  const channelList = useMemo(
    () => [...channels.values()].sort((left, right) => {
      if (left.id === 'c0') return -1;
      if (right.id === 'c0') return 1;
      return (left.qualified_name || left.name || left.id).localeCompare(right.qualified_name || right.name || right.id);
    }),
    [channels],
  );

  useEffect(() => {
    if (!activeChannelId && channelList.length) setActiveChannelId(channelList[0].id);
  }, [activeChannelId, channelList]);

  const refreshRoster = useCallback(async (channelId, force = false) => {
    if (!channelId || !rosterRef.current) return;
    setRosterBusy(true);
    try {
      const rows = force
        ? await rosterRef.current.refresh(channelId)
        : await rosterRef.current.ensure(channelId);
      setRosters((current) => new Map(current).set(channelId, rows));
      const selfId = rosterRef.current.self(channelId);
      const state = channelStatesRef.current.get(channelId);
      if (state && selfId) {
        reconcileApprovals(state, selfId);
        setFeedVersion((value) => value + 1);
      }
    } catch (error) {
      if (error?.status !== 401) setTopError(displayError(error));
    } finally {
      setRosterBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!activeChannelId || !me) return;
    refreshRoster(activeChannelId);
  }, [activeChannelId, me, refreshRoster]);

  useEffect(() => {
    if (!activeChannelId) return;
    const lastSeq = channelStatesRef.current.get(activeChannelId)?.lastSeq || 0;
    cursorsRef.current.markRead(activeChannelId, lastSeq);
  }, [activeChannelId, feedVersion]);

  const selectChannel = useCallback((channelId) => {
    setActiveChannelId(channelId);
    const lastSeq = channelStatesRef.current.get(channelId)?.lastSeq || 0;
    cursorsRef.current.markRead(channelId, lastSeq);
  }, []);

  const handleAuthed = useCallback((principal) => {
    const value = { id: principal.id, display_name: principal.display_name || '' };
    localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(value));
    setMe(value);
  }, []);

  const handleLogout = useCallback(async () => {
    try { await identityRef.current.logout(); } catch { /* local logout still wins */ }
    expireSession();
  }, [expireSession]);

  const handleSend = useCallback(async ({ text, msgType, audience, targetLabel, payload }) => {
    if (!activeChannelId || !wireRef.current) return;
    const key = crypto.randomUUID();
    const placeholder = { key, channelId: activeChannelId, text, targetLabel, state: 'sending' };
    setPending((current) => [...current, placeholder]);
    try {
      const receipt = await wireRef.current.submit({
        channel_id: activeChannelId,
        msg_type: msgType,
        kind: 'request',
        payload: payload || { text },
        audience,
        visibility: 'public',
      });
      rosterRef.current?.recordSubmission(activeChannelId, receipt.message_id);
      const state = channelStatesRef.current.get(activeChannelId);
      const landedEnvelope = state
        ? [...state.rows.values()].find((envelope) => envelope.id === receipt.message_id)
        : null;
      if (landedEnvelope) {
        const learnedSelf = rosterRef.current?.observeFeed(activeChannelId, landedEnvelope);
        if (learnedSelf) reconcileApprovals(state, learnedSelf);
        setPending((current) => current.filter((item) => item.key !== key));
        setFeedVersion((value) => value + 1);
        return;
      }
      setPending((current) => current.map((item) => item.key === key
        ? { ...item, state: 'accepted', messageId: receipt.message_id }
        : item));
      const timer = setTimeout(() => {
        setPending((current) => current.map((item) => item.key === key && item.state === 'accepted'
          ? { ...item, state: 'delayed' }
          : item));
      }, 10_000);
      pendingTimersRef.current.set(key, timer);
    } catch (error) {
      setPending((current) => current.map((item) => item.key === key
        ? { ...item, state: 'error', error }
        : item));
    }
  }, [activeChannelId]);

  const handleResolve = useCallback(async (reqId, decision) => {
    setApprovalStates((current) => ({ ...current, [reqId]: 'sending' }));
    try {
      await wireRef.current.resolve({ channel_id: activeChannelId, req_id: reqId, decision });
      setApprovalStates((current) => ({ ...current, [reqId]: 'resolved' }));
    } catch (error) {
      setApprovalStates((current) => ({ ...current, [reqId]: { error } }));
    }
  }, [activeChannelId]);

  useEffect(() => () => {
    for (const timer of pendingTimersRef.current.values()) clearTimeout(timer);
  }, []);

  if (booting) return <div className="boot-screen"><span className="brand-dot" />正在恢复会话…</div>;
  if (!me) return <Auth identity={identityRef.current} onAuthed={handleAuthed} />;

  const activeState = channelStatesRef.current.get(activeChannelId) || createChannelState(activeChannelId);
  const activeRoster = rosters.get(activeChannelId) || [];
  const selfId = rosterRef.current?.self(activeChannelId) || '';
  const unread = Object.fromEntries(channelList.map((channel) => [
    channel.id,
    unreadCount(
      channelStatesRef.current.get(channel.id),
      cursorsRef.current.read(channel.id),
      rosterRef.current?.self(channel.id) || '',
    ),
  ]));
  const activeChannel = channels.get(activeChannelId);

  return (
    <div className="shell">
      <ChannelList
        channels={channelList}
        activeChannelId={activeChannelId}
        unread={unread}
        wireState={wireState}
        me={me}
        onSelect={selectChannel}
        onLogout={handleLogout}
      />
      <main className="workspace">
        <header className="channel-header">
          <div>
            <p className="eyebrow">频道账本</p>
            <h1>{activeChannel?.qualified_name || activeChannel?.name || activeChannelId || '选择频道'}</h1>
          </div>
          <span className="seq-label">SEQ {activeState.lastSeq}</span>
        </header>
        {topError && (
          <div className="top-error" role="alert">
            <span>{topError}</span>
            <button type="button" onClick={() => setTopError('')} aria-label="关闭错误">×</button>
          </div>
        )}
        <Timeline
          state={activeState}
          roster={activeRoster}
          selfId={selfId}
          pending={pending.filter((item) => item.channelId === activeChannelId)}
          approvalStates={approvalStates}
          onResolve={handleResolve}
        />
        <Composer
          channelId={activeChannelId}
          roster={activeRoster}
          selfId={selfId}
          disabled={wireState !== 'open'}
          onSend={handleSend}
        />
      </main>
      <Roster
        rows={activeRoster}
        selfId={selfId}
        busy={rosterBusy}
        onRefresh={() => refreshRoster(activeChannelId, true)}
      />
    </div>
  );
}
