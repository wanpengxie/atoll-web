const STANDARD_ACTOR_IDS = new Set(['system', 'registrar', 'svcactor']);
const STANDARD_ACTOR_DECLARATIONS = new Set([
  'registrar',
  'svcactor',
  'atoll-internal:registrar-seat',
  'atoll-internal:svcactor',
  'coreactor',
]);

export function isStandardActorIdentity({ id = '', declarationId = '' } = {}) {
  return STANDARD_ACTOR_IDS.has(String(id)) || STANDARD_ACTOR_DECLARATIONS.has(String(declarationId));
}

export function isVisibleActor(row) {
  return !isStandardActorIdentity({ id: row?.id, declarationId: row?.decl_id });
}
