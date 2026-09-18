// 服务器世代守卫：本地缓存（feed/cursor/submissions/timers…）只在"同一个服务器
// 世界"里有效。服务器在 attach 回执里报世代号（boot）；世代变了（重装、mock 重启、
// 账本 reset），旧账、旧游标全是另一个世界的真相，整体作废——恒不把"清缓存"
// 转嫁给使用者。不报 boot 的服务器（旧后端）视为恒同世界，零行为变化。
const BOOT_KEY = 'atoll.server.boot.v1';
const WORLD_SCOPED_KEYS = [
  'atoll.channel.names.v1',
];
const WORLD_SCOPED_PREFIXES = [
  'atoll.workspace.bootstrap.v1.',
  'atoll.history.priority.v1.',
  'atoll.cursor.v3.',
  'atoll.read.v4.',
  'atoll.controls.v1.',
  'atoll.timers.',
  'atoll.web.file-reading-history.v1.',
  'atoll.terminal.session.',
];

function belongsToServerWorld(key) {
  return WORLD_SCOPED_KEYS.includes(key) || WORLD_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function ensureServerBoot(boot, storage = globalThis.localStorage) {
  if (!boot || !storage) return true;
  const known = storage.getItem(BOOT_KEY);
  if (known === boot) return true;
  // First observation establishes the world identity. Login/session state may
  // already have been written during this same boot and is not stale merely
  // because the server receipt arrived a few milliseconds later.
  if (!known) {
    storage.setItem(BOOT_KEY, boot);
    return true;
  }
  const stale = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
	// The authenticated principal belongs to the browser session, not to one
	// ledger incarnation. Keep it so a server restart can reconcile in place
	// instead of bringing the remote login gate back into the next startup.
    if (key && belongsToServerWorld(key)) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
  storage.setItem(BOOT_KEY, boot);
  // false means "the established server world changed", independently of how
  // many browser keys happened to exist. Callers use this as an epoch boundary
  // for in-memory projections too, so basing it on stale.length was incorrect.
  return false;
}

export function readServerBoot(storage = globalThis.localStorage) {
  return String(storage?.getItem?.(BOOT_KEY) || '');
}
