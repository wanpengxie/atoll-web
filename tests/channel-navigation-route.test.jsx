// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useChannelNavigation } from '../src/app/hooks/useWireSession.js';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '#/channels/c0/conversation');
});

function navigation(rowsRef = { current: [
    { id: 'c0', name: 'c0', access: 'member_active' },
    { id: 'c1', name: 'c1', access: 'member_active' },
  ] }) {
  const accessRef = { current: { rows: () => rowsRef.current } };
  return renderHook(() => useChannelNavigation({
    accessRef,
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

  it('retains terminal visibility per channel and closes only the active channel', () => {
    const { result } = navigation();

    act(() => result.current.setTerminalVisible(true));
    act(() => result.current.select('c1'));
    expect(result.current.terminalVisible).toBe(false);

    act(() => result.current.setTerminalVisible(true));
    act(() => result.current.select('c0'));
    expect(result.current.terminalVisible).toBe(true);

    act(() => result.current.setTerminalVisible(false));
    act(() => result.current.select('c1'));
    expect(result.current.terminalVisible).toBe(true);
  });

  it('retires terminal visibility when a channel is removed or the world is replaced', () => {
    const rowsRef = { current: [
      { id: 'c0', name: 'c0', access: 'member_active' },
      { id: 'c1', name: 'c1', access: 'member_active' },
    ] };
    const { result } = navigation(rowsRef);

    act(() => result.current.setTerminalVisible(true));
    rowsRef.current = [rowsRef.current[1]];
    act(() => result.current.bump());
    expect(result.current.activeChannelId).toBe('c1');
    expect(result.current.terminalVisible).toBe(false);

    act(() => result.current.setTerminalVisible(true));
    rowsRef.current = [];
    act(() => result.current.setChannels(new Map()));
    expect(result.current.terminalVisible).toBe(false);

    rowsRef.current = [
      { id: 'c0', name: 'c0', access: 'member_active' },
      { id: 'c1', name: 'c1', access: 'member_active' },
    ];
    act(() => result.current.bump());
    act(() => result.current.select('c1'));
    expect(result.current.terminalVisible).toBe(false);
  });
});
