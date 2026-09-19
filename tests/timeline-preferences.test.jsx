// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useTimelinePreferences } from '../src/ui/timeline/useTimelinePreferences.js';

afterEach(cleanup);

it('owns channel preferences and persists every choice through one write port', async () => {
  const store = createViewSessionStore({ storage: null });
  store.writeConversation('c0', {
    scope: 'all',
    actorFilter: ['agent:a'],
    foldOverrides: [['message:body', true]],
    layoutChoices: [['layout', false]],
  });
  const writeConversation = vi.fn((...args) => store.writeConversation(...args));
  const viewSessions = { ...store, writeConversation };
  const { result } = renderHook(() => useTimelinePreferences({ channelId: 'c0', viewSessions }));

  expect(result.current.scope).toBe('all');
  expect([...result.current.actorFilter]).toEqual(['agent:a']);
  expect([...result.current.foldOverrides]).toEqual([['message:body', true]]);
  expect(result.current.messageLayoutStore.get('layout', true)).toBe(false);

  act(() => {
    result.current.toggleScope();
    result.current.toggleActorFilter('agent:b');
    result.current.removeActorFilter('agent:a');
    result.current.toggleFold('message:body', false);
    result.current.messageLayoutStore.set('layout', true, false);
  });

  await waitFor(() => expect(store.read('c0')).toMatchObject({
    scope: 'mine',
    actorFilter: ['agent:b'],
    foldOverrides: [['message:body', false]],
    layoutChoices: [['layout', true]],
  }));
  expect(writeConversation.mock.calls.every(([channelId]) => channelId === 'c0')).toBe(true);
});

it('does not let a suspended channel candidate steal the committed preference owner', async () => {
  const store = createViewSessionStore({ storage: null });
  const writeConversation = vi.fn((...args) => store.writeConversation(...args));
  const viewSessions = { ...store, writeConversation };
  const never = new Promise(() => {});
  let candidateRendered = false;

  function Suspender({ active }) {
    if (active) {
      candidateRendered = true;
      throw never;
    }
    return null;
  }
  function Preferences({ channelId, suspend }) {
    const preferences = useTimelinePreferences({ channelId, viewSessions });
    return <>
      <button type="button" onClick={() => preferences.messageLayoutStore.set('details', true, false)}>choose layout</button>
      <Suspender active={suspend} />
    </>;
  }
  function Harness() {
    const [candidate, setCandidate] = React.useState(false);
    return <>
      <button type="button" onClick={() => React.startTransition(() => setCandidate(true))}>start candidate</button>
      <React.Suspense fallback={<div>candidate fallback</div>}>
        <Preferences channelId={candidate ? 'c1' : 'c0'} suspend={candidate} />
      </React.Suspense>
    </>;
  }

  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'start candidate' }));
  await waitFor(() => expect(candidateRendered).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'choose layout' }));

  expect(writeConversation.mock.calls.some(([channelId]) => channelId === 'c0')).toBe(true);
  expect(writeConversation.mock.calls.some(([channelId]) => channelId === 'c1')).toBe(false);
});
