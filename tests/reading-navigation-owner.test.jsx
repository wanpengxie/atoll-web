// @vitest-environment jsdom

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ReadingNavigationOwner,
  useReadingNavigationHost,
} from '../src/ui/timeline/ReadingNavigationOwner.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete globalThis.__ATOLL_READING_TRACE__;
});

function reading(mode = 'browsing') {
  let session = {
    activationID: 'activation:a', mode, inputEpoch: 4, geometryRevision: 2, bottomIntent: null,
  };
  const port = {
    activationID: session.activationID,
    session,
    beginNavigation: vi.fn((input) => {
      session = { ...session, mode: 'browsing', inputEpoch: session.inputEpoch + 1 };
      port.session = session;
      return { inputGeneration: session.inputEpoch, input };
    }),
    updateNavigation: vi.fn(() => true),
    finishNavigation: vi.fn(() => true),
    cancelNavigation: vi.fn(() => true),
    consumeBottomIntent: vi.fn((intent) => {
      if (session.bottomIntent?.id !== intent?.id
        || session.bottomIntent.inputEpoch !== session.inputEpoch) return false;
      session = { ...session, bottomIntent: null };
      port.session = session;
      return true;
    }),
    setBottomIntent(intent) {
      session = { ...session, mode: 'following', bottomIntent: intent };
      port.session = session;
    },
    takeControl() {
      session = {
        ...session,
        mode: 'browsing',
        inputEpoch: session.inputEpoch + 1,
        bottomIntent: null,
      };
      port.session = session;
    },
    getSession: () => session,
  };
  return port;
}

function Host({
  role,
  readBookmark,
  navigationEvents,
  bottomIntentID = '',
  bottomIntentReady = true,
}) {
  const [node, setNode] = useState(null);
  const adapter = useMemo(() => ({
    prepareNavigationRead: () => navigationEvents?.push('prepare'),
    readBookmark: () => {
      navigationEvents?.push('read');
      return readBookmark?.(node) || { messageID: `${role}-anchor`, rowViewportOffset: -12 };
    },
    presentationRevision: () => 7,
    atTail: () => Number(node?.scrollTop || 0) === 0,
    bottomIntentReady: () => bottomIntentReady,
    isEffectiveMotion: (_previous, next) => role !== 'following' || next <= -3,
  }), [bottomIntentReady, node, readBookmark, role, navigationEvents]);
  const owner = useReadingNavigationHost(role, adapter, node);
  useLayoutEffect(() => {
    if (bottomIntentID) owner?.commitBottomIntent(role, bottomIntentID);
  }, [bottomIntentID, owner, role]);
  return <div ref={setNode} role="region" data-testid={role} tabIndex={0}>
    <span data-testid={`${role}-content`} />
  </div>;
}

function Subject({
  port,
  role,
  onFollowingNavigationTarget = vi.fn(),
  readBookmark,
  navigationEvents,
  bottomIntentID = '',
  bottomIntentReady = true,
}) {
  const stackRef = useRef(null);
  return <ReadingNavigationOwner
    activationID={port.activationID}
    reading={port}
    stackRef={stackRef}
    visibleRole={role}
    onFollowingNavigationTarget={onFollowingNavigationTarget}
  ><div ref={stackRef}><Host
    role={role}
    readBookmark={readBookmark}
    navigationEvents={navigationEvents}
    bottomIntentID={bottomIntentID}
    bottomIntentReady={bottomIntentReady}
  /></div></ReadingNavigationOwner>;
}

function touch(type, { identifier = 7, y = 0, active = true } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: active ? [{ identifier, clientY: y }] : [],
  });
  Object.defineProperty(event, 'changedTouches', {
    value: active ? [] : [{ identifier, clientY: y }],
  });
  return event;
}

function touchContacts(type, { touches = [], changedTouches = [] } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
  });
  return event;
}

