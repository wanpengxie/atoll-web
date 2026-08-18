import { describe, expect, it } from 'vitest';
import { messagePresentation } from '../src/model/message-presentation.js';

describe('message presentation adapters', () => {
  it('renders protocol payloads as product language instead of JSON', () => {
    expect(messagePresentation({ type: 'channel.create', payload: { name: 'operation-room' } })).toEqual({ text: '创建子频道', detail: 'operation-room' });
    expect(messagePresentation({ type: 'channel.introduce_actor', payload: { kind: 'human', principal: 'alice' } })).toEqual({ text: '添加参与者', detail: 'alice' });
  });

  it('never serializes unknown payload objects or leaks sensitive hints', () => {
    expect(messagePresentation({ type: 'vendor.custom', payload: { nested: { value: 1 }, token: 'secret' } })).toEqual({ text: '提交了一项操作', detail: '' });
  });
});
