export class ObsError extends Error {
  constructor(status, code, detail) {
    super(detail || code || `observation request failed (${status})`);
    this.name = 'ObsError';
    this.status = status;
    this.code = code || 'unknown';
    this.detail = detail || '';
  }
}

// Membership 是 Mock 提供的可选投影。真实 Atoll 版本可能用 404，或用
// invalid_args/unknown kind 明确表示该观察面不存在；两者都不是产品错误。
export function isUnsupportedMembershipObservation(error) {
  return error?.status === 404
    || (error?.status === 400
      && error?.code === 'invalid_args'
      && /unknown space observation kind/i.test(error?.detail || ''));
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
    // 临时观察面：后端返回当前频道主 Agent 的 Model/Effort 及可选项。
    // 正式 Actor OBS 确定后，保持这个方法签名即可替换底层路径。
    channelAgentSelection(id, actorId = '') {
      const query = actorId ? `?actor_id=${encodeURIComponent(actorId)}` : '';
      return read(`/obs/channel/${encodeURIComponent(id)}/agent-selection${query}`, fetchImpl, onUnauthorized);
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
export const channelAgentSelection = obs.channelAgentSelection;