it('routes an ordinary browsing touch sequence through one stable input generation', () => {
  vi.useFakeTimers();
  const trace = vi.fn();
  globalThis.__ATOLL_READING_TRACE__ = trace;
  const port = reading('browsing');
  const view = render(<Subject port={port} role="browsing" />);
  const host = view.getByTestId('browsing');

  act(() => host.dispatchEvent(touch('touchstart', { y: 120 })));
  expect(trace).not.toHaveBeenCalledWith(expect.objectContaining({ stage: 'input-owner' }));
  act(() => host.dispatchEvent(touch('touchmove', { y: 160 })));
  act(() => host.dispatchEvent(touch('touchmove', { y: 200 })));
  expect(port.beginNavigation).toHaveBeenCalledTimes(1);
  expect(port.getSession().inputEpoch).toBe(5);
  expect(port.updateNavigation).toHaveBeenCalled();
  expect(trace.mock.calls.map(([entry]) => entry).filter((entry) => entry.stage === 'input-owner'))
    .toEqual([expect.objectContaining({
      source: 'touch', type: 'touch', hostRole: 'browsing', reason: 'begin', inputEpoch: 5,
    })]);

  act(() => host.dispatchEvent(touch('touchend', { active: false })));
  act(() => vi.advanceTimersByTime(100));
  expect(port.finishNavigation).toHaveBeenCalledTimes(1);
  expect(port.finishNavigation).toHaveBeenCalledWith(expect.objectContaining({
    inputGeneration: 5,
    reason: 'quiet-deadline',
  }));
});

it('settles presentation on potential contact but defers bookmark capture until actual motion', () => {
  const port = reading('browsing');
  const navigationEvents = [];
  const view = render(<Subject port={port} role="browsing" navigationEvents={navigationEvents} />);
  const host = view.getByTestId('browsing');
  act(() => host.dispatchEvent(touch('touchstart', { y: 120 })));
  expect(navigationEvents).toEqual(['prepare']);
  expect(port.beginNavigation).not.toHaveBeenCalled();
  act(() => host.dispatchEvent(touch('touchmove', { y: 160 })));
  expect(navigationEvents).toEqual(['prepare', 'prepare', 'read']);
  expect(port.beginNavigation).toHaveBeenCalledTimes(1);
});

it('keeps following input potential until native displacement supplies its bookmark', () => {
  vi.useFakeTimers();
  const trace = vi.fn();
  globalThis.__ATOLL_READING_TRACE__ = trace;
  const port = reading('following');
  const target = vi.fn();
  const view = render(<Subject port={port} role="following" onFollowingNavigationTarget={target} />);
  const host = view.getByTestId('following');
  Object.defineProperty(host, 'scrollTop', { configurable: true, writable: true, value: 0 });

  act(() => host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -80 })));
  expect(port.beginNavigation).not.toHaveBeenCalled();
  expect(trace).not.toHaveBeenCalledWith(expect.objectContaining({ stage: 'input-owner' }));
  host.scrollTop = -24;
  act(() => host.dispatchEvent(new Event('scroll')));

  expect(target).toHaveBeenCalledTimes(1);
  expect(target).toHaveBeenCalledWith(expect.objectContaining({
    activationID: 'activation:a',
    originInputEpoch: 4,
    inputGeneration: 5,
    presentationRevision: 7,
    phase: 'active',
    bookmark: { messageID: 'following-anchor', rowViewportOffset: -12 },
  }));
  expect(port.beginNavigation).toHaveBeenCalledTimes(1);
  expect(port.getSession()).toMatchObject({ mode: 'browsing', inputEpoch: 5 });
  expect(trace.mock.calls.map(([entry]) => entry).filter((entry) => entry.stage === 'input-owner'))
    .toEqual([expect.objectContaining({
      source: 'wheel', type: 'wheel', hostRole: 'following', reason: 'begin',
      inputEpoch: 5, scrollTop: -24,
    })]);
  const firstTarget = target.mock.calls.at(-1)[0];

  host.scrollTop = -48;
  act(() => host.dispatchEvent(new Event('scroll')));
  expect(port.beginNavigation).toHaveBeenCalledTimes(1);
  expect(port.updateNavigation).toHaveBeenCalled();
  expect(trace.mock.calls.map(([entry]) => entry).filter((entry) => entry.stage === 'input-owner'))
    .toHaveLength(1);
  expect(target.mock.calls.at(-1)[0]).toMatchObject({
    transactionID: firstTarget.transactionID,
    targetRevision: firstTarget.targetRevision,
    phase: 'active',
  });
  // A quiet deadline only ends attribution. The coordinator has no paint or
  // handoff-ready callback and therefore cannot reveal an unproved renderer.
  act(() => vi.advanceTimersByTime(120));
  expect(port.finishNavigation).toHaveBeenCalledWith(expect.objectContaining({ inputGeneration: 5 }));
  expect(target.mock.calls.at(-1)[0]).toMatchObject({
    transactionID: firstTarget.transactionID,
    targetRevision: firstTarget.targetRevision,
    phase: 'settled',
  });
});

