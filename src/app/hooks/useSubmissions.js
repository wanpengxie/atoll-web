import { useCallback, useEffect, useRef, useState } from 'react';
import { createControlState, restoreControlStates, saveControlStates } from '../../model/control-actions.js';
import { reconcileApprovals } from '../../model/fold.js';
import { createSubmission, isUncertainWireError, reconcileLanded, restoreSubmissions, saveSubmissions, transitionSubmission } from '../../model/submissions.js';
import { newId } from '../../util/id.js';

export function useSubmissions({ principalId, activeChannelId, wireState, wireRef, rosterRef, accessRef, channelStatesRef, onError, onNotice, onFeedChanged, onAccessChanged }) {
  const [pending, setPending] = useState([]);
  const [approvalStates, setApprovalStates] = useState({});
  const [controlStates, setControlStates] = useState({});
  const timersRef = useRef(new Map());
  const transmittingRef = useRef(new Set());
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    setPending(principalId ? restoreSubmissions(principalId) : []);
    setControlStates(principalId ? restoreControlStates(principalId) : {});
  }, [principalId]);
  useEffect(() => { if (principalId) saveSubmissions(principalId, pending); }, [pending, principalId]);
  useEffect(() => { if (principalId) saveControlStates(principalId, controlStates); }, [controlStates, principalId]);
  useEffect(() => () => { for (const timer of timersRef.current.values()) clearTimeout(timer); }, []);

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    setPending([]);
    setApprovalStates({});
    setControlStates({});
  }, []);

  const transmit = useCallback(async (submission) => {
    const { channelId, messageId, key } = submission;
    if (!wireRef.current) {
      setPending((current) => current.map((item) => item.key === key ? transitionSubmission(item, 'queued') : item));
      return;
    }
    if (transmittingRef.current.has(key)) return;
    transmittingRef.current.add(key);
    setPending((current) => current.map((item) => item.key === key ? transitionSubmission(item, 'transmit') : item));
    rosterRef.current?.recordSubmission(channelId, messageId);
    try {
      const receipt = await wireRef.current.submit(submission.frame);
      if (receipt.message_id !== messageId) onError(`协议异常：回执消息编号 ${receipt.message_id} 与客户端编号 ${messageId} 不一致`);
      const state = channelStatesRef.current.get(channelId);
      const landedEnvelope = state ? [...state.rows.values()].find((envelope) => envelope.id === messageId) : null;
      if (landedEnvelope) {
        const learnedSelf = rosterRef.current?.observeFeed(channelId, landedEnvelope);
        if (learnedSelf) {
          reconcileApprovals(state, learnedSelf);
        }
        setPending((current) => current.filter((item) => item.key !== key));
        onFeedChanged();
        onAccessChanged();
        return;
      }
      setPending((current) => current.map((item) => item.key === key ? transitionSubmission(item, 'accepted') : item));
      const timer = setTimeout(() => {
        setPending((current) => current.map((item) => item.key === key && item.state === 'accepted' ? transitionSubmission(item, 'delayed') : item));
      }, 10_000);
      timersRef.current.set(key, timer);
    } catch (error) {
      if (error?.code === 'forbidden') {
        accessRef.current?.forbidden(channelId);
        rosterRef.current?.clearSelf(channelId);
      } else if (['unavailable', 'channel_unavailable', 'channel_not_found'].includes(error?.code)) {
        accessRef.current?.unavailable(channelId, error.code);
      }
      const uncertain = isUncertainWireError(error);
      if (uncertain) onNotice('发送结果待确认，正在通过重连账本核对。');
      setPending((current) => current.map((item) => item.key === key ? transitionSubmission(item, uncertain ? 'uncertain' : 'rejected', error) : item));
      onAccessChanged();
    } finally {
      transmittingRef.current.delete(key);
    }
  }, [accessRef, channelStatesRef, onAccessChanged, onError, onFeedChanged, onNotice, rosterRef, wireRef]);

  const send = useCallback(({ channelId: requestedChannelId, text, msgType, audience, targetLabel, payload, parentId = '', expiresAtMs }) => {
    const channelId = requestedChannelId || activeChannelId;
    if (!channelId) return '';
    const messageId = newId();
    // origin(这条消息从哪块屏发出)不在这里盖——它盖在 wire.submit,那是这条
    // 连接唯一的出口,盖在那里才漏不掉。
    const frame = { channel_id: channelId, id: messageId, msg_type: msgType, kind: 'request', payload: payload || { text }, audience, visibility: 'public', ...(parentId ? { parent_id: parentId } : {}), ...(expiresAtMs ? { expires_at_ms: expiresAtMs } : {}) };
    const connected = wireState === 'open' && Boolean(wireRef.current);
    const submission = createSubmission({ id: messageId, channelId, text, targetLabel, frame, state: connected ? 'transmitting' : 'queued' });
    // The outbox write is part of accepting the user's send action, not a later
    // rendering side effect. Closing the tab immediately after tapping send
    // must still leave a durable queued item with this exact message id.
    const nextPending = [...pendingRef.current, submission];
    pendingRef.current = nextPending;
    if (principalId) saveSubmissions(principalId, nextPending);
    setPending(nextPending);
    // The interaction is accepted once the durable outbox owns the frame.
    // Network acknowledgement is a later fact represented by submission
    // state and the channel ledger; it must never hold the composer open.
    if (connected) void transmit(submission);
    return messageId;
  }, [activeChannelId, principalId, transmit, wireRef, wireState]);

  useEffect(() => {
    if (wireState !== 'open' || !wireRef.current) return;
    for (const submission of pending) {
      if (submission.state === 'queued') void transmit(submission);
    }
  }, [pending, transmit, wireRef, wireState]);

  const retry = useCallback(async (submission) => {
    const timer = timersRef.current.get(submission.key);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(submission.key);
    const next = transitionSubmission(submission, 'retry');
    setPending((current) => current.map((item) => item.key === next.key ? next : item));
    await transmit(next);
  }, [transmit]);

  const resolve = useCallback(async (channelId, reqId, decision, payload) => {
    setApprovalStates((current) => ({ ...current, [reqId]: 'sending' }));
    try {
      // resolve 帧的字段闭集：human.ask 只带 text，human.approve 只带 decision
      // 加可选 note（platform/subjectgate/frame.go ResolvePayload，严格解码）。
      const frame = { channel_id: channelId, req_id: reqId };
      if (decision) frame.decision = decision;
      if (typeof payload?.text === 'string') frame.text = payload.text;
      if (typeof payload?.note === 'string' && payload.note) frame.note = payload.note;
      await wireRef.current.resolve(frame);
      setApprovalStates((current) => ({ ...current, [reqId]: 'resolved' }));
    } catch (error) {
      setApprovalStates((current) => ({ ...current, [reqId]: { error } }));
      onAccessChanged();
    }
  }, [onAccessChanged, wireRef]);

  const cancel = useCallback(async (channelId, reqId) => {
    const key = `${channelId}:${reqId}:cancel`;
    setControlStates((current) => ({ ...current, [key]: createControlState('sending') }));
    try {
      await wireRef.current.cancel({ channel_id: channelId, req_id: reqId });
      const terminal = channelStatesRef.current.get(channelId)?.turns.get(reqId)?.terminal;
      setControlStates((current) => {
        if (!terminal) return { ...current, [key]: createControlState('accepted') };
        const next = { ...current }; delete next[key]; return next;
      });
    } catch (error) {
      const uncertain = isUncertainWireError(error);
      setControlStates((current) => ({ ...current, [key]: createControlState(uncertain ? 'uncertain' : 'error', error) }));
      onAccessChanged();
    }
  }, [channelStatesRef, onAccessChanged, wireRef]);

  const reconcileFeed = useCallback((landedMessageIds, closedRequestIds) => {
    if (landedMessageIds.size) {
      setPending((current) => {
        const landed = current.filter((item) => item.messageId && landedMessageIds.has(item.messageId));
        if (!landed.length) return current;
        if (landed.some((item) => item.state === 'uncertain')) onNotice('此前发送结果待确认，现已通过频道账本确认。');
        for (const item of landed) {
          const timer = timersRef.current.get(item.key);
          if (timer) clearTimeout(timer);
          timersRef.current.delete(item.key);
        }
        return reconcileLanded(current, landedMessageIds);
      });
    }
    if (closedRequestIds.size) setControlStates((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !closedRequestIds.has(key))));
  }, [onNotice]);

  return { pending, approvalStates, controlStates, send, retry, resolve, cancel, reconcileFeed, clear };
}
