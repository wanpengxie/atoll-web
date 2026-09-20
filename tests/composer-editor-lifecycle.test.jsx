// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
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

  it('installs the edit session text instead of the ordinary draft document', async () => {
    const commands = { changeDraft: vi.fn(), cancelEdit: vi.fn(), edit: vi.fn() };
    const ordinary = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: 'ordinary draft survives processing edit', recipients: [] },
      roster: ROSTER,
      access: 'member_active',
      agentSelection: { selectedAgentId: 'agent:claude:1' },
    });
    const editing = buildComposerModel({
      activeChannelId: 'c0',
      draft: ordinary.draft,
      edit: {
        session: {
          channelId: 'c0', sessionId: 'edit-1', targetId: 'work',
          text: 'processing task text', attachments: [], phase: 'editing',
        },
        onSave: vi.fn(), onAbandon: vi.fn(),
      },
      roster: ROSTER,
      access: 'member_active',
      agentSelection: { selectedAgentId: 'agent:claude:1' },
    });
    const view = render(<Composer model={ordinary} commands={commands} />);
    const editor = () => document.querySelector('[data-testid="composer-input"]');
    await waitFor(() => expect(editor()?.textContent).toContain('ordinary draft survives processing edit'));

    view.rerender(<Composer model={editing} commands={commands} />);
    await waitFor(() => expect(editor()?.textContent).toContain('processing task text'));

    view.rerender(<Composer model={ordinary} commands={commands} />);
    await waitFor(() => expect(editor()?.textContent).toContain('ordinary draft survives processing edit'));
  });
});
