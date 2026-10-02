import { GENERATED_BODY } from '../protocol/vocab.js';

// 频道里有两种成员：频道描述里写着的（人、人加进来的 agent 和工具，手写的 peer
// 也算），和运行时自己生成的（服务门、peer、handle、c0 的 registrar）。后者没有
// 描述条目，也不归人增删，名册、治理面板和时间线都不显示它们。判据只有一个：
// 后端给的 body 是 "generated"（名册行、成员加入的那行都带）。

export function isGeneratedMember(row) {
  return row?.body === GENERATED_BODY;
}

export function isVisibleActor(row) {
  return !isGeneratedMember(row);
}

// 挑成员时可用的 actor 描述：present 的，每条描述（按 id）只取最新版本。
// 名字只显示，两条描述可以同名。
export function latestActorDescriptions(rows = []) {
  const latest = new Map();
  for (const entry of rows || []) {
    const row = entry?.declared || entry || {};
    if (!row.id || (row.status && row.status !== 'present')) continue;
    const current = latest.get(row.id);
    if (!current || Number(row.version || 0) > Number(current.version || 0)) latest.set(row.id, row);
  }
  return [...latest.values()].sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), 'zh-CN')
    || String(left.id).localeCompare(String(right.id)));
}

// 引用一条 actor 描述的某一版：<描述 id>@<版本>。
export function actorDescriptionRef(row) {
  return String(row?.ref || (row?.id && row?.version ? `${row.id}@${row.version}` : ''));
}