it('publishes the activating scroll and every later effective scroll in one following transaction', () => {
  vi.useFakeTimers();
  const port = reading('following');
  const target = vi.fn();
  const readBookmark = (node) => ({
    messageID: 'following-anchor',
    rowViewportOffset: Number(node?.scrollTop || 0),
  });
  const view = render(<Subject
    port={port}
    role="following"
    readBookmark={readBookmark}
    onFollowingNavigationTarget={target}
  />);
  const host = view.getByTestId('following');
  Object.defineProperty(host, 'scrollTop', { configurable: true, writable: true, value: 0 });

  act(() => host.dispatchEvent(touch('touchstart', { y: 120 })));
  act(() => host.dispatchEvent(touch('touchmove', { y: 160 })));
  expect(target).not.toHaveBeenCalled();

  for (const scrollTop of [-24, -48, -72]) {
    host.scrollTop = scrollTop;
    act(() => host.dispatchEvent(new Event('scroll')));
  }

  const positionTargets = target.mock.calls.map(([entry]) => entry);
  expect(positionTargets.map((entry) => entry.reason)).toEqual(['begin', 'scroll', 'scroll']);
  expect(positionTargets.map((entry) => entry.bookmark.rowViewportOffset)).toEqual([-24, -48, -72]);
  expect(new Set(positionTargets.map((entry) => entry.transactionID)).size).toBe(1);
  expect(new Set(positionTargets.map((entry) => entry.inputGeneration)).size).toBe(1);
  expect(positionTargets.map((entry) => entry.targetRevision)).toEqual([1, 2, 3]);
});

it('ends touch ownership only when the tracked contact ends', () => {
  vi.useFakeTimers();
  const port = reading('browsing');
  const view = render(<Subject port={port} role="browsing" />);
  const host = view.getByTestId('browsing');
  const tracked = { identifier: 7, clientY: 120 };
  const other = { identifier: 8, clientY: 90 };
  act(() => host.dispatchEvent(touchContacts('touchstart', { touches: [tracked] })));
  act(() => host.dispatchEvent(touchContacts('touchmove', {
    touches: [{ ...tracked, clientY: 160 }, other],
  })));
  expect(port.beginNavigation).toHaveBeenCalledTimes(1);

  act(() => host.dispatchEvent(touchContacts('touchend', {
    touches: [{ ...tracked, clientY: 160 }], changedTouches: [other],
  })));
  act(() => vi.advanceTimersByTime(200));
  expect(port.finishNavigation).not.toHaveBeenCalled();

  act(() => host.dispatchEvent(touchContacts('touchend', {
    changedTouches: [{ ...tracked, clientY: 160 }],
  })));
  act(() => vi.advanceTimersByTime(100));
  expect(port.finishNavigation).toHaveBeenCalledTimes(1);
});

it('cancels the captured transaction when another control advances the committed epoch', () => {
  const port = reading('browsing');
  const view = render(<Subject port={port} role="browsing" />);
  const host = view.getByTestId('browsing');
  act(() => host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -80 })));
  expect(port.beginNavigation).toHaveBeenCalledTimes(1);

  const nextSession = { ...port.getSession(), inputEpoch: 9 };
  const successor = {
    ...port,
    session: nextSession,
    getSession: () => nextSession,
  };
  view.rerender(<Subject port={successor} role="browsing" />);

  expect(port.cancelNavigation).toHaveBeenCalledWith(expect.objectContaining({
    inputGeneration: 5,
    reason: 'external-control',
  }));
});

