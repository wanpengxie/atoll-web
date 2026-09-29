import { GENERATED_BODY, SYSTEM_MEMBER_NAMES } from '../protocol/vocab.js';

// 频道里有两种成员：频道描述里写着的（人加进来的 agent、工具），和运行时自己
// 生成的（服务门、peer、handle、c0 的 registrar）。后者没有描述条目，也不归人
// 增删，名册和治理面板都不显示它们。判据是事实本身：名册行的 body 是
// "generated"，或者 kind 是 system / peer；老缓存里没有 body 的行按名字兜底。
const SYSTEM_NAMES = new Set(['system', ...SYSTEM_MEMBER_NAMES]);

// actor id 是 <kind>:<名字>:<届次>；名字是中间那段。
export function actorMemberName(id) {
  const parts = String(id || '').split(':');
  return parts.length >= 3 ? parts.slice(1, -1).join(':') : String(id || '');
}

export function isStandardActorIdentity({ id = '', kind = '', body = '', name = '' } = {}) {
  if (kind === 'human') return false;
  if (kind === 'system' || kind === 'peer') return true;
  if (body === GENERATED_BODY) return true;
  const memberName = String(name || actorMemberName(id));
  return SYSTEM_NAMES.has(String(id)) || SYSTEM_NAMES.has(memberName);
}

export function isVisibleActor(row) {
  return !isStandardActorIdentity({
    id: row?.id,
    kind: row?.kind,
    body: row?.body,
    name: actorMemberName(row?.id),
  });
}

// 挑成员时可用的 actor 描述：present 的，每个名字只取最新版本。
export function latestActorDescriptions(rows = []) {
  const latest = new Map();
  for (const entry of rows || []) {
    const row = entry?.declared || entry || {};
    if (!row.name || (row.status && row.status !== 'present')) continue;
    const current = latest.get(row.name);
    if (!current || Number(row.version || 0) > Number(current.version || 0)) latest.set(row.name, row);
  }
  return [...latest.values()].sort((left, right) => String(left.name).localeCompare(String(right.name), 'zh-CN'));
}

export function actorDescriptionRef(row) {
  return String(row?.ref || (row?.name && row?.version ? `${row.name}@${row.version}` : ''));
}
