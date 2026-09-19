const STANDARD_ACTOR_IDS = new Set(['system', 'registrar', 'svcactor']);
const STANDARD_ACTOR_DECLARATIONS = new Set([
  'registrar',
  'svcactor',
  'atoll-internal:registrar-seat',
  'atoll-internal:svcactor',
  'coreactor',
]);
const GENESIS_DECLARATION_PREFIXES = Object.freeze(['atoll-internal:', 'peer:']);

export function isStandardActorIdentity({ id = '', declarationId = '', decl_id = '' } = {}) {
  const actorId = String(id);
  const declaration = String(declarationId || decl_id);
  return STANDARD_ACTOR_IDS.has(actorId)
    || STANDARD_ACTOR_DECLARATIONS.has(declaration)
    || GENESIS_DECLARATION_PREFIXES.some((prefix) => declaration.startsWith(prefix));
}

export function isVisibleActor(row) {
  return row?.kind !== 'system'
    && !isStandardActorIdentity({
      id: row?.id,
      declarationId: row?.decl_id || row?.declarationId,
    });
}

// Directory declarations are candidate inputs to member admission. The
// directory projection treats a missing status as not-yet-classified, while an
// explicit non-present state is not eligible. The same identity policy as
// roster visibility removes genesis seats without hiding ordinary business
// declarations.
export function isManageableDeclaration(row) {
  const declaration = row?.declared || row || {};
  const id = declaration.id || declaration.decl_id || declaration.declarationId;
  if (!id || (declaration.status && declaration.status !== 'present')) return false;
  return !isStandardActorIdentity({
    id,
    declarationId: declaration.decl_id || declaration.declarationId || id,
  });
}
