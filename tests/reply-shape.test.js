import { describe, expect, it } from 'vitest';
import { answeredByRegistrar, systemReplyValue } from '../src/protocol/reply-shape.js';

describe('system reply shape', () => {
  it('reads a registrar word as its value, a system-door word flat — by the word, never by guessing', () => {
    expect(answeredByRegistrar('system.channel.set')).toBe(true);
    expect(answeredByRegistrar('system.member.create')).toBe(true);
    expect(answeredByRegistrar('system.member.admit')).toBe(true);
    expect(answeredByRegistrar('system.member.get')).toBe(false);
    expect(answeredByRegistrar('system.member.config.set')).toBe(false);
    expect(systemReplyValue({ status: 'completed', value: { revision: 2 } }, 'system.channel.set')).toEqual({ revision: 2 });
    // 一个平铺回复里恰好只有一个叫 value 的字段，也不当成 registrar 的 {value}。
    expect(systemReplyValue({ status: 'completed', value: 'x' }, 'system.member.config.get')).toEqual({ value: 'x' });
    expect(systemReplyValue({ status: 'completed', member: 'w', revision: 1 }, 'system.member.config.set')).toEqual({ member: 'w', revision: 1 });
  });
});
