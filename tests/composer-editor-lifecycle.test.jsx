// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { buildComposerModel } from '../src/ui/composer/composer-model.js';

afterEach(() => cleanup());

const ROSTER = [
  { id: 'human:root:1', kind: 'human', name: 'root' },
  { id: 'agent:claude:1', kind: 'agent', name: 'claude' },
];

function model(channelId) {
  return buildComposerModel({
    activeChannelId: channelId,
    draft: { text: '', recipients: [] },
    roster: ROSTER,
    access: 'member_active',
    agentSelection: { selectedAgentId: 'agent:claude:1' },
  });
}

describe('Composer EditorView handoff', () => {
  it('survives a rapid channel replacement before the next EditorContent view is attached', async () => {
    const commands = { changeDraft: vi.fn() };
    const errors = [];
    const onError = (event) => {
      if (/editor view is not available|Cannot read properties of null/.test(String(event.error?.message || event.message))) {
        errors.push(event.error || event);
      }
    };
    window.addEventListener('error', onError);
    try {
      const view = render(<Composer model={model('c0')} commands={commands} />);
      await act(async () => {
        view.rerender(<Composer model={model('c0.project')} commands={commands} />);
        await new Promise((resolve) => setTimeout(resolve, 10));
        view.rerender(<Composer model={model('c0')} commands={commands} />);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(errors).toEqual([]);
      expect(document.querySelector('[data-composer-channel="c0"]')).not.toBeNull();
    } finally {
      window.removeEventListener('error', onError);
    }
  });
});
