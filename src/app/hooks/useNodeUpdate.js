import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_UPDATE_STATES, markUpdateChecked, readNodeUpdate, startNodeUpdate, updateCheckDue } from '../../model/node-update.js';

const DAILY_POLL_MS = 60 * 60 * 1000;

export function useNodeUpdate({ principalId, wireState }) {
  const [update, setUpdate] = useState(null);
  const mountedRef = useRef(true);
  const updateRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { updateRef.current = update; }, [update]);

  const refresh = useCallback(async (forceCheck = false) => {
    if (principalId !== 'root') return null;
    const check = forceCheck || updateCheckDue();
    try {
      const next = await readNodeUpdate({ check });
      if (check) markUpdateChecked();
      if (mountedRef.current) setUpdate(next);
      return next;
    } catch (error) {
      // A restart necessarily drops this HTTP request path for a moment. Keep
      // showing the last real phase; the next poll observes the new process.
      if (mountedRef.current && !ACTIVE_UPDATE_STATES.has(updateRef.current?.status)) {
        setUpdate((current) => current ? { ...current, status: 'failed', detail: error.message } : null);
      }
      return null;
    }
  }, [principalId]);

  useEffect(() => {
    if (principalId !== 'root') {
      setUpdate(null);
      return undefined;
    }
    void refresh(false);
    const timer = window.setInterval(() => { if (updateCheckDue()) void refresh(false); }, DAILY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [principalId, refresh]);

  useEffect(() => {
    if (!ACTIVE_UPDATE_STATES.has(update?.status)) return undefined;
    const timer = window.setInterval(() => void refresh(false), 1000);
    return () => window.clearInterval(timer);
  }, [refresh, update?.status]);

  useEffect(() => {
    if (wireState === 'open' && ACTIVE_UPDATE_STATES.has(update?.status)) void refresh(false);
  }, [refresh, update?.status, wireState]);

  const start = useCallback(async () => {
    try {
      const next = await startNodeUpdate();
      if (mountedRef.current) setUpdate(next);
      return next;
    } catch (error) {
      if (mountedRef.current) setUpdate((current) => ({ ...current, status: 'failed', detail: error.message }));
      throw error;
    }
  }, []);

  return { value: update, start };
}
