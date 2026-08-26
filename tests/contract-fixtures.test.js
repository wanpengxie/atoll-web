import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDownstream } from '../src/protocol/frame.js';
import { ENVELOPE_FIELDS } from '../src/protocol/envelope.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/atoll-contract-v4.json', import.meta.url), 'utf8'));

describe('atoll contract v4 fixtures', () => {
  it('parses every authoritative downstream frame shape', () => {
    for (const [name, value] of Object.entries(fixtures.downstream)) {
      const parsed = parseDownstream(JSON.stringify(value));
      expect(parsed.kind, name).not.toBe('invalid');
      expect(parsed.kind, name).not.toBe('bad_version');
      expect(parsed.kind, name).not.toBe('unknown');
    }
  });

  it('keeps feed envelope fields within the real closed vocabulary', () => {
    const envelope = fixtures.downstream.feed.payload.envelope;
    expect(Object.keys(envelope).filter((field) => !ENVELOPE_FIELDS.includes(field))).toEqual([]);
    expect(envelope.channel_id).toBe(fixtures.downstream.feed.payload.channel_id);
  });

  it('pins all six real OBS observation kinds and completeness', () => {
    expect(Object.keys(fixtures.observations).sort()).toEqual(['actors', 'channels', 'daemons', 'decls', 'principals', 'profile']);
    for (const [kind, observation] of Object.entries(fixtures.observations)) {
      expect(observation.kind).toBe(kind);
      expect(typeof observation.complete).toBe('boolean');
      expect(Array.isArray(observation.items)).toBe(true);
    }
  });

  it('pins the real terminal payload carriers', () => {
    // registrar 类的词回 {status, value}；system actor 自己答的词把回复平铺在 status 旁边。
    expect(fixtures.structured.registrar_reply).toMatchObject({ status: 'completed', value: { channel_id: 'c0.project' } });
    expect(fixtures.structured.registrar_error.error_code).toBe('permission_denied');
    expect(fixtures.structured.member_list_reply.actors[0]).toMatchObject({ id: expect.any(String), kind: 'agent', present: true });
    expect(fixtures.structured.member_create_reply.member).toBeTruthy();
    expect(fixtures.structured.agent_ask_reply).toMatchObject({ status: 'completed', text: expect.any(String) });
    // actor.describe = Describe 平铺：class / interfaces / capabilities / words。
    expect(fixtures.structured.actor_describe).toMatchObject({ class: 'codex', interfaces: ['actor', 'agent'] });
    expect(fixtures.structured.actor_describe.words['agent.ask'].description).toBeTruthy();
    expect(fixtures.downstream.resource_receipt.payload).toHaveProperty('ticket');
    expect(fixtures.downstream.resource_receipt.payload).toHaveProperty('redeem');
  });
});
