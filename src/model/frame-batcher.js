// 一帧里到的行,合成一批再落地。
//
// 直播行现在是**一条一条**落的:每条都自己走一遍 applyRows,自己 bump 一次
// version,于是每条消息都触发一次整棵树的重渲染 + 一次完整的时间线投影。agent
// 流式说话时一秒十几帧,手机就是这么被拖住的——它不是在算什么难的东西,它是把
// 同一件事做了十几遍。
//
// 合批只改落地的时机(最多晚一个动画帧),恒不改顺序,也恒不改内容。
//
// 页面不可见时 requestAnimationFrame 不会触发,所以那时改用定时器:后台标签页的
// 定时器会被浏览器降频,但它至少会来——恒不能让消息在缓冲区里无限期地攒着。
export function createFrameBatcher(flush, {
  raf = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelRaf = globalThis.cancelAnimationFrame?.bind(globalThis),
  timer = globalThis.setTimeout?.bind(globalThis),
  cancelTimer = globalThis.clearTimeout?.bind(globalThis),
  hidden = () => globalThis.document?.visibilityState === 'hidden',
  hiddenDelayMs = 250,
} = {}) {
  let queue = [];
  let handle = null;

  function run() {
    handle = null;
    const batch = queue;
    queue = [];
    if (batch.length) flush(batch);
  }

  return {
    push(item) {
      queue.push(item);
      if (handle) return;
      handle = hidden() || !raf ? { kind: 'timer', id: timer(run, hiddenDelayMs) } : { kind: 'raf', id: raf(run) };
    },
    // 立刻落地(切频道、断线这类"接下来的判断依赖账已经落好"的时刻)。
    flushNow() {
      if (handle) {
        if (handle.kind === 'raf') cancelRaf?.(handle.id);
        else cancelTimer?.(handle.id);
        handle = null;
      }
      run();
    },
    get size() {
      return queue.length;
    },
  };
}
