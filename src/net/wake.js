import { isMobileProfile } from '../model/device-profile.js';

// "醒过来"是应用层的判断,恒不是传输层的:wire 只知道自己断了,不知道这块屏幕
// 是被人重新看见了,还是网卡刚换回 wifi。所以由这里订阅,把事件喂给它。
//
// 手机上这两件事恒同时发生:锁屏/切后台后，JS 可能仍把已经失去新鲜性的 socket
// 记成 attached。人解锁回来时必须立刻重做 attach Meta seam；不能等旧连接的
// close/ping 超时，也不能把 push 当成发现缺口的唯一方式。
export function foregroundWake({ doc = globalThis.document, net = globalThis } = {}) {
  if (!isMobileProfile() || !doc?.addEventListener) return null;
  return (fire) => {
    const onVisible = () => {
      if (doc.visibilityState !== 'hidden') fire('visible');
    };
    const onOnline = () => fire('online');
    doc.addEventListener('visibilitychange', onVisible);
    net?.addEventListener?.('online', onOnline);
    return () => {
      doc.removeEventListener('visibilitychange', onVisible);
      net?.removeEventListener?.('online', onOnline);
    };
  };
}
