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

  it('conversation words always prefer the real message body over protocol labels', () => {
    expect(messagePresentation({ type: 'agent.ask', payload: { text: '帮我检查这份设计' } })).toEqual({ text: '帮我检查这份设计', detail: '' });
    expect(messagePresentation({ type: 'agent.ask', payload: { content: [{ type: 'text', text: '来自内容块的真实消息' }] } })).toEqual({ text: '来自内容块的真实消息', detail: '' });
    expect(messagePresentation({ type: 'agent.ask', payload: {} })).toEqual({ text: '没有可显示的消息正文', detail: '' });
  });

  // 线上每条 request 的 payload 是 `{_context?, body}`：参数在 body 里。不拆这层，
  // 人发给 agent 的每一句都会显示成"没有可显示的消息正文"——正文一直在，只是没人拆。
  it('reads a request through its body wrapper, and older rows without one', () => {
    const wrapped = (type, body) => ({
      kind: 'request', type,
      payload: { _context: { caller: { channel: 'c0', actor: 'human:root:1' } }, body },
    });
    expect(messagePresentation(wrapped('agent.ask', { text: '帮我把 root 拉进去' }))).toEqual({ text: '帮我把 root 拉进去', detail: '' });
    expect(messagePresentation(wrapped('system.member.create', { decl_id: 'reviewer' }))).toEqual({ text: '添加参与者', detail: 'reviewer' });
    expect(messagePresentation(wrapped('agent.ask', {}))).toEqual({ text: '没有可显示的消息正文', detail: '' });
    // 没有 body 这层的旧账本行照样读得出，回放历史不会一片空白。
    expect(messagePresentation({ kind: 'request', type: 'agent.ask', payload: { text: '旧账本的一句' } })).toEqual({ text: '旧账本的一句', detail: '' });
    // 响应与事件本来就没有这层包装，不能被误拆。
    expect(messagePresentation({ kind: 'response', type: 'agent.ask', payload: { status: 'completed', text: 'PONG' } })).toEqual({ text: 'PONG', detail: '' });
  });
});
