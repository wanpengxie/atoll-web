import { GENERATED_BODY } from '../protocol/vocab.js';

// 频道里有两种成员：频道描述里写着的（人、agent、工具、peer、svcactor，c0 的
// registrar、steward、meta peer 也是），和运行时自己推导的（只有把手：另一个
// 频道的座位的另一头）。后者没有描述条目，也不归人增删，名册、治理面板和时间线
// 都不显示它们。判据只有一个：后端给的 body 是 "generated"。

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

// 描述的显示名：名字可以重复，同名的几条后面带上 id 的前 8 位好区分。
export function actorDescriptionName(row, rows = []) {
  const name = String(row?.name || row?.id || '');
  const id = String(row?.id || '');
  const clash = (rows || []).some((other) => {
    const value = other?.declared || other || {};
    return value.id && value.id !== id && String(value.name || '') === String(row?.name || '');
  });
  return clash && id ? `${name}（${id.slice(0, 8)}）` : name;
}

// 引用一条 actor 描述的某一版：<描述 id>@<版本>。
export function actorDescriptionRef(row) {
  return String(row?.ref || (row?.id && row?.version ? `${row.id}@${row.version}` : ''));
}
