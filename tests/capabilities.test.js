import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capabilityIndexFromState, capabilityRisk, normalizeDescribe, supportsType } from '../src/model/capabilities.js';
import { fold } from '../src/model/fold.js';

const manifest = JSON.parse(readFileSync(new URL('../contracts/product-capabilities.json', import.meta.url), 'utf8'));

describe('product capability manifest', () => {
  it('has a stable top-level contract and unique capability ids', () => {
    expect(manifest.schema_version).toBe(1);
    expect(manifest.product).toBe('atoll-web');
    expect(manifest.stages).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(manifest.capabilities.length).toBeGreaterThanOrEqual(20);
    const ids = manifest.capabilities.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of manifest.capabilities) {
      expect(capability.id).toMatch(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
      expect(manifest.stages).toContain(capability.stage);
      expect(typeof capability.implementation).toBe('string');
    }
  });

  it('contains implementation and acceptance evidence for every capability', () => {
    const scenarios = new Set(manifest.scenarios);
    for (const capability of manifest.capabilities) {
      expect(capability.user_task).toBeTruthy();
      expect(capability.ui_region).toBeTruthy();
      expect(capability.backend.length).toBeGreaterThan(0);
      expect(capability.preconditions.length).toBeGreaterThan(0);
      expect(capability.accepted_evidence).toBeTruthy();
      expect(capability.completed_evidence).toBeTruthy();
      expect(capability.browser_acceptance.length).toBeGreaterThan(0);
      expect(typeof capability.real_server_check).toBe('boolean');
      for (const scenario of capability.mock_scenarios) expect(scenarios.has(scenario)).toBe(true);
    }
  });

  it('covers every planned delivery stage', () => {
    for (const stage of manifest.stages) {
      expect(manifest.capabilities.some((capability) => capability.stage === stage)).toBe(true);
    }
  });
});

const envelope = (id, kind, type, payload, extra = {}) => ({
  id, ts: 1, channel_id: 'c0', sender: kind === 'request' ? { kind: 'human', id: 'me' } : { kind: 'agent', id: 'agent' },
  kind, type, payload, audience: kind === 'request' ? ['agent'] : ['me'], visibility: 'public', ...extra,
});

describe('actor capabilities', () => {
  it('normalizes the Describe surface (class / interfaces / capabilities / words)', () => {
    const value = normalizeDescribe({
      class: 'codex', interfaces: ['actor', 'agent'], capabilities: { steer: true },
      words: { run: { description: '跑一次', input_schema: { type: 'object', properties: { text: { type: 'string' } } }, error_codes: ['busy'] } },
    });
    expect(value.className).toBe('codex');
    expect(value.interfaces).toEqual(['actor', 'agent']);
    expect(value.capabilities.steer).toBe(true);
    expect(value.types.get('run')).toMatchObject({ description: '跑一次', errorCodes: [{ code: 'busy' }] });
    expect(supportsType({ describe: value }, 'run')).toBe(true);
    expect(supportsType({ describe: value }, 'missing')).toBe(false);
    expect(capabilityRisk('agent.stop')).toBe('high');
    expect(capabilityRisk('agent.steer')).toBe('medium');
  });

  it('rebuilds and merges full/single-word Describe from ledger turns', () => {
    const rows = [
      envelope('d1', 'request', 'actor.describe', {}, {}),
      envelope('d1-done', 'response', 'actor.describe', { status: 'completed', class: 'codex', interfaces: ['actor'], capabilities: {}, words: { 'agent.ask': { description: 'text' } } }, { parent_id: 'd1' }),
      envelope('d2', 'request', 'actor.describe', { type: 'agent.steer' }),
      envelope('d2-done', 'response', 'actor.describe', { status: 'completed', class: 'codex', interfaces: ['actor'], capabilities: {}, words: { 'agent.steer': { description: 'steer' } } }, { parent_id: 'd2' }),
    ].map((value, index) => ({ channel_id: 'c0', seq: index + 1, envelope: value }));
    const entry = capabilityIndexFromState(fold(rows)).get('agent');
    expect([...entry.describe.types.keys()]).toEqual(['agent.ask', 'agent.steer']);
    expect(entry.loading).toBe(false);
  });
});
