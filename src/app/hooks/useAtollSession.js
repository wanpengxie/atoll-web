import { useCallback, useEffect, useRef, useState } from 'react';
import { createIdentityClient } from '../../net/identity.js';
import { createObsClient } from '../../net/obs.js';

const PRINCIPAL_KEY = 'atoll.principal';

function savedPrincipal() {
  try { return JSON.parse(localStorage.getItem(PRINCIPAL_KEY) || 'null'); }
  catch { return null; }
}

export function useAtollSession({ onError }) {
  const [booting, setBooting] = useState(true);
  const [principal, setPrincipal] = useState(null);
  const identityRef = useRef(createIdentityClient());

  useEffect(() => {
    let alive = true;
    const obs = createObsClient();
    (async () => {
      try {
        const principals = await obs.spacePrincipals();
        if (!alive) return;
        const saved = savedPrincipal();
        const row = (principals.items || []).map((item) => item.declared || {}).find((item) => item.id === saved?.id);
        setPrincipal(saved ? { ...saved, ...row } : { id: '', display_name: '已登录用户' });
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
    localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(next));
    setPrincipal(next);
  }, []);
  const clear = useCallback(() => { setPrincipal(null); setBooting(false); }, []);
  const logoutRemote = useCallback(async () => {
    try { await identityRef.current.logout(); } catch { /* 本地退出仍然生效 */ }
  }, []);

  return { booting, principal, identity: identityRef.current, accept, clear, logoutRemote };
}
