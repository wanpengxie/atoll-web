// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useChannelNavigation } from '../src/app/hooks/useWireSession.js';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '#/channels/c0/conversation');
});

function navigation() {
  const rows = [
    { id: 'c0', name: 'c0', access: 'member_active' },
    { id: 'c1', name: 'c1', access: 'member_active' },
  ];
  return renderHook(() => useChannelNavigation({
    accessRef: { current: { rows: () => rows } },
    rosterRef: { current: null },
  }));
}

describe('useChannelNavigation Files/Tasks temporary return owner', () => {
  it('restores Files when Dynamic closes a Tasks excursion', () => {
    const { result } = navigation();

    act(() => result.current.setActiveView('files'));
    act(() => result.current.setActiveView('tasks'));
    expect(result.current.activeView).toBe('tasks');

    act(() => result.current.setActiveView('conversation'));
    expect(result.current.activeView).toBe('files');
    expect(window.location.hash).toBe('#/channels/c0/files');
  });

  it('does not restore Files for a conversation-only excursion and clears explicit close', () => {
    const { result } = navigation();

    act(() => result.current.setActiveView('tasks'));
    act(() => result.current.setActiveView('conversation'));
    expect(result.current.activeView).toBe('conversation');

    act(() => result.current.setActiveView('files'));
    act(() => result.current.setActiveView('tasks'));
    act(() => result.current.setActiveView('conversation'));
    expect(result.current.activeView).toBe('files');

    act(() => result.current.setActiveView('conversation'));
    expect(result.current.activeView).toBe('conversation');
  });

  it('clears the temporary return on channel and world replacement', () => {
    const { result } = navigation();

    act(() => {
      result.current.setActiveView('files');
      result.current.setActiveView('tasks');
      result.current.setActiveChannelId('c1');
      result.current.setActiveView('conversation');
    });
    expect(result.current.activeView).toBe('conversation');

    act(() => {
      result.current.setActiveView('files');
      result.current.setActiveView('tasks');
      result.current.setChannels(new Map());
      result.current.setActiveView('conversation');
    });
    expect(result.current.activeView).toBe('conversation');
  });
});
