import { invalidateScopeIndex } from './timeline-scope.js';

// 这一页在内存里留多少账。
//
// 每个访问过的频道都留着一整套信封(rows 是完整消息,turns/standalone 指向同一批
// 对象),而且只增不减——IndexedDB 那层反而有字节预算会 trim,内存这层一直没有。
// 一条 agent 长回答几 KB,一个频道四万条,一页里还同时留着好几个频道:手机就是
// 这么被 Chrome 以内存压力丢掉的,而"标签页被丢弃"在人眼里就是"它自己刷新了"。
//
// 所以移动端给它定一个窗口。**窗口不是删历史**:被摘掉的行仍在 IndexedDB 里,
// 往回翻时按需读回(readCache → loadHistory,历史分页现在就走这条路)。
export const MOBILE_WINDOW = Object.freeze({ maxRows: 500, maxBytes: 8 * 1024 * 1024 });
// 迟滞:超了才动手,一次砍到水位的八成。恒不每来一行砍一行——那会让"刚滑出屏幕
// 的那条"反复地被丢掉又读回,抖动比省下的内存更贵。
const KEEP_RATIO = 0.8;

// 只量最容易变大的那几处(payload 顶层的字符串:text、result、detail…),恒不为了
// 一个兜底阀门把整条消息序列化一遍——那是每行一次的代价,而这只是个阀门。
// 代价:嵌套很深的大结构会被低估,所以行数才是主水位,字节只是防"一条巨大的工具
// 输出把窗口撑爆"。
export function estimateRowBytes(envelope) {
  let bytes = 256;
  const payload = envelope?.payload;
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      if (typeof value === 'string') bytes += value.length;
    }
  }
  return bytes;
}

function openTurnFloor(state) {
  let floor = Number.POSITIVE_INFINITY;
  for (const turn of state.turns.values()) {
    if (turn.terminal) continue;
    // 还没闭合的 turn 整段留住:它随时会再长出帧,而半段 turn 恒不能渲染。
    if (turn.requestSeq < floor) floor = turn.requestSeq;
  }
  return floor;
}

// 返回被摘掉的行数。纯函数式的副作用:只改 state 自己的索引,恒不碰账本和缓存。
export function trimChannelState(state, { maxRows, maxBytes } = MOBILE_WINDOW) {
  if (!state?.rows?.size) return 0;
  const seqs = [...state.rows.keys()].sort((left, right) => left - right);
  const keep = Math.max(1, Math.floor(maxRows * KEEP_RATIO));
  // 从最新的一头往回数,行数和字节谁先到就在哪儿断。两条水位都要真的能拦住:
  // 只数行数,一条几百 KB 的工具输出会把窗口撑爆;只数字节,一堆小状态帧又会把
  // 表撑长。
  let bytes = 0;
  let cutIndex = 0;
  for (let index = seqs.length - 1; index >= 0; index -= 1) {
    cutIndex = index;
    bytes += estimateRowBytes(state.rows.get(seqs[index]));
    if (seqs.length - index >= keep || bytes > maxBytes) break;
  }
  if (cutIndex <= 0) return 0;
  const floor = openTurnFloor(state);
  let cut = seqs[cutIndex];
  if (!Number.isFinite(cut)) return 0;
  if (cut > floor) cut = floor;
  let removed = 0;
  for (const seq of seqs) {
    if (seq >= cut) break;
    const envelope = state.rows.get(seq);
    state.rows.delete(seq);
    if (envelope?.id) {
      state._seenIds.delete(envelope.id);
      state._envelopesById.delete(envelope.id);
      state._unmatchedByParent?.delete(envelope.id);
    }
    removed += 1;
  }
  if (!removed) return 0;
  for (const [id, turn] of state.turns) {
    // 闭合了、且整段都在窗口外的才摘;开着的上面已经用 floor 保住了。
    if (turn.terminal && Math.max(turn.requestSeq, turn.terminalSeq || 0, turn.lastSeq || 0) < cut) state.turns.delete(id);
  }
  for (const [correlation, ids] of state.correlations) {
    const alive = ids.filter((id) => state.turns.has(id));
    if (alive.length) state.correlations.set(correlation, alive);
    else state.correlations.delete(correlation);
  }
  // 等父亲的孤儿:父亲被摘掉的整条丢掉(它永远等不到了),自己也在窗口外的逐条丢掉。
  for (const [parentId, waiting] of state._unmatchedByParent || []) {
    const alive = waiting.filter((item) => item.seq >= cut);
    if (alive.length) state._unmatchedByParent.set(parentId, alive);
    else state._unmatchedByParent.delete(parentId);
  }
  state.standalone = state.standalone.filter((item) => item.seq >= cut);
  state.orphans = state.orphans.filter((item) => item.seq >= cut);
  state.narration = state.narration.filter((item) => item.seq >= cut);
  // 低水位:窗口的下沿在哪儿。它是一条记录事实,恒不当拦截条件——历史回读本来就
  // 要把水位以下的行补回来,拦掉它等于把"往回翻"一起拦掉。
  state.evictedThrough = Math.max(state.evictedThrough || 0, cut - 1);
  // 「我的往来」索引是按 seq 单向增量长起来的,窗口一动它的基线就不成立了。
  invalidateScopeIndex(state);
  return removed;
}
