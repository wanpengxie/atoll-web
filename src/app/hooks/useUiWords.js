import { useEffect, useRef } from 'react';
import { execute } from '../../model/ui-words.js';

// useUiWords 是 ui.* 的**不纯**那一半：盯住账本里发给我、还开着的 ui.* 请求，
// 执行，回帧。
//
// 没有任何"服务端推给浏览器"的通道，也不需要——**账本本身就是下行**。请求落进
// 日志，客户端本来就在订阅，看见发给自己的就干活。这也是为什么这条链路一行传输
// 代码都不用加。
// version 是必需的，不是可选优化：channelStatesRef.current 是一个**原地变更**
// 的 Map，它的身份从不改变，所以拿它当依赖的 effect 永远不会因为"来了新请求"
// 而重跑。feed 的版本号是这里唯一如实反映"账本动过了"的东西。
export function useUiWords({ channelStatesRef, version, session, selfIdFor, wireRef, actions, readSnapshot, enabled = true }) {
  // 一条请求在终态回到账本之前会一直留在 uiRequests 里，所以必须自己记住做过
  // 什么，否则同一条会被反复执行——ui.navigate 反复执行只是多余，
  // 但任何有副作用的词都会因此出错。
  const handledRef = useRef(new Set());
  const actionsRef = useRef(actions);
  const snapshotRef = useRef(readSnapshot);
  actionsRef.current = actions;
  snapshotRef.current = readSnapshot;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      for (const [channelId, state] of channelStatesRef.current) {
        if (!state?.uiRequests?.size) continue;
        const selfId = selfIdFor(channelId);
        if (!selfId) continue;
        for (const envelope of state.uiRequests.values()) {
          if (handledRef.current.has(envelope.id)) continue;
          handledRef.current.add(envelope.id);
          const frame = await execute(envelope, {
            session,
            actions: actionsRef.current,
            readSnapshot: snapshotRef.current,
          });
          if (cancelled) return;
          if (!frame) continue; // 点名了别的屏幕,这块不掺和
          try {
            await wireRef.current?.resolve(frame);
          } catch {
            // 回帧没发出去（多半是连接断了）。把它从已办里拿掉，重连后账本上
            // 那条请求仍然开着，会被重新受理——比留一条永远不会有人答的请求好。
            handledRef.current.delete(envelope.id);
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [channelStatesRef, enabled, selfIdFor, session, version, wireRef]);
}
