import { describe, expect, it } from 'vitest';
import { redactSensitive } from './terminal-result.js';

describe('shared structured redaction policy', () => {
  it('redacts deep key/token fields while preserving exact non-sensitive names', () => {
    const input = {
      text: 'keep this business text',
      token_count: 2,
      keynote: 'keep this ordinary field',
      nested: {
        key: 'secret-key',
        token: 'secret-token',
        TOKEN: 'secret-upper-token',
        records: [{ password: 'secret-password', label: 'keep label' }],
      },
      array: [{ private_key: 'secret-private-key', tokenized: 'keep tokenized' }],
    };

    expect(redactSensitive(input)).toEqual({
      text: 'keep this business text',
      token_count: 2,
      keynote: 'keep this ordinary field',
      nested: {
        key: '已隐藏',
        token: '已隐藏',
        TOKEN: '已隐藏',
        records: [{ password: '已隐藏', label: 'keep label' }],
      },
      array: [{ private_key: '已隐藏', tokenized: 'keep tokenized' }],
    });
    expect(input.nested.key).toBe('secret-key');
    expect(input.nested.token).toBe('secret-token');
  });
});
