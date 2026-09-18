import { correlationOf } from '../protocol/envelope.js';

// 频道账本记的是整个频道的往来。人在里面找自己那条线时，要的不是「我说过的话」——
// 那样会把 agent 的回答、工具的活动、被我问到的人的答复全部切掉，剩下一串自言自语。
// 要的是「我参与的那几段对话」，所以范围按两层取：
//
//   第一层  我直接发起或直接收到的消息
//   第二层  以第一层为父、或与第一层同属一个 correlation 的消息
//
// 第二层里 correlation 那一半是关键：一次请求引出的回执、活动事件、以及被调方再
// 转出去的子请求，全都挂在同一个 correlation 上，所以一层 correlation 就把整棵
// 往来树接了进来，不需要真的做传递闭包。parent 那一半兜住没有 correlation 的旧形。

export const TIMELINE_SCOPE = Object.freeze({ all: 'all', mine: 'mine' });

export const TIMELINE_SCOPE_LABELS = Object.freeze({
  [TIMELINE_SCOPE.all]: '全部',
  [TIMELINE_SCOPE.mine]: '@我',
});

// 「@我」要的是我参与的**对话**。有些消息作者虽是我，却恒不是对话——它们是
// 我自己动手的记录，我在那件事发生的地方（终端）已经全程看着了，账本上留一份
// 是为了让 agent 读得到，恒不是为了再讲给我听一遍。
//
// 这类消息在「全部」下照常可见——账本恒是完整的，被收窄的只是这一个视图。
const SELF_OPERATION_TYPES = new Set(['terminal.command', 'terminal.session']);

function isSelfOperation(envelope) {
  return SELF_OPERATION_TYPES.has(envelope?.type);
}

function humanPrincipal(actorId) {
  const id = String(actorId || '');
  const separator = id.includes('::') ? '::' : ':';
  const segments = id.split(separator);
  return segments.length >= 3 && segments[0] === 'human' && segments[1] && segments[2]
    ? segments[1]
    : '';
}

// A human principal survives channel-member restarts while its actor id does
// not. "@ me" is a reading scope for that person, so historical rows from an
// older incarnation remain mine. Participant filters below deliberately keep
// exact actor-id semantics: only the self scope crosses human incarnations.
function isSelfActor(actorId, selfId) {
  if (!actorId || !selfId) return false;
  if (actorId === selfId) return true;
  const selfPrincipal = humanPrincipal(selfId);
  return Boolean(selfPrincipal && selfPrincipal === humanPrincipal(actorId));
}

function directlyMine(envelope, selfId) {
  if (!selfId || !envelope) return false;
  if (isSelfActor(envelope.sender?.id, selfId)) return true;
  return Array.isArray(envelope.audience)
    && envelope.audience.some((actorId) => isSelfActor(actorId, selfId));
}

// A scheduler fire is the one agent-authored/self-addressed fact that starts a
// channel-visible errand without a human envelope. The runtime welds this
// exact shape: timer:<id>, event, no parent, correlation rooted at itself and
// one audience member equal to the agent author. Seed only that closed shape;
// the ordinary parent/correlation pass below then carries agent.timer.wake and
// its progress/terminal frames without admitting generic agent self-traffic.
function isCanonicalAgentTimerFire(envelope) {
  const sender = envelope?.sender;
  return envelope?.kind === 'event'
    && typeof envelope.id === 'string'
    && envelope.id.startsWith('timer:')
    && !envelope.parent_id
    && envelope.correlation_id === envelope.id
    && sender?.kind === 'agent'
    && Boolean(sender.id)
    && Array.isArray(envelope.audience)
    && envelope.audience.length === 1
    && envelope.audience[0] === sender.id;
}

// relatedEnvelopeIds 走的是频道收到的全部信封（state.rows），不是当前可见的那一页：
// 第二层要拿第一层的 id 去比对，而第一层可能落在窗口之外。
// 「我的往来」这张集合是每帧都要的,而它原来每帧都从零算:先把整本账复制成数组
// (state.rows 有多少行就多大),再走两遍全量。agent 一秒吐十帧,这本账就被完整
// 走十遍——频道越老越慢,而这正是人最需要它跟手的时候。
//
// 增量版把已经判过的行记下来:集合只增不减,新来的行只判自己;而"一条新的我的行
// 会让更早的行变可见"这件事,靠一张只会变短的未决表兜住(late correlation 恒不
// 丢)。输出与全量版逐个元素相等——equivalence 由测试钉死,恒不靠眼看。
const scopeIndexes = new WeakMap();

