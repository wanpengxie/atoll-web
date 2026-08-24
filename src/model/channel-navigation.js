const EDITING_TARGETS = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
].join(',');

const SWIPE_BLOCKED_TARGETS = [
  ...EDITING_TARGETS.split(','),
  'button',
  'a',
  'pre',
  '[data-no-channel-swipe="true"]',
].join(',');

export function adjacentChannelId(channels, activeChannelId, direction) {
  const ids = (channels || []).map((channel) => channel?.id).filter(Boolean);
  if (!ids.length || !direction) return '';
  if (ids.length === 1) return activeChannelId === ids[0] ? '' : ids[0];
  const current = ids.indexOf(activeChannelId);
  if (current < 0) return direction > 0 ? ids[0] : ids[ids.length - 1];
  const offset = direction > 0 ? 1 : -1;
  return ids[(current + offset + ids.length) % ids.length];
}

export function channelShortcutDirection(event, documentRoot = globalThis.document) {
  if (!event?.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented) return 0;
  if (documentRoot?.querySelector?.('[role="dialog"], [aria-modal="true"]')) return 0;
  if (event.target?.closest?.(EDITING_TARGETS)) return 0;
  const key = String(event.key || '').toLowerCase();
  if (key === 'n') return 1;
  if (key === 'p') return -1;
  return 0;
}

export function channelShortcutIndex(event, documentRoot = globalThis.document) {
  if (!event?.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented) return -1;
  if (documentRoot?.querySelector?.('[role="dialog"], [aria-modal="true"]')) return -1;
  if (event.target?.closest?.(EDITING_TARGETS)) return -1;
  const key = String(event.key || '');
  return /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
}

export function channelSwipeStart(touch, target, now = Date.now()) {
  if (!touch || target?.closest?.(SWIPE_BLOCKED_TARGETS)) return null;
  return { x: touch.clientX, y: touch.clientY, at: now };
}

export function channelSwipeDirection(start, touch, now = Date.now()) {
  if (!start || !touch || now - start.at > 900) return 0;
  const x = touch.clientX - start.x;
  const y = touch.clientY - start.y;
  if (Math.abs(x) < 64 || Math.abs(x) < Math.abs(y) * 1.35) return 0;
  return x < 0 ? 1 : -1;
}