it('cancels physical ownership and commits one reverse-tail write before consuming an explicit send intent', () => {
  const port = reading('following');
  const view = render(<Subject port={port} role="following" />);
  const host = view.getByTestId('following');
  Object.defineProperties(host, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollHeight: { configurable: true, value: 1800 },
    clientHeight: { configurable: true, value: 600 },
  });
  const scrollTo = vi.fn(({ top }) => { host.scrollTop = top; });
  Object.defineProperty(host, 'scrollTo', { configurable: true, value: scrollTo });

  // Real native displacement first owns this epoch and leaves the reverse
  // following host away from its physical tail while browsing handoff is open.
  act(() => host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -900 })));
  host.scrollTop = -900;
  act(() => host.dispatchEvent(new Event('scroll')));
  expect(port.getSession()).toMatchObject({ mode: 'browsing', inputEpoch: 5 });

  const intent = {
    id: 'composer:send-start:1', inputEpoch: 5, targetMessageIDs: ['queued-1'],
  };
  port.setBottomIntent(intent);
  view.rerender(<Subject
    port={port}
    role="following"
    bottomIntentID={intent.id}
  />);

  expect(port.cancelNavigation).toHaveBeenCalledWith(expect.objectContaining({
    inputGeneration: 5,
    reason: 'application-control',
  }));
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  expect(host.scrollTop).toBe(0);
  expect(port.consumeBottomIntent).toHaveBeenCalledTimes(1);
  expect(port.consumeBottomIntent).toHaveBeenCalledWith({ id: intent.id, inputEpoch: 5 });
});

it('does not execute a pending application intent after newer user input revokes its epoch', () => {
  const port = reading('browsing');
  const intent = {
    id: 'composer:send-start:pending', inputEpoch: 4, targetMessageIDs: ['queued-pending'],
  };
  port.setBottomIntent(intent);
  const view = render(<Subject
    port={port}
    role="following"
    bottomIntentID={intent.id}
    bottomIntentReady={false}
  />);
  const host = view.getByTestId('following');
  Object.defineProperty(host, 'scrollTop', { configurable: true, writable: true, value: -400 });
  const scrollTo = vi.fn(({ top }) => { host.scrollTop = top; });
  Object.defineProperty(host, 'scrollTo', { configurable: true, value: scrollTo });

  port.takeControl();
  view.rerender(<Subject
    port={port}
    role="following"
    bottomIntentID={intent.id}
    bottomIntentReady
  />);

  expect(scrollTo).not.toHaveBeenCalled();
  expect(port.consumeBottomIntent).not.toHaveBeenCalled();
  expect(port.getSession()).toMatchObject({ mode: 'browsing', inputEpoch: 5, bottomIntent: null });
});

it('keeps selection autoscroll in browsing evidence even when geometry moves newer', () => {
  vi.useFakeTimers();
  const port = reading('browsing');
  const view = render(<Subject port={port} role="browsing" />);
  const host = view.getByTestId('browsing');
  const content = view.getByTestId('browsing-content');
  Object.defineProperty(host, 'scrollTop', { configurable: true, writable: true, value: 100 });
  const pointer = (type, y) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, {
      pointerType: { value: 'mouse' }, pointerId: { value: 4 }, button: { value: 0 },
      clientX: { value: 10 }, clientY: { value: y },
    });
    return event;
  };
  act(() => content.dispatchEvent(pointer('pointerdown', 10)));
  act(() => content.dispatchEvent(pointer('pointermove', 30)));
  host.scrollTop = 140;
  act(() => host.dispatchEvent(new Event('scroll')));
  host.scrollTop = 80;
  act(() => host.dispatchEvent(new Event('scroll')));

  expect(port.beginNavigation).toHaveBeenCalledWith(expect.objectContaining({ direction: 'browse' }));
  expect(port.updateNavigation).toHaveBeenCalledTimes(2);
  expect(port.updateNavigation.mock.calls).toEqual([
    [expect.objectContaining({ direction: 'browse' })],
    [expect.objectContaining({ direction: 'browse' })],
  ]);
  act(() => globalThis.dispatchEvent(pointer('pointerup', 30)));
  act(() => vi.advanceTimersByTime(100));
  expect(port.finishNavigation).toHaveBeenCalledTimes(1);
});
