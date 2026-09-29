import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDownstream } from '../src/protocol/frame.js';
import { ENVELOPE_FIELDS } from '../src/protocol/envelope.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/atoll-contract-v5.json', import.meta.url), 'utf8'));

describe('atoll contract v5 fixtures', () => {
  it('[TC-0546] parses every authoritative downstream frame shape', () => {
    for (const [name, value] of Object.entries(fixtures.downstream)) {
      const parsed = parseDownstream(JSON.stringify(value));
      expect(parsed.kind, name).not.toBe('invalid');
      expect(parsed.kind, name).not.toBe('bad_version');
      expect(parsed.kind, name).not.toBe('unknown');
    }
  });

  it('[TC-0547][AD-253] keeps feed envelope fields within the real closed vocabulary', () => {
    const envelope = fixtures.downstream.feed.payload.envelope;
    expect(Object.keys(envelope).filter((field) => !ENVELOPE_FIELDS.includes(field))).toEqual([]);
    expect(envelope.channel_id).toBe(fixtures.downstream.feed.payload.channel_id);
  });

  it('[TC-0548] pins all six real OBS observation kinds and completeness', () => {
    // /obs/space/decls 换成了 /obs/space/actor-descriptions（名字@版本一行）。
    expect(Object.keys(fixtures.observations).sort()).toEqual(['actor-descriptions', 'actors', 'channels', 'daemons', 'principals', 'profile']);
    expect(fixtures.observations['actor-descriptions'].items[0]).toMatchObject({ key: 'research@1', declared: { name: 'research', version: 1, ref: 'research@1', status: 'present' } });
    // 名册行用 body 说成员从什么造，不再有 decl_id。
    expect(fixtures.observations.actors.items[0].declared).toMatchObject({ body: 'class codex' });
    expect(fixtures.observations.actors.items[0].declared).not.toHaveProperty('decl_id');
    for (const [kind, observation] of Object.entries(fixtures.observations)) {
      expect(observation.kind).toBe(kind);
      expect(typeof observation.complete).toBe('boolean');
      expect(Array.isArray(observation.items)).toBe(true);
    }
  });

  it('[TC-0549][AD-255] pins the real terminal payload carriers', () => {
    // registrar 类的词回 {status, value}；system actor 自己答的词把回复平铺在 status 旁边。
    expect(fixtures.structured.registrar_reply).toMatchObject({ status: 'completed', value: { channel_id: 'c0.project' } });
    expect(fixtures.structured.registrar_error.error_code).toBe('permission_denied');
    expect(fixtures.structured.member_list_reply.actors[0]).toMatchObject({ id: expect.any(String), kind: 'agent', present: true });
    // member.create 写的是频道描述里的条目：回复带描述的新版本号。
    expect(fixtures.structured.member_create_reply).toMatchObject({ status: 'completed', written: true, description_revision: expect.any(Number), entry: { name: expect.any(String) } });
    expect(fixtures.structured.agent_ask_reply).toMatchObject({ status: 'completed', text: expect.any(String) });
    // actor.describe = Describe 平铺：class / interfaces / capabilities / words。
    expect(fixtures.structured.actor_describe).toMatchObject({ class: 'codex', interfaces: ['actor', 'agent'] });
    expect(fixtures.structured.actor_describe.words['agent.ask'].description).toBeTruthy();
    expect(fixtures.downstream.resource_receipt.payload).toHaveProperty('ticket');
    expect(fixtures.downstream.resource_receipt.payload).toHaveProperty('redeem');
  });
});
