import { describe, expect, it } from 'vitest';
import { replyRecipient, replyTargetOf } from '../src/model/reply-target.js';

const roster = [
  { id: 'me', kind: 'human', name: '我' },
  { id: 'agent-1', kind: 'agent', name: '研究员' },
  { id: 'human-1', kind: 'human', name: '同事' },
];

describe('临时回复目标', () => {
  it('从消息 sender 建立收件人与截断摘要', () => {
    const target = replyTargetOf({ id: 'answer-1', sender: { id: 'agent-1', kind: 'agent' }, type: 'agent.ask', payload: { status: 'completed', text: '很长的回复 '.repeat(30) } }, { roster, selfId: 'me' });
    expect(target).toMatchObject({ sourceId: 'answer-1', senderId: 'agent-1', senderKind: 'agent', senderName: '研究员' });
    expect(target.excerpt.length).toBeLessThanOrEqual(96);
    expect(replyRecipient(target, roster)).toMatchObject({ id: 'agent-1' });
  });

  it('自己、系统与已不在 roster 的 sender 不能成为回复目标', () => {
    expect(replyTargetOf({ id: 'mine', sender: { id: 'me', kind: 'human' }, payload: { text: '自己' } }, { roster, selfId: 'me' })).toBeNull();
    expect(replyTargetOf({ id: 'system', sender: { id: 'system', kind: 'system' }, payload: { text: '系统' } }, { roster, selfId: 'me' })).toBeNull();
    expect(replyTargetOf({ id: 'gone', sender: { id: 'gone', kind: 'agent' }, payload: { text: '离开' } }, { roster, selfId: 'me' })).toBeNull();
  });
});
