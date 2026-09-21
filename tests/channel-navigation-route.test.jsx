// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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
  it('SZ-331 writes ordinary routes once and restores a focused Context on Back/Forward', async () => {
    const { result } = navigation();
    const historyStart = window.history.length;

    // Ordinary view navigation replaces the current route. It carries a
    // typed non-Context state and does not consume a browser history slot.
    act(() => result.current.setActiveView('tasks'));
    expect(window.history.length).toBe(historyStart);
    expect(window.location.hash).toBe('#/channels/c0/tasks');
    expect(window.history.state).toMatchObject({
      atollContextEntry: false,
      atollRoute: { channelId: 'c0', view: 'tasks', focus: null },
    });

    // A focused Context is the one new browser entry for the openTaskItem
    // sequence (setActiveView('tasks') followed by setFocus(...)).
    act(() => result.current.setFocus({ type: 'work_item', key: 'task-1' }));
    expect(window.history.length).toBe(historyStart + 1);
    expect(window.location.hash).toBe('#/channels/c0/tasks?focus=work_item%3Atask-1');
    expect(window.history.state).toMatchObject({
      atollContextEntry: true,
      atollRoute: {
        channelId: 'c0',
        view: 'tasks',
        focus: { type: 'work_item', key: 'task-1' },
      },
    });

    window.history.back();
    await waitFor(() => {
      expect(result.current.activeView).toBe('tasks');
      expect(result.current.focus).toBeNull();
      expect(window.location.hash).toBe('#/channels/c0/tasks');
    });

    window.history.forward();
    await waitFor(() => {
      expect(result.current.activeView).toBe('tasks');
      expect(result.current.focus).toEqual({ type: 'work_item', key: 'task-1' });
      expect(window.location.hash).toBe('#/channels/c0/tasks?focus=work_item%3Atask-1');
    });
  });

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

  it('remembers Files visibility per channel without opening it on an unseen channel', () => {
    const { result } = navigation();

    act(() => result.current.setActiveView('files'));
    act(() => result.current.select('c1'));
    expect(result.current.activeView).toBe('conversation');
    expect(window.location.hash).toBe('#/channels/c1/conversation');

    act(() => result.current.select('c0'));
    expect(result.current.activeView).toBe('files');
    expect(window.location.hash).toBe('#/channels/c0/files');

    act(() => result.current.select('c1'));
    act(() => result.current.setActiveView('files'));
    act(() => result.current.select('c0'));
    expect(result.current.activeView).toBe('files');
    act(() => result.current.select('c1'));
    expect(result.current.activeView).toBe('files');
  });

  it('retires Files and its per-channel memory across an empty world replacement', async () => {
    const rowsRef = { current: [
      { id: 'c0', name: 'c0', access: 'member_active' },
      { id: 'c1', name: 'c1', access: 'member_active' },
    ] };
    const { result } = navigation(rowsRef);

    act(() => result.current.setActiveView('files'));
    expect(result.current.activeView).toBe('files');

    rowsRef.current = [];
    act(() => result.current.setChannels(new Map()));
    expect(result.current.activeChannelId).toBe('');
    expect(result.current.activeView).toBe('conversation');

    rowsRef.current = [{ id: 'c1', name: 'c1', access: 'member_active' }];
    act(() => result.current.setChannels(new Map([['c1', rowsRef.current[0]]] )));
    await waitFor(() => expect(result.current.activeChannelId).toBe('c1'));
    expect(result.current.activeView).toBe('conversation');
    expect(window.location.hash).toBe('#/channels/c1/conversation');

    rowsRef.current = [
      { id: 'c0', name: 'c0', access: 'member_active' },
      rowsRef.current[0],
    ];
    act(() => result.current.bump());
    act(() => result.current.select('c0'));
    expect(result.current.activeView).toBe('conversation');
    expect(window.location.hash).toBe('#/channels/c0/conversation');
  });

  it('falls back from an invalid Files URL to a valid channel conversation', async () => {
    window.history.replaceState({}, '', '#/channels/missing/files');
    const rowsRef = { current: [{ id: 'c1', name: 'c1', access: 'member_active' }] };
    const { result } = navigation(rowsRef);

    await waitFor(() => expect(result.current.activeChannelId).toBe('c1'));
    expect(result.current.activeView).toBe('conversation');
    expect(window.location.hash).toBe('#/channels/c1/conversation');
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
