import { describe, expect, it } from 'vitest';
import { visibleRosterRows } from '../src/ui/roster-visibility.js';

describe('roster visibility', () => {
  it('hides standard actors while preserving humans and business agents', () => {
    const rows = [
      { id: 'root', kind: 'human' },
      { id: 'steward', kind: 'agent', decl_id: 'mock:steward' },
      { id: 'system', kind: 'system' },
      { id: 'registrar', kind: 'tool', decl_id: 'atoll-internal:registrar-seat' },
      { id: 'svcactor', kind: 'tool', decl_id: 'atoll-internal:svcactor' },
      { id: 'generated-core', kind: 'tool', decl_id: 'coreactor' },
    ];

    expect(visibleRosterRows(rows).map((row) => row.id)).toEqual(['root', 'steward']);
  });
});
