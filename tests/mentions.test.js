import { describe, expect, it } from 'vitest';
import { mentionTokens, resolveMentionRecipients } from '../src/ui/mentions.js';

const roster = [
  { id: 'steward', name: 'Steward', kind: 'agent' },
  { id: 'helper-1', name: 'helper', kind: 'agent' },
];

describe('composer mentions', () => {
  it('resolves typed mentions without requiring a menu click', () => {
    expect(mentionTokens('@steward 只回复 PONG')).toEqual(['steward']);
    expect(resolveMentionRecipients('@steward 只回复 PONG', roster)).toEqual({
      recipients: [roster[0]],
      unknown: [],
    });
  });

  it('reports unknown mentions instead of falling back to the only agent', () => {
    expect(resolveMentionRecipients('@ghost hello', [roster[0]])).toEqual({
      recipients: [],
      unknown: ['ghost'],
    });
  });

  it('deduplicates selected and typed recipients', () => {
    expect(resolveMentionRecipients('@Steward hello', roster, [roster[0]])).toEqual({
      recipients: [roster[0]],
      unknown: [],
    });
  });
});
