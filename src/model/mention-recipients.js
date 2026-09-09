// mention 是一个动词，不是一段文本。
//
// 从前它是正文里的一个 ProseMirror 节点：@ 选中的人留在句子里，发送时再把节点
// 扫出来当收件人。于是正文里任何一个 "@" 都得先证明自己不是收件人——粘一段带
// @ 的文本、写一个邮箱、写 "@codex /compact"，整条消息都发不出去。收件人这件事
// 本来就不住在正文里：它住在输入框上沿那条常显的收件人条上。
//
// 所以这里的模型是：@ 只是打开选择框的快捷键；选中之后，那个人从正文里消失，
// 变成收件人条上的一枚可摘除的芯片。正文自此恒是纯文本，@ 在正文里就只是 @。
//
// 芯片记的是当时那一行的快照，因为草稿会跨频道切换活着，而名册随时会变。快照
// 只用于在成员消失后还能把名字说出来；能不能发恒以当前名册为准（resolveRecipients
// 的 missing），恒不静默丢掉一个收件人。前端只认一件事：这个 actor id 还在不在
// 名册里。它为什么不在（被移出、重新引入成了另一个 actor）恒不归前端判断。

export function recipientSnapshot(row) {
  return { id: String(row?.id || ''), label: String(row?.label || row?.name || ''), kind: String(row?.kind || '') };
}

export function addRecipient(list = [], row) {
  const next = recipientSnapshot(row);
  if (!next.id || list.some((item) => item.id === next.id)) return list;
  return [...list, next];
}

export function removeRecipient(list = [], id) {
  return list.filter((item) => item.id !== id);
}

// 芯片显示用当前名册的真名；名册里没有这个 id 就标 missing——显示成警告格，
// 发送时逐个报出来，恒不当作"没 @ 过"退回默认目标。
export function resolveRecipients(list = [], roster = []) {
  return list.map((item) => {
    const row = roster.find((candidate) => candidate.id === item.id);
    // 解出来的行就是名册行的形状（name/kind），下游的 actorDisplayName、拆发定词
    // 恒按同一种行读，恒不为芯片另造一套字段。
    if (!row) return { ...item, name: item.label || item.id, missing: true };
    return { ...row, label: row.name || item.label || row.id, missing: false };
  });
}

export function normalizeRecipients(value) {
  if (!Array.isArray(value)) return [];
  const rows = [];
  for (const item of value) {
    const row = recipientSnapshot(item);
    if (row.id && !rows.some((existing) => existing.id === row.id)) rows.push(row);
  }
  return rows;
}
