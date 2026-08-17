import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { capabilityIndexFromState } from './model/capabilities.js';
import { createControlState, restoreControlStates, saveControlStates } from './model/control-actions.js';
import { createCursors, unreadCount } from './model/cursors.js';
import { canWriteChannel, CHANNEL_ACCESS, createChannelAccessTracker, isMemberAccess } from './model/channel-access.js';
import { createFeedCache, resumeSnapshot } from './model/feed-cache.js';
import { apply, createChannelState, reconcileApprovals } from './model/fold.js';
import { createRoster } from './model/roster.js';
import { readFileTicket } from './model/resources.js';
import { safeDaemonRows } from './model/space-administration.js';
import { createSubmission, isUncertainWireError, reconcileLanded, restoreSubmissions, saveSubmissions, transitionSubmission } from './model/submissions.js';
import { cancelTimerRecord, restoreTimers, saveTimers, timerRecord } from './model/timers.js';
import { createIdentityClient } from './net/identity.js';
import { createObsClient, ObsError } from './net/obs.js';
import { createWire } from './net/wire.js';
import { Auth } from './ui/Auth.jsx';
import { ChannelList } from './ui/ChannelList.jsx';
import { ChannelGovernance } from './ui/ChannelGovernance.jsx';
import { ChannelAutomation } from './ui/ChannelAutomation.jsx';
import { ChannelResources } from './ui/ChannelResources.jsx';
import { Composer } from './ui/Composer.jsx';
import { Roster } from './ui/Roster.jsx';
import { SpaceAdministration } from './ui/SpaceAdministration.jsx';
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
  let complete = true;
  while (queue.length) {
    const parentId = queue.shift();
    const marker = parentId || '__root__';
    if (expanded.has(marker)) continue;
    expanded.add(marker);
    const observation = await obs.spaceChannels(parentId);
    if (observation.complete === false) complete = false;
    for (const item of observation.items || []) {
      const row = item.declared || {};
      if (row.status !== 'present' || !row.id) continue;
      const openMeasure = (item.actual?.measures || []).find((measure) => measure.name === 'open');
      found.set(row.id, { ...row, open: openMeasure?.unknown ? undefined : openMeasure?.value });
      if (!expanded.has(row.id)) queue.push(row.id);
    }
  }
  return { channels: found, complete };
}

