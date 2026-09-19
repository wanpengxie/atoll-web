const ACTIVE_STATES = new Set(['active', 'waiting', 'blocked', 'uncertain', 'queued', 'running']);
const FINISHED_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

export function filterFeatureTasks(items = [], { scope = 'me', status = 'active', kind = 'all', selfId = '' } = {}) {
  return items.filter((item) => {
    if (kind !== 'all' && item?.kind !== kind) return false;
    const state = String(item?.state || 'active');
    if (status === 'active' && !ACTIVE_STATES.has(state)) return false;
    if (status === 'completed' && state !== 'completed') return false;
    if (status === 'failed' && !FINISHED_STATES.has(state)) return false;
    if (scope !== 'me') return true;
    const assignees = item?.assigneeActorIds || item?.assignees || [];
    return item?.needsYou === true || item?.ownerId === selfId || assignees.includes(selfId);
  });
}

export function featureTaskGroup(item) {
  if (['needs_you', 'active', 'recovery', 'automation', 'history'].includes(item?.group)) return item.group;
  if (item?.needsYou === true) return 'needs_you';
  if (item?.kind === 'recovery') return 'recovery';
  if (item?.kind === 'automation') return 'automation';
  return FINISHED_STATES.has(String(item?.state || '')) ? 'history' : 'active';
}

export function featureWaitingActions(item) {
  return Array.isArray(item?.actions) ? item.actions : [];
}
