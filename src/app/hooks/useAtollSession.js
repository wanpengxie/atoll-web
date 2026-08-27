import { useCallback, useEffect, useRef, useState } from 'react';
import { createIdentityClient } from '../../net/identity.js';
import { createObsClient } from '../../net/obs.js';

export function useAtollSession({ onError }) {
  const [booting, setBooting] = useState(true);
  const [principal, setPrincipal] = useState(null);
  const identityRef = useRef(createIdentityClient());

  useEffect(() => {
    let alive = true;
    const obs = createObsClient();
    (async () => {
      try {
        // The HttpOnly session is the identity authority. Browser storage may
        // disappear independently and must never be required to recover who
        // owns an otherwise valid server session.
        const current = await identityRef.current.session();
        if (!alive) return;
        let row;
        try {
          const principals = await obs.spacePrincipals();
          row = (principals.items || []).map((item) => item.declared || {}).find((item) => item.id === current.id);
        } catch (error) {
          if (error?.status === 401) throw error;
          onError(error);
        }
        if (alive) setPrincipal({ ...(row || {}), id: current.id, display_name: row?.display_name || '' });
      } catch (error) {
        if (alive && error?.status !== 401) onError(error);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, [onError]);

  const accept = useCallback((value) => {
    const next = { id: value.id, display_name: value.display_name || '' };
    setPrincipal(next);
  }, []);
  const clear = useCallback(() => { setPrincipal(null); setBooting(false); }, []);
  const logoutRemote = useCallback(async () => {
    try { await identityRef.current.logout(); } catch { /* 本地退出仍然生效 */ }
  }, []);

  return { booting, principal, identity: identityRef.current, accept, clear, logoutRemote };
}