// 返回 null = 基线不成立(窗口被裁剪过),由调用方整张重建——窗口有界,重建很便宜。
//
// 判据是"我处理过的行,是不是还都在表里",恒不用 seq 当水位:历史回读补回来的行
// 会挂在 Map 的末尾,迭代顺序自此不再等于 seq 顺序,拿水位一判就会把它们当成
// "早就处理过的"跳掉——刚读回来的历史于是在「我的往来」里是隐形的。
//
// 算法本身与顺序无关:第一遍只收"直接是我的"行,第二遍反复重扫那张只会变短的
// 未决表,所以一条行比它的因由先到也不会丢(late correlation 恒能补上)。
function ingestScopeRows(index, state) {
  const fresh = [];
  const ingest = (seq, envelope) => {
    index.processed.add(seq);
    if (isSelfOperation(envelope)) return;
    if (directlyMine(envelope, index.self) || isCanonicalAgentTimerFire(envelope)) {
      if (envelope.id) {
        index.ids.add(envelope.id);
        index.visible.add(envelope.id);
      }
      const correlation = correlationOf(envelope);
      if (correlation) index.correlations.add(correlation);
      return;
    }
    fresh.push(envelope);
  };
  if (Array.isArray(state._rowOrder)) {
    // createChannelState/apply 给出真正的增量游标。历史回读即使带来更小的
    // seq，也会按它进入内存的顺序追加到这里，所以恒不会被水位跳过。
    while (index.rowOffset < state._rowOrder.length) {
      const seq = state._rowOrder[index.rowOffset++];
      const envelope = state.rows.get(seq);
      if (!envelope) return null;
      ingest(seq, envelope);
    }
  } else {
    // 兼容单元测试和外部构造的旧 state 形状。
    for (const [seq, envelope] of state.rows) {
      if (index.processed.has(seq)) continue;
      ingest(seq, envelope);
    }
  }
  // 处理过的比表里还多 = 有行被摘走了,这张索引的基线不再成立。
  if (index.processed.size !== state.rows.size) return null;
  if (fresh.length) index.unresolved.push(...fresh);
  if (index.unresolved.length) {
    const still = [];
    for (const envelope of index.unresolved) {
      if (!envelope?.id || index.visible.has(envelope.id)) continue;
      if (envelope.parent_id && index.ids.has(envelope.parent_id)) index.visible.add(envelope.id);
      else if (index.correlations.has(correlationOf(envelope))) index.visible.add(envelope.id);
      else still.push(envelope);
    }
    index.unresolved = still;
  }
  return index.visible;
}

// 窗口移动(内存裁剪、历史回读)之后,增量索引的基线就不成立了:它按 seq 单向前进,
// 认不出"比水位更早的行又回来了"。丢掉重建即可——窗口是有界的,重建很便宜。
export function invalidateScopeIndex(state) {
  scopeIndexes.delete(state);
}

function freshScopeIndex(self) {
  return { self, rowOffset: 0, processed: new Set(), ids: new Set(), correlations: new Set(), visible: new Set(), unresolved: [] };
}

export function relatedEnvelopeIdsIncremental(state, self) {
  const cached = scopeIndexes.get(state);
  if (cached && cached.self === self) {
    const reused = ingestScopeRows(cached, state);
    if (reused) return reused;
  }
  const index = freshScopeIndex(self);
  scopeIndexes.set(state, index);
  // 空基线上恒不会不成立。
  return ingestScopeRows(index, state) || index.visible;
}

export function relatedEnvelopeIds(state, selfId) {
  const rows = [...(state?.rows?.values?.() || [])];
  const ids = new Set();
  const correlations = new Set();
  for (const envelope of rows) {
    if (isSelfOperation(envelope)) continue;
    if (!directlyMine(envelope, selfId) && !isCanonicalAgentTimerFire(envelope)) continue;
    if (envelope.id) ids.add(envelope.id);
    const correlation = correlationOf(envelope);
    if (correlation) correlations.add(correlation);
  }
  const visible = new Set(ids);
  for (const envelope of rows) {
    if (!envelope?.id || visible.has(envelope.id)) continue;
    if (isSelfOperation(envelope)) continue;
    if (envelope.parent_id && ids.has(envelope.parent_id)) visible.add(envelope.id);
    else if (correlations.has(correlationOf(envelope))) visible.add(envelope.id);
  }
  return visible;
}

