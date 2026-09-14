import { useCallback, useEffect, useRef, useState } from 'react';
import { createIdentityClient } from '../../net/identity.js';
import { createObsClient } from '../../net/obs.js';
import { forgetCachedPrincipal, readCachedPrincipal, rememberCachedPrincipal } from '../../model/workspace-bootstrap-cache.js';

export function useAtollSession({ onError }) {
  const cachedPrincipalRef = useRef(readCachedPrincipal());
  const [booting, setBooting] = useState(!cachedPrincipalRef.current);
  const [principal, setPrincipal] = useState(cachedPrincipalRef.current);
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
        // Identity is sufficient to start the workspace connection. Profile
        // enrichment is presentation-only and may be much slower than the
        // session endpoint on a mobile network, so it must not hold the boot
        // screen or the WebSocket behind an unrelated OBS round trip.
        const recovered = cachedPrincipalRef.current?.id === current.id
          ? cachedPrincipalRef.current
          : { id: current.id, display_name: '' };
        setPrincipal(recovered);
        rememberCachedPrincipal(recovered);
        setBooting(false);
        try {
          const principals = await obs.spacePrincipals();
          const row = (principals.items || []).map((item) => item.declared || {}).find((item) => item.id === current.id);
          if (alive && row) {
            rememberCachedPrincipal({ id: current.id, display_name: row.display_name || '' });
            setPrincipal((value) => value?.id === current.id
              ? { ...value, ...row, id: current.id, display_name: row.display_name || '' }
              : value);
          }
        } catch (error) {
          if (error?.status === 401) {
            forgetCachedPrincipal();
            if (alive) setPrincipal(null);
            throw error;
          }
          onError(error);
        }
      } catch (error) {
        if (error?.status === 401) {
          forgetCachedPrincipal();
          if (alive) setPrincipal(null);
        }
        if (alive && error?.status !== 401) onError(error);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, [onError]);

  const accept = useCallback((value) => {
    const next = { id: value.id, display_name: value.display_name || '' };
    rememberCachedPrincipal(next);
    setPrincipal(next);
  }, []);
  const clear = useCallback(() => { forgetCachedPrincipal(); setPrincipal(null); setBooting(false); }, []);
  const logoutRemote = useCallback(async () => {
    try { await identityRef.current.logout(); } catch { /* 本地退出仍然生效 */ }
  }, []);

  return { booting, principal, identity: identityRef.current, accept, clear, logoutRemote };
}
