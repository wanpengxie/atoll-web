import { useEffect, useState } from 'react';
import { isMobileProfile } from '../../model/device-profile.js';

// 每秒一次的相对时间(「运行了 12 秒」「3 分钟前」)。它便宜,但它触发的是一次
// 全局重渲染,而且是一秒一次。
//
// 手机上页面被切到后台时,这一秒一次照跑不误——没有人在看,电却在掉。所以移动端
// 在不可见时停表,回到前台先补一次读数再重新起表:时间恒不会显示成停住的,只是
// 没人看的时候不走。PC 维持原样(一直走),那里这点开销无所谓,也免得两端的行为
// 在同一台机器上分叉。
export function useSecondTick(active, resetKey = null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const tick = () => setNow(Date.now());
    if (!isMobileProfile() || !globalThis.document?.addEventListener) {
      const timer = window.setInterval(tick, 1000);
      return () => window.clearInterval(timer);
    }
    let timer = 0;
    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
    };
    const sync = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      tick();
      if (!timer) timer = window.setInterval(tick, 1000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [active, resetKey]);
  return now;
}
