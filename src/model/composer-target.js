// composer 上方那条常显横幅读的是这里：它回答"我现在按回车，这条去哪"。
//
// 它恒与 Composer.submit 同源。横幅说发给谁，回车就发给谁；两处一旦分叉，
// 横幅比没有更坏——人照着它按回车，消息去了别处，而那正是它要治的病。
//
// 判据链（自上而下，第一个命中即止），与 submit 的分支一一对应：
//   回复态  → 被回复的那一位；对方已不在名册就是"发不出去"，恒不静默退回默认目标
//   @ 过人  → 收件人条上的全部芯片（含人类——submit 也是全发，不是只发 agent）
//   没 @ 过 → 默认目标（筛选 > 手选 > 最近交互 > 唯一 agent，见 resolveParameterAgent）
//   都没有  → 无收件人；此时回车会被拒，所以横幅在这一格必须是警告而不是留白
//
// recipients 是 @ 选中后落到收件人条上的那组字段（见 mention-recipients.js），
// 恒不是从正文里扫出来的——正文里的 @ 只是 @。
export function composerDelivery({ recipients = [], replyTarget = null, replyRecipient = null, fallbackAgent = null, fallbackSource = '' }) {
  if (replyTarget) {
    if (!replyRecipient) return { kind: 'lost', rows: [], source: '', lostName: replyTarget.senderName || '' };
    return { kind: 'direct', rows: [replyRecipient], source: 'reply' };
  }
  if (recipients.length > 0) return { kind: 'direct', rows: recipients, source: 'mention' };
  if (fallbackAgent) return { kind: 'direct', rows: [fallbackAgent], source: fallbackSource };
  return { kind: 'none', rows: [], source: '' };
}

// 来源不是装饰：横幅要治的是"我以为发给了他"，而说清"凭什么是他"才治得住。
// 缺来源（判据链没报）时不硬编一个，宁可只报收件人。
export const DELIVERY_SOURCE_LABELS = Object.freeze({
  reply: '回复',
  mention: '由 @ 指定',
  filter: '默认 · 跟随筛选',
  manual: '默认 · 手选',
  recent: '默认 · 最近交互',
  only: '默认 · 频道唯一 Agent',
});

export function deliverySourceLabel(source) {
  return DELIVERY_SOURCE_LABELS[source] || '';
}
