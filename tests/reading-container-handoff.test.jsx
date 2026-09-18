// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingContainerHandoff } from '../src/ui/timeline/ReadingContainerHandoff.jsx';

const probes = vi.hoisted(() => ({ following: null, browsing: null }));

vi.mock('../src/ui/timeline/FollowingTailList.jsx', () => ({
  FollowingTailList(props) {
    probes.following = props;
    return <div data-testid="following-adapter" />;
  },
}));

vi.mock('../src/ui/timeline/LegendMessageList.jsx', () => ({
  MessageList(props) {
    probes.browsing = props;
    return <div data-testid="browsing-adapter" />;
  },
}));

afterEach(() => {
  cleanup();
  probes.following = null;
  probes.browsing = null;
});

function reading(mode, inputEpoch = 1) {
  const session = { mode, inputEpoch, activationID: 'activation-1' };
  return { activationID: session.activationID, session, getSession: () => session };
}

it('keeps one inert outgoing paint only until browsing commits readiness', () => {
  const following = reading('following');
  const view = render(<ReadingContainerHandoff
    reading={following}
    surfaceVisible
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);
  expect(view.queryByTestId('following-adapter')).not.toBeNull();
  expect(view.queryByTestId('browsing-adapter')).toBeNull();

  act(() => probes.following.onHandoffStart({
    activationID: 'activation-1', inputEpoch: 1, focusOwned: true,
  }));

  const browsing = reading('browsing', 2);
  view.rerender(<ReadingContainerHandoff
    reading={browsing}
    surfaceVisible
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);
  const outgoing = view.getByTestId('following-adapter').parentElement;
  const incoming = view.getByTestId('browsing-adapter').parentElement;
  expect(outgoing.hasAttribute('inert')).toBe(true);
  expect(outgoing.getAttribute('aria-hidden')).toBe('true');
  expect(probes.following.active).toBe(false);
  expect(probes.browsing.handoffPending).toBe(true);
  expect(incoming.hasAttribute('aria-hidden')).toBe(false);

  act(() => probes.browsing.onHandoffReady({ activationID: 'activation-1' }));
  expect(view.queryByTestId('following-adapter')).toBeNull();
  expect(view.getByTestId('browsing-adapter').parentElement.className).toContain('is-active');
  expect(probes.browsing.handoffPending).toBe(false);
});

it('mounts a restored browsing session directly without duplicating the row tree', () => {
  const restored = reading('browsing', 4);
  const view = render(<ReadingContainerHandoff
    reading={restored}
    surfaceVisible
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);
  expect(view.queryByTestId('following-adapter')).toBeNull();
  expect(view.getByTestId('browsing-adapter').parentElement.className).toContain('is-active');
  expect(probes.browsing.handoffPending).toBe(false);
});
