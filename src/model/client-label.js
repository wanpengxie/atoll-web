// 这条连接的自称,给人看的。
//
// 选择一块屏幕是人用话做的事——"开到我手机上"必须落到某个东西上,而它落不到
// UUID 上。所以每条连接除了服务端铸的 id,还带一个人认得出的名字。
//
// 粗糙但够用:它只用于显示和辨认,**从不用于寻址**,所以猜错了是不好看,不是不
// 安全。真正决定"是不是我"的永远是服务端铸的那个 id。
export function describeClient(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || '') {
  const ua = String(userAgent);
  if (!ua) return '网页';
  const platform =
    /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
      : /Android/i.test(ua) ? 'Android'
        : /Macintosh|Mac OS X/i.test(ua) ? 'Mac'
          : /Windows/i.test(ua) ? 'Windows'
            : /Linux/i.test(ua) ? 'Linux'
              : '';
  const browser =
    /Edg\//i.test(ua) ? 'Edge'
      : /OPR\//i.test(ua) ? 'Opera'
        : /Chrome\//i.test(ua) ? 'Chrome'
          : /Safari\//i.test(ua) ? 'Safari'
            : /Firefox\//i.test(ua) ? 'Firefox'
              : '';
  return [platform, browser].filter(Boolean).join(' ') || '网页';
}
