// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingContainerHandoff } from '../src/ui/timeline/ReadingContainerHandoff.jsx';

const probes = vi.hoisted(() => ({ following: null, browsing: null, navigation: null }));

vi.mock('../src/ui/timeline/ReadingNavigationOwner.jsx', () => ({
  ReadingNavigationOwner(props) {
    probes.navigation = props;
    return props.children;
  },
}));

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
  probes.navigation = null;
});

function reading(mode, inputEpoch = 1) {
  let session = { mode, inputEpoch, activationID: 'activation-1' };
  const port = {
    activationID: session.activationID,
    session,
    getSession: () => session,
    setSession(next) {
      session = next;
      port.session = session;
    },
  };
  return port;
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

  const ownerToken = {};
  const activeTarget = {
    ownerToken,
    activationID: 'activation-1', originInputEpoch: 1, inputGeneration: 2,
    transactionID: 'navigation:1', hostToken: 3, targetRevision: 1,
    presentationRevision: 7,
    bookmark: { messageID: 'row-7', rowViewportOffset: -12 },
    focusOwned: true, phase: 'active',
  };
  following.setSession({ mode: 'browsing', inputEpoch: 2, activationID: 'activation-1' });
  act(() => probes.navigation.onFollowingNavigationTarget(activeTarget));

  const browsing = following;
  view.rerender(<ReadingContainerHandoff
    reading={browsing}
    surfaceVisible
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);
  const outgoing = view.getByTestId('following-adapter').parentElement;
  const incoming = view.getByTestId('browsing-adapter').parentElement;
  expect(outgoing.hasAttribute('inert')).toBe(false);
  expect(outgoing.hasAttribute('aria-hidden')).toBe(false);
  expect(probes.following.active).toBe(true);
  expect(probes.browsing.handoffPending).toBe(true);
  expect(incoming.getAttribute('aria-hidden')).toBe('true');
  expect(incoming.hasAttribute('inert')).toBe(true);
  expect(probes.browsing.navigationTarget).toBe(activeTarget);

  const exactReceipt = {
    ...activeTarget,
    targetID: 'row-7',
    materialized: true,
    paintRevision: 1,
  };
  act(() => probes.browsing.onNavigationRevealReceipt({ ...exactReceipt, targetRevision: 0 }));
  expect(view.queryByTestId('following-adapter')).not.toBeNull();

  act(() => probes.navigation.onFollowingNavigationTarget({ ...activeTarget, phase: 'settled' }));
  act(() => probes.browsing.onNavigationRevealReceipt({ ...exactReceipt, targetRevision: 0 }));
  expect(view.queryByTestId('following-adapter')).not.toBeNull();

  act(() => probes.browsing.onNavigationRevealReceipt(exactReceipt));
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
