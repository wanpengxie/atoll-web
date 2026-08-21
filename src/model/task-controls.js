import { hasCapability, supportsType } from './capabilities.js';
import { TYPES } from '../protocol/vocab.js';

function processingTurnId(turn) {
  return [...(turn?.provisional || [])]
    .reverse()
    .map((item) => item.envelope?.payload?.turn_id)
    .find((value) => typeof value === 'string' && value) || '';
}

export function taskLocation(turn) {
  return [...(turn?.provisional || [])]
    .reverse()
    .map((item) => item.envelope?.payload?.status)
    .find((value) => value === 'queued' || value === 'processing') || '';
}

export function taskControlContext(turn, { selfId = '', access = '', capability = null, now = Date.now() } = {}) {
  const request = turn?.request;
  const actorId = request?.audience?.length === 1 ? request.audience[0] : '';
  const open = Boolean(request && !turn.terminal);
  const owned = Boolean(selfId && request?.sender?.id === selfId);
  const writable = access === 'member_active';
  const turnId = processingTurnId(turn);
  const location = taskLocation(turn);
  const expiresAt = Number(request?.expires_at || 0);
  const editableContent = ![TYPES.agentCompact, TYPES.agentSelect].includes(request?.type);
  return {
    actorId,
    open,
    owned,
    writable,
    turnId,
    expiresAt,
    expired: expiresAt > 0 && expiresAt <= now,
    location,
    canCancel: open && owned && writable && location === 'queued',
    canSteer: open && owned && writable && Boolean(turnId) && hasCapability(capability, 'steer'),
    canEdit: open && owned && writable && editableContent && supportsType(capability, TYPES.agentHold)
      && (location === 'queued' || hasCapability(capability, 'interrupt')),
  };
}
