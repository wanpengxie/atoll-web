import { isMobileProfile } from '../model/device-profile.js';

// "醒过来"是应用层的判断,恒不是传输层的:wire 只知道自己断了,不知道这块屏幕
// 是被人重新看见了,还是网卡刚换回 wifi。所以由这里订阅,把事件喂给它。
//
// 手机上这两件事恒同时发生:锁屏一分钟,服务端 60 秒读超时把连接判死;人解锁回来
// 时,客户端还在退避定时器里干等。等的那几十秒就是"掉线"的全部体感——连接早就
// 该重建了,只是没有人叫醒它。
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
