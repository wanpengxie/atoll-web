const STANDARD_ACTOR_IDS = new Set(['system']);
const STANDARD_ACTOR_DECL_IDS = new Set([
  'atoll-internal:registrar-seat',
  'atoll-internal:svcactor',
]);

export function visibleRosterRows(rows = []) {
  return rows.filter((row) => (
    !STANDARD_ACTOR_IDS.has(row.id)
    && !STANDARD_ACTOR_DECL_IDS.has(row.decl_id)
  ));
}
