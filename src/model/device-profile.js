// 这台设备走哪条性能路径。
//
// 手机上的三件事——掉线后回来得慢、页面自己刷新、越用越卡——都能治，但治法
// 各有代价：回前台立刻重连要挂全局监听，内存要设上限就意味着往回翻时得重新读。
// PC 上这些代价白付，所以判据在这里判一次，两条路径各走各的。
//
// **判一次，之后不变。** 恒不跟着窗口宽度变：PC 上把窗口拖窄不该突然切到"内存
// 裁剪"那一套，运行中途换路径也会让已经建立的状态自相矛盾。
//
// 判据是"触屏 + 窄屏"，恒不嗅探 UA——UA 会被"请求桌面版"骗过去，触屏不会。
// 两个媒体查询都是 responsive.css 里已经在用的断点。
//
// 覆盖开关不是装饰：mobile 路径唯一的暴露面就是手机，而手机恰恰最难调试。
// `?perf=mobile` 让这条路径能在 PC 上被打开来测，选择记进 localStorage。

export const PROFILE_MOBILE = 'mobile';
export const PROFILE_DESKTOP = 'desktop';
const OVERRIDE_KEY = 'atoll.perf.profile.v1';
const VALID = new Set([PROFILE_MOBILE, PROFILE_DESKTOP]);

export function detectProfile({
  matchMedia = globalThis.matchMedia,
  search = globalThis.location?.search || '',
  storage = globalThis.localStorage,
} = {}) {
  let override = '';
  try {
    override = new URLSearchParams(search).get('perf') || '';
    if (override && VALID.has(override)) storage?.setItem(OVERRIDE_KEY, override);
    if (!override) override = storage?.getItem(OVERRIDE_KEY) || '';
  } catch {
    override = '';
  }
  if (VALID.has(override)) return override;
  // 判据缺失（jsdom、旧浏览器）恒当 desktop：这条路径是今天已经在跑的那条。
  if (typeof matchMedia !== 'function') return PROFILE_DESKTOP;
  const coarse = matchMedia('(pointer: coarse)')?.matches;
  const narrow = matchMedia('(max-width: 900px)')?.matches;
  return coarse && narrow ? PROFILE_MOBILE : PROFILE_DESKTOP;
}

let resolved = '';

export function deviceProfile() {
  if (!resolved) resolved = detectProfile();
  return resolved;
}

export function isMobileProfile() {
  return deviceProfile() === PROFILE_MOBILE;
}

// 测试与覆盖开关的唯一入口。传空恢复成"下次再判"。
export function setDeviceProfile(value) {
  resolved = VALID.has(value) ? value : '';
  return resolved;
}
