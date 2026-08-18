import { useCallback, useEffect, useState } from 'react';
import { cancelTimerRecord, restoreTimers, saveTimers, timerRecord } from '../../model/timers.js';

export function useLocalAutomation({ principalId, wireRef, activeChannelRef }) {
  const [records, setRecords] = useState([]);

  useEffect(() => {
    if (principalId) setRecords(restoreTimers(principalId));
    else setRecords([]);
  }, [principalId]);

  useEffect(() => {
    if (principalId) saveTimers(principalId, records);
  }, [principalId, records]);

  const markFired = useCallback((timerId, firedAt) => {
    setRecords((current) => current.some((timer) => timer.timerId === timerId && timer.state === 'scheduled')
      ? current.map((timer) => timer.timerId === timerId ? { ...timer, state: 'fired', firedAt } : timer)
      : current);
  }, []);

  const after = useCallback(async (payload) => {
    if (!wireRef.current) throw new TypeError('连接尚未就绪');
    const receipt = await wireRef.current.after(payload);
    if (!receipt?.timer_id) throw new TypeError('服务端没有返回 timer_id');
    setRecords((current) => [timerRecord({ timerId: receipt.timer_id, channelId: payload.channel_id, durationMs: payload.duration_ms, msgType: payload.msg_type, payload: payload.payload }), ...current.filter((row) => row.timerId !== receipt.timer_id)]);
    return receipt;
  }, [wireRef]);

  const cancel = useCallback(async (timerId) => {
    if (!wireRef.current || !activeChannelRef.current) throw new TypeError('连接尚未就绪');
    await wireRef.current.cancelTimer({ channel_id: activeChannelRef.current, timer_id: timerId });
    setRecords((current) => cancelTimerRecord(current, timerId));
  }, [activeChannelRef, wireRef]);

  const clear = useCallback(() => setRecords([]), []);
  return { records, markFired, after, cancel, clear };
}