const ACCESS_MESSAGE = {
  member_stale: '连接已中断，当前显示本地缓存；恢复连接前不能发送。',
  member_unavailable: '频道暂不可用，历史记录仍可查看。',
  observer_active: '正在只读旁观此频道。',
  observer_stale: '旁观连接已中断，当前显示本地缓存。',
  discoverable: '这是空间中的可发现频道，你当前没有成员访问关系。',
  access_denied: '你的频道访问权限已被撤销，历史缓存仅供本地查看。',
  loading: '正在确认频道访问状态。',
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState(null);
  const [channels, setChannels] = useState(new Map());
  const [accessVersion, setAccessVersion] = useState(0);
  const [activeChannelId, setActiveChannelId] = useState('');
  const [wireState, setWireState] = useState('closed');
  const [topError, setTopError] = useState('');
  const [feedVersion, setFeedVersion] = useState(0);
  const [rosters, setRosters] = useState(new Map());
  const [rosterBusy, setRosterBusy] = useState(false);
  const [pending, setPending] = useState([]);
  const [approvalStates, setApprovalStates] = useState({});
  const [channelNotice, setChannelNotice] = useState('');
  const [selectedActor, setSelectedActor] = useState(null);
  const [controlStates, setControlStates] = useState({});
  const [rightPanel, setRightPanel] = useState('roster');
  const [spacePrincipals, setSpacePrincipals] = useState([]);
  const [spaceDeclarations, setSpaceDeclarations] = useState([]);
  const [spaceDaemons, setSpaceDaemons] = useState([]);
  const [timerRecords, setTimerRecords] = useState([]);
  const [draftAttachments, setDraftAttachments] = useState({});
  const governanceOpen = rightPanel === 'governance';

  const identityRef = useRef(createIdentityClient());
  const obsRef = useRef(null);
  const wireRef = useRef(null);
  const rosterRef = useRef(null);
  const accessRef = useRef(null);
  const cursorsRef = useRef(createCursors());
  const feedCacheRef = useRef(null);
  if (feedCacheRef.current === null) feedCacheRef.current = createFeedCache();
  const channelStatesRef = useRef(null);
  if (channelStatesRef.current === null) {
    channelStatesRef.current = feedCacheRef.current.restore();
    cursorsRef.current.reconcile(resumeSnapshot(channelStatesRef.current));
  }
  const feedQueueRef = useRef([]);
  const feedDirtyRef = useRef(new Set());
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
    accessRef.current = null;
    setActiveChannelId('');
    setPending([]);
    setRosters(new Map());
    setChannelNotice('');
    setSelectedActor(null);
    setControlStates({});
    setRightPanel('roster');
    setSpacePrincipals([]);
    setSpaceDeclarations([]);
    setSpaceDaemons([]);
    setTimerRecords([]);
    setDraftAttachments({});
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
    const closedRequestIds = new Set();
    for (const row of batch) {
      let state = channelStatesRef.current.get(row.channel_id);
      if (!state) {
        state = createChannelState(row.channel_id);
        channelStatesRef.current.set(row.channel_id, state);
      }
      const roster = rosterRef.current;
      const selfId = roster?.self(row.channel_id) || '';
      apply(state, row, selfId);
      accessRef.current?.feed(row.channel_id);
      feedDirtyRef.current.add(row.channel_id);
      cursorsRef.current.advance(row.channel_id, row.seq);
      if (activeChannelRef.current === row.channel_id) {
        cursorsRef.current.markRead(row.channel_id, row.seq);
      }

      const learnedSelf = roster?.observeFeed(row.channel_id, row.envelope);
      if (learnedSelf) {
        reconcileApprovals(state, learnedSelf);
        accessRef.current?.self(row.channel_id, learnedSelf);
        rosterChanged = true;
      }
      roster?.handleEnvelope(row.channel_id, row.envelope, (rows, error) => {
        if (rows) setRosters((current) => new Map(current).set(row.channel_id, rows));
        if (error) setTopError(displayError(error));
      });

      unseenChannels.add(row.channel_id);
      if (row.envelope?.id) landedMessageIds.add(row.envelope.id);
      if (row.envelope?.id) {
        setTimerRecords((current) => current.some((timer) => timer.timerId === row.envelope.id && timer.state === 'scheduled')
          ? current.map((timer) => timer.timerId === row.envelope.id ? { ...timer, state: 'fired', firedAt: row.envelope.ts || Date.now() } : timer)
          : current);
      }
      if (row.envelope?.kind === 'response' && ['completed', 'failed'].includes(row.envelope?.payload?.status) && row.envelope?.parent_id) {
        closedRequestIds.add(`${row.channel_id}:${row.envelope.parent_id}:cancel`);
      }
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
        if (landed.some((item) => item.state === 'uncertain')) {
          setChannelNotice('此前发送结果待确认，现已通过频道账本确认。');
        }
        for (const item of landed) {
          const timer = pendingTimersRef.current.get(item.key);
          if (timer) clearTimeout(timer);
          pendingTimersRef.current.delete(item.key);
        }
        return reconcileLanded(current, landedMessageIds);
      });
    }
    if (closedRequestIds.size) {
      setControlStates((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !closedRequestIds.has(key))));
    }
    setAccessVersion((value) => value + 1);
    setFeedVersion((value) => value + 1 + Number(rosterChanged));
    if (feedQueueRef.current.length) {
      const run = () => processFeed();
      feedTaskRef.current = 'requestIdleCallback' in window
        ? window.requestIdleCallback(run, { timeout: 100 })
        : setTimeout(run, 0);
    } else {
      for (const channelId of feedDirtyRef.current) {
        feedCacheRef.current.save(channelStatesRef.current.get(channelId));
      }
      feedDirtyRef.current.clear();
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
    const access = createChannelAccessTracker({ principalId: me.id });
    obsRef.current = obs;
    rosterRef.current = roster;
    accessRef.current = access;
    setPending(restoreSubmissions(me.id));
    setControlStates(restoreControlStates(me.id));

    let alive = true;
    const refreshAccess = () => Promise.all([
      loadChannelTree(obs),
      obs.spaceMemberships().catch((error) => {
        if (error?.status === 404) return { items: [], complete: false, unsupported: true };
        throw error;
      }),
    ]).then(([result, membershipObservation]) => {
      if (!alive) return;
      const profiles = [...result.channels.values()];
      access.channelsObserved(profiles, { complete: result.complete });
      const membershipRows = (membershipObservation.items || []).map((item) => item.declared || {}).filter((row) => row.channel_id);
      access.membershipsObserved(membershipRows, {
        complete: membershipObservation.complete !== false,
        supported: !membershipObservation.unsupported,
      });
      for (const membership of membershipRows.filter((row) => row.status === 'revoked')) roster.clearSelf(membership.channel_id);
      setChannels((current) => result.complete ? result.channels : new Map([...current, ...result.channels]));
      setAccessVersion((value) => value + 1);
    }).catch((error) => { if (alive && error?.status !== 401) setTopError(displayError(error)); });
    refreshAccess();
    const accessTimer = setInterval(refreshAccess, 1_500);

    setWireState('connecting');
    const wire = createWire({
      since: () => resumeSnapshot(channelStatesRef.current),
      onFeed: enqueueFeed,
      onError: (error) => {
        if (error?.code !== 'closed') setTopError(`${error.code}: ${displayError(error)}`);
      },
      onObserveEnded: (channelId, reason) => {
        if (reason === 'channel_retired') access.retire(channelId, reason);
        setTopError(`${channelId} 旁听已结束：${reason}`);
        setAccessVersion((value) => value + 1);
      },
      onState: (state) => {
        if (state === 'attached') {
          access.wire('attached', crypto.randomUUID());
          setWireState('open');
        } else if (state === 'reconnecting') {
          access.wire('disconnected');
          setWireState('reconnecting');
        } else if (state === 'closed') {
          access.wire('disconnected');
          setWireState('closed');
        }
        else if (state === 'open') setWireState((current) => current === 'open' ? current : 'connecting');
        setAccessVersion((value) => value + 1);
      },
    });
    wireRef.current = wire;

    return () => {
      alive = false;
      clearInterval(accessTimer);
      wire.close();
      roster.close();
      cancelFeedTask();
      obsRef.current = null;
      rosterRef.current = null;
      accessRef.current = null;
      wireRef.current = null;
    };
  }, [cancelFeedTask, enqueueFeed, expireSession, me]);

  const channelList = useMemo(
    () => (accessRef.current?.rows() || []).sort((left, right) => {
      if (left.id === 'c0') return -1;
      if (right.id === 'c0') return 1;
      return (left.qualified_name || left.name || left.id).localeCompare(right.qualified_name || right.name || right.id);
    }),
    [accessVersion],
  );

  useEffect(() => {
    if (!activeChannelId && channelList.length) {
      const initial = channelList.find((channel) => channel.access === CHANNEL_ACCESS.memberActive);
      setActiveChannelId(initial?.id || channelList[0].id);
    }
    if (activeChannelId && !channelList.some((channel) => channel.id === activeChannelId)) {
      const retired = accessRef.current?.state(activeChannelId)?.existence === 'retired';
      if (retired) setChannelNotice(`${activeChannelId} 已退役，已切换到其他可用频道。`);
      const next = channelList.find((channel) => channel.access === CHANNEL_ACCESS.memberActive) || channelList[0];
      setActiveChannelId(next?.id || '');
    }
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
    const access = channelList.find((channel) => channel.id === activeChannelId)?.access;
    if (!isMemberAccess(access)) {
      setRosters((current) => new Map(current).set(activeChannelId, []));
      return;
    }
    refreshRoster(activeChannelId);
  }, [activeChannelId, channelList, me, refreshRoster]);

  useEffect(() => {
    if (!activeChannelId) return;
    const lastSeq = channelStatesRef.current.get(activeChannelId)?.lastSeq || 0;
    cursorsRef.current.markRead(activeChannelId, lastSeq);
  }, [activeChannelId, feedVersion]);

  const selectChannel = useCallback((channelId) => {
    setActiveChannelId(channelId);
    setSelectedActor(null);
    setRightPanel('roster');
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

  const transmitSubmission = useCallback(async (submission) => {
    const { channelId, messageId, key } = submission;
    rosterRef.current?.recordSubmission(channelId, messageId);
    try {
      const receipt = await wireRef.current.submit(submission.frame);
      accessRef.current?.receipt(channelId);
      if (receipt.message_id !== messageId) {
        setTopError(`协议异常：回执消息编号 ${receipt.message_id} 与客户端编号 ${messageId} 不一致`);
      }
      const state = channelStatesRef.current.get(channelId);
      const landedEnvelope = state
        ? [...state.rows.values()].find((envelope) => envelope.id === messageId)
        : null;
      if (landedEnvelope) {
        const learnedSelf = rosterRef.current?.observeFeed(channelId, landedEnvelope);
        if (learnedSelf) {
          reconcileApprovals(state, learnedSelf);
          accessRef.current?.self(channelId, learnedSelf);
        }
        setPending((current) => current.filter((item) => item.key !== key));
        setFeedVersion((value) => value + 1);
        setAccessVersion((value) => value + 1);
        return;
      }
      setPending((current) => current.map((item) => item.key === key
        ? transitionSubmission(item, 'accepted')
        : item));
      const timer = setTimeout(() => {
        setPending((current) => current.map((item) => item.key === key && item.state === 'accepted'
          ? transitionSubmission(item, 'delayed')
          : item));
      }, 10_000);
      pendingTimersRef.current.set(key, timer);
    } catch (error) {
      if (error?.code === 'forbidden') {
        accessRef.current?.forbidden(channelId);
        rosterRef.current?.clearSelf(channelId);
      } else if (['unavailable', 'channel_unavailable', 'channel_not_found'].includes(error?.code)) {
        accessRef.current?.unavailable(channelId, error.code);
      }
      const uncertain = isUncertainWireError(error);
      if (uncertain) setChannelNotice('发送结果待确认，正在通过重连账本核对。');
      setPending((current) => current.map((item) => item.key === key
        ? transitionSubmission(item, uncertain ? 'uncertain' : 'rejected', error)
        : item));
      setAccessVersion((value) => value + 1);
    }
  }, []);

  const handleSend = useCallback(async ({ channelId: requestedChannelId, text, msgType, audience, targetLabel, payload, parentId = '', expiresAtMs }) => {
    const channelId = requestedChannelId || activeChannelId;
    if (!channelId || !wireRef.current) return '';
    const messageId = crypto.randomUUID();
    const frame = {
      channel_id: channelId,
      id: messageId,
      msg_type: msgType,
      kind: 'request',
      payload: payload || { text },
      audience,
      visibility: 'public',
      ...(parentId ? { parent_id: parentId } : {}),
      ...(expiresAtMs ? { expires_at_ms: expiresAtMs } : {}),
    };
    const submission = createSubmission({ id: messageId, channelId, text, targetLabel, frame });
    setPending((current) => [...current, submission]);
    await transmitSubmission(submission);
    return messageId;
  }, [activeChannelId, transmitSubmission]);

  const refreshGovernanceData = useCallback(async () => {
    if (!obsRef.current) return;
    try {
      const [principalObservation, declarationObservation, daemonObservation] = await Promise.all([
        obsRef.current.spacePrincipals(),
        obsRef.current.spaceDecls(),
        obsRef.current.spaceDaemons(),
      ]);
      setSpacePrincipals(principalObservation.items || []);
      setSpaceDeclarations(declarationObservation.items || []);
      setSpaceDaemons(safeDaemonRows(daemonObservation));
      await Promise.all([refreshRoster(activeChannelRef.current, true), activeChannelRef.current !== 'c0' ? refreshRoster('c0', true) : Promise.resolve()]);
    } catch (error) {
      if (error?.status !== 401) setTopError(displayError(error));
    }
  }, [refreshRoster]);

  useEffect(() => {
    if (!['governance', 'space', 'resources'].includes(rightPanel)) return;
    refreshGovernanceData();
  }, [rightPanel, activeChannelId, refreshGovernanceData]);

  const handleResource = useCallback(async (payload) => {
    if (!wireRef.current) throw new TypeError('连接尚未就绪');
    return wireRef.current.resource(payload);
  }, []);

  const handleAfter = useCallback(async (payload) => {
    if (!wireRef.current) throw new TypeError('连接尚未就绪');
    const receipt = await wireRef.current.after(payload);
    if (!receipt?.timer_id) throw new TypeError('服务端没有返回 timer_id');
    setTimerRecords((current) => [timerRecord({ timerId: receipt.timer_id, channelId: payload.channel_id, durationMs: payload.duration_ms, msgType: payload.msg_type, payload: payload.payload }), ...current.filter((row) => row.timerId !== receipt.timer_id)]);
    return receipt;
  }, []);

  const handleCancelTimer = useCallback(async (timerId) => {
    if (!wireRef.current || !activeChannelRef.current) throw new TypeError('连接尚未就绪');
    await wireRef.current.cancelTimer({ channel_id: activeChannelRef.current, timer_id: timerId });
    setTimerRecords((current) => cancelTimerRecord(current, timerId));
  }, []);

  const handleDownloadResource = useCallback(async (channelId, attachment) => {
    try {
      const receipt = await handleResource(readFileTicket({ channelId, resourceId: attachment.resource_id }));
      const address = receipt.address || attachment.address;
      if (!receipt.ticket || !address) throw new TypeError('服务端没有返回可下载票据');
      const response = await fetch(`/files/${encodeURIComponent(address)}?t=${encodeURIComponent(receipt.ticket)}`, { credentials: 'include' });
      if (!response.ok) throw new TypeError(`下载失败 (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.name || 'download'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) { setTopError(displayError(error)); }
  }, [handleResource]);

  const handleRetry = useCallback(async (submission) => {
    const timer = pendingTimersRef.current.get(submission.key);
    if (timer) clearTimeout(timer);
    pendingTimersRef.current.delete(submission.key);
    const retry = transitionSubmission(submission, 'retry');
    setPending((current) => current.map((item) => item.key === retry.key ? retry : item));
    await transmitSubmission(retry);
  }, [transmitSubmission]);

  const handleResolve = useCallback(async (channelId, reqId, decision, payload) => {
    setApprovalStates((current) => ({ ...current, [reqId]: 'sending' }));
    try {
      await wireRef.current.resolve({ channel_id: channelId, req_id: reqId, decision, ...(payload && Object.keys(payload).length ? { payload } : {}) });
      setApprovalStates((current) => ({ ...current, [reqId]: 'resolved' }));
    } catch (error) {
      setApprovalStates((current) => ({ ...current, [reqId]: { error } }));
      setAccessVersion((value) => value + 1);
    }
  }, []);

  const handleCancel = useCallback(async (channelId, reqId) => {
    const key = `${channelId}:${reqId}:cancel`;
    setControlStates((current) => ({ ...current, [key]: createControlState('sending') }));
    try {
      await wireRef.current.cancel({ channel_id: channelId, req_id: reqId });
      const terminal = channelStatesRef.current.get(channelId)?.turns.get(reqId)?.terminal;
      setControlStates((current) => {
        if (terminal) {
          const next = { ...current };
          delete next[key];
          return next;
        }
        return { ...current, [key]: createControlState('accepted') };
      });
    } catch (error) {
      const uncertain = isUncertainWireError(error);
      setControlStates((current) => ({ ...current, [key]: createControlState(uncertain ? 'uncertain' : 'error', error) }));
      setAccessVersion((value) => value + 1);
    }
  }, []);

  const handleTaskControl = useCallback(async ({ channelId, turn, actorId, type, payload }) => {
    if (!channelId || !turn || !actorId) return;
    await handleSend({
      channelId,
      text: payload?.text || `${type} → ${actorId}`,
      msgType: type,
      audience: [actorId],
      targetLabel: actorId,
      payload,
      parentId: turn.requestId,
    });
  }, [handleSend]);

  const describeActor = useCallback(async (actor, channelId = activeChannelId) => {
    if (!actor || !channelId) return;
    await handleSend({
      channelId,
      text: `读取 ${actor.name || actor.id} 的能力`,
      msgType: 'actor.describe',
      audience: [actor.id],
      targetLabel: actor.name || actor.id,
      payload: {},
    });
  }, [activeChannelId, handleSend]);

  const handleSelectActor = useCallback((actor) => {
    setSelectedActor(actor);
    const state = channelStatesRef.current.get(activeChannelId);
    const capability = capabilityIndexFromState(state).get(actor.id);
    if (!capability?.describe && !capability?.loading) describeActor(actor, activeChannelId);
  }, [activeChannelId, describeActor]);

  const handleInvokeActor = useCallback(async (type, payload) => {
    if (!selectedActor || !activeChannelId) return;
    await handleSend({
      channelId: activeChannelId,
      text: payload?.text || `${type} → ${selectedActor.name || selectedActor.id}`,
      msgType: type,
      audience: [selectedActor.id],
      targetLabel: selectedActor.name || selectedActor.id,
      payload,
    });
  }, [activeChannelId, handleSend, selectedActor]);

  useEffect(() => () => {
    for (const timer of pendingTimersRef.current.values()) clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (me?.id) saveSubmissions(me.id, pending);
  }, [me?.id, pending]);

  useEffect(() => {
    if (me?.id) saveControlStates(me.id, controlStates);
  }, [controlStates, me?.id]);

  useEffect(() => {
    if (me?.id) setTimerRecords(restoreTimers(me.id));
  }, [me?.id]);

  useEffect(() => {
    if (me?.id) saveTimers(me.id, timerRecords);
  }, [me?.id, timerRecords]);

  if (booting) return <div className="boot-screen"><span className="brand-dot" />正在恢复会话…</div>;
  if (!me) return <Auth identity={identityRef.current} onAuthed={handleAuthed} />;

  const activeState = channelStatesRef.current.get(activeChannelId) || createChannelState(activeChannelId);
  const activeRow = channelList.find((channel) => channel.id === activeChannelId);
  const activeRoster = isMemberAccess(activeRow?.access) ? rosters.get(activeChannelId) || [] : [];
  const selfId = activeRow?.selfActorId || rosterRef.current?.self(activeChannelId) || '';
  const unread = Object.fromEntries(channelList.map((channel) => [
    channel.id,
    unreadCount(
      channelStatesRef.current.get(channel.id),
      cursorsRef.current.read(channel.id),
      rosterRef.current?.self(channel.id) || '',
    ),
  ]));
  const activeChannel = activeRow || channels.get(activeChannelId);
  const activeAccess = activeRow?.access || CHANNEL_ACCESS.loading;
  const capabilityIndex = capabilityIndexFromState(activeState);
  const selectedCapability = selectedActor ? capabilityIndex.get(selectedActor.id) : null;

  return (
    <div className="shell">
      <ChannelList
        channels={channelList}
        activeChannelId={activeChannelId}
        unread={unread}
        wireState={wireState}
        me={me}
        onSelect={selectChannel}
        onCreate={() => { setSelectedActor(null); setRightPanel('governance'); }}
        onSpaceManage={() => { setSelectedActor(null); setRightPanel('space'); }}
        onLogout={handleLogout}
      />
      <main className="workspace">
        <header className="channel-header">
          <div>
            <p className="eyebrow">频道账本</p>
            <h1>{activeChannel?.qualified_name || activeChannel?.name || activeChannelId || '选择频道'}</h1>
          </div>
          <div className="channel-header-actions">
            <span className="seq-label">SEQ {activeState.lastSeq}</span>
            <button type="button" className={rightPanel === 'resources' ? 'manage-button active' : 'manage-button'} disabled={!activeChannel} onClick={() => { setSelectedActor(null); setRightPanel((value) => value === 'resources' ? 'roster' : 'resources'); }}>资源</button>
            <button type="button" className={rightPanel === 'automation' ? 'manage-button active' : 'manage-button'} disabled={!activeChannel} onClick={() => { setSelectedActor(null); setRightPanel((value) => value === 'automation' ? 'roster' : 'automation'); }}>定时动作</button>
            <button type="button" className={governanceOpen ? 'manage-button active' : 'manage-button'} disabled={!activeChannel} onClick={() => { setSelectedActor(null); setRightPanel((value) => value === 'governance' ? 'roster' : 'governance'); }}>管理频道</button>
          </div>
        </header>
        <div className="status-stack">
          {topError && (
            <div className="top-error" role="alert">
              <span>{topError}</span>
              <button type="button" onClick={() => setTopError('')} aria-label="关闭错误">×</button>
            </div>
          )}
          {channelNotice && (
            <div className="channel-notice" role="status">
              <span>{channelNotice}</span>
              <button type="button" onClick={() => setChannelNotice('')} aria-label="关闭频道提示">×</button>
            </div>
          )}
          {ACCESS_MESSAGE[activeAccess] && (
            <div className={`access-banner access-${activeAccess}`} role="status">
              {ACCESS_MESSAGE[activeAccess]}
              {isMemberAccess(activeAccess) && !selfId && <span> 当前频道中的“我”仍在确认，首次发送入账后会自动识别。</span>}
            </div>
          )}
        </div>
        <Timeline
          state={activeState}
          roster={activeRoster}
          selfId={selfId}
          pending={pending.filter((item) => item.channelId === activeChannelId)}
          approvalStates={approvalStates}
          controlStates={controlStates}
          capabilityIndex={capabilityIndex}
          access={activeAccess}
          onResolve={handleResolve}
          onRetry={handleRetry}
          onCancel={handleCancel}
          onTaskControl={handleTaskControl}
          onDownloadResource={handleDownloadResource}
        />
        <Composer
          channelId={activeChannelId}
          roster={activeRoster}
          selfId={selfId}
          disabled={wireState !== 'open' || !canWriteChannel(activeAccess)}
          disabledReason={wireState !== 'open'
            ? '等待连接…'
            : activeAccess === CHANNEL_ACCESS.discoverable || activeAccess === CHANNEL_ACCESS.accessDenied
              ? '加入频道后才能发送消息'
              : activeAccess === CHANNEL_ACCESS.memberUnavailable
                ? '频道暂不可用'
                : '当前频道不可写'}
          onSend={handleSend}
          attachments={draftAttachments[activeChannelId] || []}
          onRemoveAttachment={(resourceId) => setDraftAttachments((current) => ({ ...current, [activeChannelId]: (current[activeChannelId] || []).filter((row) => row.resource_id !== resourceId) }))}
          onClearAttachments={() => setDraftAttachments((current) => ({ ...current, [activeChannelId]: [] }))}
        />
      </main>
      {rightPanel === 'governance' && activeChannel ? <ChannelGovernance
        channel={activeChannel}
        channels={channelList}
        roster={activeRoster}
        state={activeState}
        principals={spacePrincipals}
        declarations={spaceDeclarations}
        disabled={!canWriteChannel(activeAccess)}
        onSubmit={handleSend}
        onRefresh={refreshGovernanceData}
        onClose={() => setRightPanel('roster')}
      /> : rightPanel === 'space' && activeChannel ? <SpaceAdministration
        channel={activeChannel}
        channels={channelList}
        roster={activeRoster}
        registrarRoster={rosters.get('c0') || (activeChannelId === 'c0' ? activeRoster : [])}
        state={activeState}
        rootState={channelStatesRef.current.get('c0') || createChannelState('c0')}
        version={feedVersion}
        daemons={spaceDaemons}
        disabled={wireState !== 'open'}
        onSubmit={handleSend}
        onRefresh={refreshGovernanceData}
        onClose={() => setRightPanel('roster')}
      /> : rightPanel === 'resources' && activeChannel ? <ChannelResources
        channel={activeChannel}
        daemons={spaceDaemons}
        disabled={wireState !== 'open' || !canWriteChannel(activeAccess)}
        onResource={handleResource}
        onAttach={(attachment) => setDraftAttachments((current) => ({ ...current, [activeChannelId]: [...(current[activeChannelId] || []).filter((row) => row.resource_id !== attachment.resource_id), attachment] }))}
        onClose={() => setRightPanel('roster')}
      /> : rightPanel === 'automation' && activeChannel ? <ChannelAutomation
        channel={activeChannel}
        records={timerRecords}
        disabled={wireState !== 'open' || !canWriteChannel(activeAccess)}
        onAfter={handleAfter}
        onCancel={handleCancelTimer}
        onClose={() => setRightPanel('roster')}
      /> : <Roster
        rows={activeRoster}
        selfId={selfId}
        identityPending={isMemberAccess(activeAccess) && !selfId}
        busy={rosterBusy}
        onRefresh={() => refreshRoster(activeChannelId, true)}
        selectedActor={selectedActor}
        capability={selectedCapability}
        disabled={!canWriteChannel(activeAccess)}
        onSelectActor={handleSelectActor}
        onCloseActor={() => setSelectedActor(null)}
        onDescribe={() => describeActor(selectedActor, activeChannelId)}
        onInvoke={handleInvokeActor}
      />}
    </div>
  );
}
