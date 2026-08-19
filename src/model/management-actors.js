import { SYSTEM_ACTOR_ID, SYSTEM_DECL_IDS } from '../protocol/vocab.js';

const SYSTEM_DECLS = new Set(SYSTEM_DECL_IDS);

// 频道面和空间面现在只有一个收件人：本频道的 system actor。它自己答成员类的词，
// 把空间类的词转交 c0 的 registrar，所以客户端不再需要在名册里找 registrar 座位。
// 名册里也不会出现 system actor（system.member.list 不列自己），因此这里返回的是
// 一个恒定的收件人描述，而不是一次名册查找。
export const SYSTEM_ACTOR = Object.freeze({ id: SYSTEM_ACTOR_ID, kind: 'system', name: 'system' });

export function resolveManagementActors(rows = []) {
  const system = rows.find((row) => row.id === SYSTEM_ACTOR_ID) || SYSTEM_ACTOR;
  return { system };
}

export function isSystemDeclaration(declId) {
  return SYSTEM_DECLS.has(declId) || String(declId || '').startsWith('peer:');
}
