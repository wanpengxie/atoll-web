import { describe, expect, it } from 'vitest';
import {
  assessRequestOwner,
  captureRequestOwner,
  executeOwnedPhase,
  REQUEST_PHASE,
} from '../src/model/request-owner.js';

function facts(owner, change = {}) {
  return {
    principalId: owner.principalId,
    principalEpoch: owner.principalEpoch,
    channelId: owner.channelId,
    worldEpoch: owner.worldEpoch,
    attemptEpoch: owner.attemptEpoch,
    access: owner.access,
    transport: owner.transport,
    transportEpoch: owner.transportEpoch,
    transportOpen: true,
    draft: owner.draft,
    ...change,
  };
}

describe('request transaction owner', () => {
  it('rejects revoke/regrant access epochs instead of adopting current membership', () => {
    const transport = {};
    const owner = captureRequestOwner({
      principalId: 'p', principalEpoch: 1, channelId: 'c', worldEpoch: 'boot-a', attemptEpoch: 2,
      accessState: { authorityEpoch: 4, relationship: 'member', existence: 'present', runtime: 'open' },
      transport, transportEpoch: 3,
    });
    expect(assessRequestOwner(owner, facts(owner, {
      access: { ...owner.access, epoch: 6, relationship: 'member' },
    }), REQUEST_PHASE.submit)).toMatchObject({ current: false, code: 'access_changed' });
  });

  it('keeps durable world and local attempt fences independent', () => {
    const owner = captureRequestOwner({
      principalId: 'p', principalEpoch: 1, channelId: 'c', worldEpoch: 'boot-b', attemptEpoch: 8,
      accessState: { authorityEpoch: 1, relationship: 'member', existence: 'present', runtime: 'open' },
      transport: {}, transportEpoch: 1,
    });
    expect(assessRequestOwner(owner, facts(owner, { attemptEpoch: 9 }), REQUEST_PHASE.settle))
      .toMatchObject({ current: false, code: 'attempt_changed' });
    expect(assessRequestOwner(owner, facts(owner, { worldEpoch: 'boot-c' }), REQUEST_PHASE.settle))
      .toMatchObject({ current: false, code: 'world_changed' });
  });

  it('checks draft ownership again after an awaited side effect', async () => {
    const owner = captureRequestOwner({
      principalId: 'p', principalEpoch: 1, channelId: 'c', worldEpoch: 'boot', attemptEpoch: 1,
      accessState: { authorityEpoch: 1, relationship: 'member', existence: 'present', runtime: 'open' },
      transport: {}, transportEpoch: 1, draft: { epoch: 2 },
    });
    let draftEpoch = 2;
    const result = await executeOwnedPhase({
      owner,
      current: () => facts(owner, { draft: { epoch: draftEpoch } }),
      phase: REQUEST_PHASE.submit,
      options: { requireDraft: true },
      effect: async () => { draftEpoch = 3; return 'completed'; },
    });
    expect(result).toMatchObject({ started: true, current: false, value: 'completed' });
    expect(result.invalidation).toMatchObject({ code: 'draft_changed' });
  });
});
