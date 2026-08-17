export class ObsError extends Error {
  constructor(status, code, detail) {
    super(detail || code || `observation request failed (${status})`);
    this.name = 'ObsError';
    this.status = status;
    this.code = code || 'unknown';
    this.detail = detail || '';
  }
}

async function read(path, fetchImpl, onUnauthorized) {
  const response = await fetchImpl(path, { credentials: 'include' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ObsError(response.status, body.code, body.detail);
    if (response.status === 401) onUnauthorized?.(error);
    throw error;
  }
  return body;
}

export function createObsClient({ fetchImpl = fetch, onUnauthorized } = {}) {
  return {
    spaceChannels(parentId) {
      const query = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : '';
      return read(`/obs/space/channels${query}`, fetchImpl, onUnauthorized);
    },
    spacePrincipals() {
      return read('/obs/space/principals', fetchImpl, onUnauthorized);
    },
    // Mock-only product-gap projection. Real atoll currently returns 404;
    // callers must degrade rather than treating the space tree as membership.
    spaceMemberships() {
      return read('/obs/space/memberships', fetchImpl, onUnauthorized);
    },
    spaceDaemons() {
      return read('/obs/space/daemons', fetchImpl, onUnauthorized);
    },
    spaceDecls() {
      return read('/obs/space/decls', fetchImpl, onUnauthorized);
    },
    channelProfile(id) {
      return read(`/obs/channel/${encodeURIComponent(id)}/profile`, fetchImpl, onUnauthorized);
    },
    channelActors(id) {
      return read(`/obs/channel/${encodeURIComponent(id)}/actors`, fetchImpl, onUnauthorized);
    },
  };
}

const obs = createObsClient();
export const spaceChannels = obs.spaceChannels;
export const spacePrincipals = obs.spacePrincipals;
export const spaceDaemons = obs.spaceDaemons;
export const spaceDecls = obs.spaceDecls;
export const channelProfile = obs.channelProfile;
export const channelActors = obs.channelActors;
