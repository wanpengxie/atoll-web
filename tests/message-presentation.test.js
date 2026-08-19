import { describe, expect, it } from 'vitest';
import { messagePresentation } from '../src/model/message-presentation.js';

describe('message presentation adapters', () => {
  it('renders protocol payloads as product language instead of JSON', () => {
    expect(messagePresentation({ type: 'system.channel.create', payload: { name: 'operation-room', recipe: { declarations: [] } } })).toEqual({ text: '创建子频道', detail: 'operation-room' });
    expect(messagePresentation({ type: 'system.member.admit', payload: { principal: 'alice' } })).toEqual({ text: '邀请成员加入', detail: 'alice' });
    expect(messagePresentation({ type: 'system.member.create', payload: { decl_id: 'demo:agent' } })).toEqual({ text: '添加参与者', detail: 'demo:agent' });
  });

  it('never serializes unknown payload objects or leaks sensitive hints', () => {
    expect(messagePresentation({ type: 'vendor.custom', payload: { nested: { value: 1 }, token: 'secret' } })).toEqual({ text: '提交了一项操作', detail: '' });
  });
});
