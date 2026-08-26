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
const SELF_OPERATION_TYPES = new Set(['terminal.command']);

function isSelfOperation(envelope) {
  return SELF_OPERATION_TYPES.has(envelope?.type);
}

function directlyMine(envelope, selfId) {
  if (!selfId || !envelope) return false;
  if (envelope.sender?.id === selfId) return true;
  return Array.isArray(envelope.audience) && envelope.audience.includes(selfId);
}

// relatedEnvelopeIds 走的是频道收到的全部信封（state.rows），不是当前可见的那一页：
// 第二层要拿第一层的 id 去比对，而第一层可能落在窗口之外。
export function relatedEnvelopeIds(state, selfId) {
  const rows = [...(state?.rows?.values?.() || [])];
  const ids = new Set();
  const correlations = new Set();
  for (const envelope of rows) {
    if (isSelfOperation(envelope)) continue;
    if (!directlyMine(envelope, selfId)) continue;
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

function turnEnvelopes(turn, out) {
  if (!turn) return;
  if (turn.request) out.push(turn.request);
  for (const item of turn.provisional || []) if (item?.envelope) out.push(item.envelope);
  if (turn.terminal) out.push(turn.terminal);
}

// scopeEntries 判的是条目，不是信封：一段对话里只要有一条与我相关，整段都留下。
// 半段对话比没有更难读——问句在、答句不在，读的人会以为对方没回。
//
// narration 是频道级叙事，不属于任何人的往来，两个范围下都保留。
export function scopeEntries(entries, { scope, state, selfId }) {
  if (scope !== TIMELINE_SCOPE.mine || !selfId) return entries;
  const visible = relatedEnvelopeIds(state, selfId);
  return entries.filter((entry) => {
    if (entry.kind === 'narration') return true;
    const envelopes = entryEnvelopes(entry);
    // 整条都是我自己的操作 → 恒不出现；混在一段对话里则跟随那段对话。
    if (envelopes.length > 0 && envelopes.every(isSelfOperation)) return false;
    return envelopes.some((envelope) => envelope?.id && visible.has(envelope.id));
  });
}

// 一个 workspace 里常有好几个 agent，往来混在一条流里。按成员过滤要的是「我跟他
// 那几段」，所以判据与 scopeEntries 同律：判的是**条目**不是信封——一段对话里只要
// 有一条与选中的成员有关，整段都留下。半段对话比没有更难读。
//
// narration 是频道级叙事，恒不属于任何人的往来。没有过滤时它照常在（scopeEntries
// 两个范围下都留它）；一旦挑明了「只看我跟某某」，它就不在那个问题的答案里。
export function filterEntriesByActors(entries, actorIds) {
  if (!actorIds?.size) return entries;
  return entries.filter((entry) => {
    if (entry.kind === 'narration') return false;
    return entryEnvelopes(entry).some((envelope) => (
      actorIds.has(envelope?.sender?.id)
      || (Array.isArray(envelope?.audience) && envelope.audience.some((id) => actorIds.has(id)))
    ));
  });
}
