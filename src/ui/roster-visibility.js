import { isVisibleActor } from '../model/actor-visibility.js';

export function visibleRosterRows(rows = []) {
  return rows.filter(isVisibleActor);
}
