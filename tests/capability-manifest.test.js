import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildComposerModel } from '../src/ui/composer/composer-model.js';

// The manifest is the product acceptance inventory. Live actor capability
// truth is projected by useAgentProbes and consumed by the public Composer
// command/model owners; these tests intentionally assert the manifest rather
// than importing a deleted projection or recreating a second capability store.
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

  it('covers every planned stage and leaves live actor truth to the Composer owner', () => {
    for (const stage of manifest.stages) {
      expect(manifest.capabilities.some((capability) => capability.stage === stage), stage).toBe(true);
    }
  });

  it('gates a current Agent command from the public Composer model without a second capability store', () => {
    const roster = [{ id: 'agent-1', kind: 'agent', name: '研究员' }];
    const capabilityIndex = new Map([['agent-1', {
      describe: { types: new Map([['agent.compact', { inputSchema: { type: 'object' } }]]) },
    }]]);
    const model = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: '/compact', recipients: [] },
      roster,
      access: 'member_active',
      agentSelection: { target: { kind: 'single', agent: roster[0] } },
      capabilityIndex,
    });
    expect(model.controls.commands.compact).toMatchObject({ state: 'supported', enabled: true });
    expect(model.controls.commands.fork).toMatchObject({ state: 'unsupported', enabled: false });
  });
});
