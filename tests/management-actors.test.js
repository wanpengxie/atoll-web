import { describe, expect, it } from 'vitest';
import { resolveManagementActors } from '../src/model/management-actors.js';

describe('management actor resolver', () => {
  it('uses registrar in c0 and a decl-based coreactor in ordinary channels', () => {
    const c0 = resolveManagementActors([{ id: 'random-registrar', decl_id: 'atoll-internal:registrar-seat' }, { id: 'system' }]);
    expect(c0.channelRegistry.id).toBe('random-registrar');
    expect(c0.system.id).toBe('system');
    const ordinary = resolveManagementActors([{ id: 'generated-peer-id', decl_id: 'coreactor' }, { id: 'some-tool', kind: 'tool' }]);
    expect(ordinary.channelRegistry.id).toBe('generated-peer-id');
    expect(ordinary.registrar).toBeNull();
  });
});
