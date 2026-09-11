// 频道显示名的本地缓存。
//
// 成员资格恒不落盘（见 channel-access.js 里那条：持久化会让上一个生命期的旧关系
// 还魂）。但**名字不是权限**——它只是给人看的一个标签，缓存它不会让任何访问关系
// 复活。这里存的就只有名字，一个字段都不多。
//
// 治的是这个：频道档案要走一趟 /obs/space/channels，没回来之前 publicRow 的兜底是
// `name = channelId`，于是手机上每次启动先亮一串 uuid。缓存之后先画上次的名字，
// 档案回来再覆盖。代价只有一格：频道刚改过名时，先闪一下旧名——比 uuid 好读。
//
// 存 localStorage 而不是 IndexedDB：它必须在首屏同步可读，异步的拿不到那一帧。
// 键以 atoll. 开头，所以服务端世代一变，ensureServerBoot 会连它一起清掉。
const KEY = 'atoll.channel.names.v1';
const MAX_ENTRIES = 256;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function load() {
  try {
    const parsed = JSON.parse(storage()?.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

let cache = null;

function ensure() {
  if (!cache) cache = load();
  return cache;
}

export function rememberChannelNames(profiles = []) {
  const next = ensure();
  let changed = false;
  for (const profile of profiles) {
    const id = profile?.id;
    if (!id) continue;
    const name = profile.qualified_name || profile.name || '';
    // 名字就是 id 的那种兜底行本身没有信息,记了等于没记。
    if (!name || name === id) continue;
    const previous = next[id];
    if (previous?.name === name) continue;
    next[id] = { name };
    changed = true;
  }
  if (!changed) return;
  const entries = Object.entries(next).slice(-MAX_ENTRIES);
  cache = Object.fromEntries(entries);
  try {
    storage()?.setItem(KEY, JSON.stringify(cache));
  } catch {
    // 存不下就算了:这只是让首屏好看一点,恒不是任何判断的依据。
  }
}

export function cachedChannelName(channelId) {
  return ensure()[channelId]?.name || '';
}

// 档案还没到的那些行,用上次记住的名字顶一下。已经有档案的一个字不动。
export function withCachedChannelName(row) {
  if (!row || row.accessState?.profile) return row;
  const name = cachedChannelName(row.id);
  if (!name) return row;
  return { ...row, name, qualified_name: name };
}

export function forgetChannelNames() {
  cache = {};
  try {
    storage()?.removeItem(KEY);
  } catch {
    // 同上
  }
}
