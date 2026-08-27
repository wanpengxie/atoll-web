import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_UPDATE_STATES, readNodeUpdate, startNodeUpdate, UPDATE_CHECK_INTERVAL_MS } from '../../model/node-update.js';

export function useNodeUpdate({ principalId, wireState }) {
  const [update, setUpdate] = useState(null);
  const mountedRef = useRef(true);
  const updateRef = useRef(null);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { updateRef.current = update; }, [update]);

  const refresh = useCallback(async (forceCheck = false) => {
    if (principalId !== 'root') return null;
    try {
      const next = await readNodeUpdate({ check: forceCheck });
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
      hasConnectedRef.current = false;
      return undefined;
    }
    // Opening or reloading the page always checks once. While it remains open,
    // the official origins are checked again every six hours.
    void refresh(true);
    const timer = window.setInterval(() => void refresh(true), UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [principalId, refresh]);

  useEffect(() => {
    if (!ACTIVE_UPDATE_STATES.has(update?.status)) return undefined;
    const timer = window.setInterval(() => void refresh(false), 1000);
    return () => window.clearInterval(timer);
  }, [refresh, update?.status]);

  useEffect(() => {
    if (wireState !== 'open') return;
    // The first open belongs to page startup, already checked above. A later
    // open means the node restarted and the wire reconnected, so check again.
    if (hasConnectedRef.current) void refresh(true);
    hasConnectedRef.current = true;
  }, [refresh, wireState]);

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
