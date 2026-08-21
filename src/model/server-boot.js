// 服务器世代守卫：本地缓存（feed/cursor/submissions/timers…）只在"同一个服务器
// 世界"里有效。服务器在 attach 回执里报世代号（boot）；世代变了（重装、mock 重启、
// 账本 reset），旧账、旧游标全是另一个世界的真相，整体作废——恒不把"清缓存"
// 转嫁给使用者。不报 boot 的服务器（旧后端）视为恒同世界，零行为变化。
const BOOT_KEY = 'atoll.server.boot.v1';

export function ensureServerBoot(boot, storage = globalThis.localStorage) {
  if (!boot || !storage) return true;
  const known = storage.getItem(BOOT_KEY);
  if (known === boot) return true;
  const stale = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith('atoll.') && key !== BOOT_KEY) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
  storage.setItem(BOOT_KEY, boot);
  // 没有旧世界的缓存可作废时（全新浏览器）不需要重载。
  return stale.length === 0;
}
