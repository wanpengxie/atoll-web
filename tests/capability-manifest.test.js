import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The old src/model/capabilities.js projection was retired with the fold
// compatibility surface.  The product capability manifest remains the
// canonical acceptance inventory; live actor capability truth is now owned by
// useAgentProbes + agent-parameters, covered by the Composer tests.
const manifest = JSON.parse(readFileSync(new URL('../contracts/product-capabilities.json', import.meta.url), 'utf8'));

describe('current capability manifest contract', () => {
  it('keeps the manifest identity, stages and capability keys stable', () => {
    expect(manifest).toMatchObject({
      schema_version: 1,
      product: 'atoll-web',
      stages: ['A', 'B', 'C', 'D', 'E'],
    });
    const ids = manifest.capabilities.map((capability) => capability.id);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id))).toBe(true);
  });

  it('requires implementation and user-facing acceptance evidence for every capability', () => {
    const scenarios = new Set(manifest.scenarios);
    for (const capability of manifest.capabilities) {
      expect(capability.user_task, capability.id).toBeTruthy();
      expect(capability.ui_region, capability.id).toBeTruthy();
      expect(capability.backend.length, capability.id).toBeGreaterThan(0);
      expect(capability.preconditions.length, capability.id).toBeGreaterThan(0);
      expect(capability.accepted_evidence, capability.id).toBeTruthy();
      expect(capability.completed_evidence, capability.id).toBeTruthy();
      expect(capability.browser_acceptance.length, capability.id).toBeGreaterThan(0);
      for (const scenario of capability.mock_scenarios) expect(scenarios.has(scenario), `${capability.id}:${scenario}`).toBe(true);
    }
  });

  it('covers every planned stage without reviving the retired capability index', () => {
    for (const stage of manifest.stages) {
      expect(manifest.capabilities.some((capability) => capability.stage === stage), stage).toBe(true);
    }
    expect(manifest.capabilities.some((capability) => capability.id === 'actor.capabilities')).toBe(false);
  });
});
