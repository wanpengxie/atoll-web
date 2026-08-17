import { supportsType } from './capabilities.js';

function processingTurnId(turn) {
  return [...(turn?.provisional || [])]
    .reverse()
    .map((item) => item.envelope?.payload?.turn_id)
    .find((value) => typeof value === 'string' && value) || '';
}

export function taskControlContext(turn, { selfId = '', access = '', capability = null, now = Date.now() } = {}) {
  const request = turn?.request;
  const actorId = request?.audience?.length === 1 ? request.audience[0] : '';
  const open = Boolean(request && !turn.terminal);
  const owned = Boolean(selfId && request?.sender?.id === selfId);
  const writable = access === 'member_active';
  const turnId = processingTurnId(turn);
  const expiresAt = Number(request?.expires_at || 0);
  const typeMeta = capability?.describe?.types?.get(request?.type);
  const maxPendingMs = Number(typeMeta?.maxPendingMs || 0);
  return {
    actorId,
    open,
    owned,
    writable,
    turnId,
    expiresAt,
    expired: expiresAt > 0 && expiresAt <= now,
    maxPendingMs,
    canCancel: open && owned && writable,
    canSteer: open && owned && writable && Boolean(turnId) && supportsType(capability, 'agent.steer'),
    canInterrupt: open && owned && writable && supportsType(capability, 'agent.interrupt'),
  };
}
