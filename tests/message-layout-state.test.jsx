// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMessageLayoutStore, MessageLayoutProvider, MessageLayoutScope, useMessageLayoutState } from '../src/ui/timeline/MessageLayoutState.jsx';
import { createViewSessionStore } from '../src/model/view-session.js';
import { MermaidBlock } from '../src/ui/MermaidBlock.jsx';

vi.mock('mermaid', () => ({ default: { initialize() {}, render: async () => ({ svg: '<svg />' }) } }));
afterEach(cleanup);

function Choice() {
  const [open, setOpen] = useMessageLayoutState('details', false);
  return <button aria-expanded={open} onClick={() => setOpen((value) => !value)}>details</button>;
}

it('keeps geometry choices across recycled rows without leaking to another row', () => {
  const store = createMessageLayoutStore();
  const ui = (id, shown = true) => <MessageLayoutProvider store={store}>
    <MessageLayoutScope rowID={id}>{shown && <Choice key={id} />}</MessageLayoutScope>
  </MessageLayoutProvider>;
  const view = render(ui('a'));
  fireEvent.click(view.getByRole('button'));
  view.rerender(ui('a', false));
  view.rerender(ui('b'));
  expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  view.rerender(ui('a'));
  expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
});

it('preserves presentation choices even in following sessions, independently of measurement snapshots', () => {
  const sessions = createViewSessionStore();
  const store = createMessageLayoutStore([], (layoutChoices) => sessions.writeConversation('a', { layoutChoices }));
  store.set('expanded', ['child-a'], []);
  const copy = sessions.read('a');
  copy.layoutChoices[0][1].push('not-persisted');
  expect(sessions.read('a').layoutChoices).toEqual([['expanded', ['child-a']]]);
  expect(sessions.read('a')).not.toHaveProperty('viewportSnapshot');
  expect(sessions.read('b').layoutChoices).toEqual([]);
  const restored = createMessageLayoutStore(sessions.read('a').layoutChoices);
  expect(restored.get('expanded', [])).toEqual(['child-a']);
});

it('preserves Mermaid source geometry after the row is recycled', async () => {
  const store = createMessageLayoutStore();
  const ui = (shown) => <MessageLayoutProvider store={store}><MessageLayoutScope rowID="message">
    {shown && <MermaidBlock code="graph TD; A-->B" layoutKey="body:0" />}
  </MessageLayoutScope></MessageLayoutProvider>;
  let view;
  await act(async () => { view = render(ui(true)); });
  fireEvent.click(view.getByRole('button', { name: '查看源码' }));
  view.rerender(ui(false));
  await act(async () => view.rerender(ui(true)));
  expect(view.getByRole('button', { name: '查看图表' }).isConnected).toBe(true);
});

it('keeps standalone previews local and notifies only the affected choice', () => {
  const store = createMessageLayoutStore();
  const a = vi.fn(), b = vi.fn();
  const unsubscribe = store.subscribe('a', a);
  store.subscribe('b', b);
  store.set('a', true, false);
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
  unsubscribe();
  store.set('a', false, true);
  expect(a).toHaveBeenCalledTimes(1);
  const view = render(<Choice />);
  fireEvent.click(view.getByRole('button'));
  expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
});
