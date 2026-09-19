const SESSION_KEY = 'atoll.session.principal.v2';
const ACCESS_PREFIX = 'atoll.workspace.bootstrap.v2.';
const CACHE_SCHEMA = 1;

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(storage()?.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* cache is optional */ }
}

export function readCachedPrincipal() {
  const value = readJSON(SESSION_KEY, null);
  return value?.schema === CACHE_SCHEMA && value?.id
    ? { id: String(value.id), display_name: String(value.display_name || '') }
    : null;
}

export function rememberCachedPrincipal(value) {
  if (value?.id) writeJSON(SESSION_KEY, { schema: CACHE_SCHEMA, id: String(value.id), display_name: String(value.display_name || '') });
}

export function forgetCachedPrincipal() {
  try { storage()?.removeItem(SESSION_KEY); } catch { /* cache is optional */ }
}

function accessKey(principalId) {
  return `${ACCESS_PREFIX}${encodeURIComponent(principalId)}`;
}

export function readWorkspaceBootstrap(principalId) {
  if (!principalId) return { profiles: [], memberships: [], rosters: {} };
  const value = readJSON(accessKey(principalId), null);
  if (value?.schema !== CACHE_SCHEMA || value?.principalId !== principalId) return { profiles: [], memberships: [], rosters: {} };
  return {
    profiles: Array.isArray(value.profiles) ? value.profiles.filter((row) => row?.id) : [],
    memberships: Array.isArray(value.memberships) ? value.memberships.filter((row) => row?.channel_id) : [],
	// Actor rosters can be large and change independently. They do not belong in
	// the synchronous startup manifest; membership already carries selfActorId,
	// which is the only actor fact history folding needs before OBS refreshes.
    rosters: {},
  };
}

export function writeWorkspaceBootstrap(principalId, snapshot) {
  if (!principalId || !snapshot?.channels) return;
  const members = snapshot.channels.filter((row) => row.relationship === 'member');
  writeJSON(accessKey(principalId), {
    schema: CACHE_SCHEMA,
    principalId,
    profiles: members.flatMap((row) => row.profile?.id ? [row.profile] : []),
    memberships: members.map((row) => ({
      channel_id: row.channelId,
      actor_id: row.selfActorId || '',
      status: 'active',
    })),
    rosters: {},
  });
}