// entryEnvelopes 把一个时间线条目摊成它含有的全部信封。一个 turn 是一段对话，不是
// 一条消息：请求、进展、终态、以及它带起来的子 turn 都算它的一部分。
export function entryEnvelopes(entry, out = []) {
  if (!entry) return out;
  if (entry.envelope) out.push(entry.envelope);
  if (entry.turn) turnEnvelopes(entry.turn, out);
  for (const child of entry.thread || []) turnEnvelopes(child.turn, out);
  return out;
}

function visitEntryEnvelopes(entry, visit) {
  if (!entry) return false;
  if (entry.envelope && visit(entry.envelope)) return true;
  if (entry.turn && visitTurnEnvelopes(entry.turn, visit)) return true;
  for (const child of entry.thread || []) {
    if (visitTurnEnvelopes(child.turn, visit)) return true;
  }
  return false;
}

function visitTurnEnvelopes(turn, visit) {
  if (!turn) return false;
  if (turn.request && visit(turn.request)) return true;
  for (const item of turn.provisional || []) {
    if (item?.envelope && visit(item.envelope)) return true;
  }
  return Boolean(turn.terminal && visit(turn.terminal));
}

function turnEnvelopes(turn, out) {
  if (!turn) return;
  if (turn.request) out.push(turn.request);
  for (const item of turn.provisional || []) if (item?.envelope) out.push(item.envelope);
  if (turn.terminal) out.push(turn.terminal);
}

// Timeline 的热路径只需要回答“这个条目是否命中”，不需要真的摊出一张临时数组。
// 保留 entryEnvelopes 给外部检查使用；投影本身走 visitor，避免每一帧为账上的每个
// turn 分配一次数组。
export function entryMatchesScope(entry, visible) {
  if (entry?.kind === 'narration') return true;
  let count = 0;
  let selfOperations = 0;
  let related = false;
  visitEntryEnvelopes(entry, (envelope) => {
    count += 1;
    if (isSelfOperation(envelope)) selfOperations += 1;
    if (envelope?.id && visible.has(envelope.id)) related = true;
    return false;
  });
  return count > 0 && selfOperations !== count && related;
}

export function entryMatchesActors(entry, actorIds) {
  if (!actorIds?.size) return true;
  if (entry?.kind === 'narration') return false;
  return visitEntryEnvelopes(entry, (envelope) => (
    actorIds.has(envelope?.sender?.id)
    || (Array.isArray(envelope?.audience) && envelope.audience.some((id) => actorIds.has(id)))
  ));
}

// scopeEntries 判的是条目，不是信封：一段对话里只要有一条与我相关，整段都留下。
// 半段对话比没有更难读——问句在、答句不在，读的人会以为对方没回。
//
// narration 是频道级叙事，不属于任何人的往来，两个范围下都保留。
export function scopeEntries(entries, { scope, state, selfId, incremental = false }) {
  if (scope !== TIMELINE_SCOPE.mine || !selfId) return entries;
  const visible = incremental ? relatedEnvelopeIdsIncremental(state, selfId) : relatedEnvelopeIds(state, selfId);
  return entries.filter((entry) => entryMatchesScope(entry, visible));
}

// 一个 workspace 里常有好几个 agent，往来混在一条流里。按成员过滤要的是「我跟他
// 那几段」，所以判据与 scopeEntries 同律：判的是**条目**不是信封——一段对话里只要
// 有一条与选中的成员有关，整段都留下。半段对话比没有更难读。
//
// narration 是频道级叙事，恒不属于任何人的往来。没有过滤时它照常在（scopeEntries
// 两个范围下都留它）；一旦挑明了「只看我跟某某」，它就不在那个问题的答案里。
export function filterEntriesByActors(entries, actorIds) {
  if (!actorIds?.size) return entries;
  return entries.filter((entry) => entryMatchesActors(entry, actorIds));
}
