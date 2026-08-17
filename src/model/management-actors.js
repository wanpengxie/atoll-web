import { REGISTRAR_DECL_ID, SYSTEM_ACTOR_ID } from '../protocol/vocab.js';

export const CORE_ACTOR_DECL_ID = 'coreactor';

export function resolveManagementActors(rows = []) {
  const system = rows.find((row) => row.id === SYSTEM_ACTOR_ID) || null;
  const registrar = rows.find((row) => row.decl_id === REGISTRAR_DECL_ID) || null;
  const coreactor = rows.find((row) => row.decl_id === CORE_ACTOR_DECL_ID) || null;
  return {
    system,
    registrar,
    coreactor,
    channelRegistry: registrar || coreactor,
  };
}
