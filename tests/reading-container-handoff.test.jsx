// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingContainerHandoff } from '../src/ui/timeline/ReadingContainerHandoff.jsx';

afterEach(cleanup);

function reading(mode, change = {}) {
  const session = { mode, inputEpoch: 1, activationID: 'activation-1' };
  return {
    activationID: session.activationID,
    session,
    getSession: () => session,
    onSurfaceVisibilityChange: vi.fn(),
    ...change,
  };
}

it('keeps one list executor while the reading owner changes mode', () => {
  const following = reading('following');
  const view = render(<ReadingContainerHandoff
    reading={following}
    surfaceVisible
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);

  const stack = view.container.querySelector('.timeline-reading-stack');
  const list = view.getByRole('region', { name: '频道动态' });
  expect(stack.dataset.readingMode).toBe('following');
  expect(stack.dataset.readingActivation).toBe('activation-1');
  expect(stack.querySelectorAll('.timeline-reading-layer')).toHaveLength(1);

  const browsing = reading('browsing');
  view.rerender(<ReadingContainerHandoff
    reading={browsing}
    surfaceVisible
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);

  expect(stack.dataset.readingMode).toBe('browsing');
  expect(stack.querySelectorAll('.timeline-reading-layer')).toHaveLength(1);
  expect(view.getByRole('region', { name: '频道动态' })).toBe(list);
});

it('publishes visibility through the reading owner and keeps restore state in the sole executor', () => {
  const owner = reading('browsing', { restorePending: true });
  const view = render(<ReadingContainerHandoff
    reading={owner}
    surfaceVisible
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);

  expect(owner.onSurfaceVisibilityChange).toHaveBeenLastCalledWith(true);
  expect(view.getByRole('status').textContent).toContain('正在恢复上次阅读位置');
  expect(view.container.querySelectorAll('.timeline-message-list')).toHaveLength(1);

  view.rerender(<ReadingContainerHandoff
    reading={owner}
    surfaceVisible={false}
    snapshot={{ rows: [] }}
    renderRow={() => null}
  />);
  expect(owner.onSurfaceVisibilityChange).toHaveBeenLastCalledWith(false);
});
