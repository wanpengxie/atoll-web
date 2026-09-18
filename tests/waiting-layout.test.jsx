// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationSurface } from '../src/ui/conversation/ConversationSurface.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fixed conversation surface ownership', () => {
  it('does not install a size/mutation/frame observer or publish a scroll intent', () => {
    const ResizeObserver = vi.fn();
    const MutationObserver = vi.fn();
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('ResizeObserver', ResizeObserver);
    vi.stubGlobal('MutationObserver', MutationObserver);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

    function Input() {
      return <section className="composer-wrap">composer</section>;
    }
    const view = render(<ConversationSurface
      input={<Input />}
      floating={<section className="agent-wait-layer">waiting</section>}
    ><div className="timeline-message-list">reading</div></ConversationSurface>);

    expect(ResizeObserver).not.toHaveBeenCalled();
    expect(MutationObserver).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-input-resize-transition]')).toBeNull();
    expect(view.container.querySelector('[data-send-clear-revision]')).toBeNull();
    expect(view.container.querySelector('[data-send-clear-transition]')).toBeNull();
  });

  it('keeps reading and focused Composer DOM identities across input and Waiting changes', () => {
    function Subject({ lines, waiting }) {
      return <ConversationSurface
        input={<section className="composer-wrap">
          <button type="button" data-testid="composer-control">send</button>
          {Array.from({ length: lines }, (_, index) => <p key={index}>{index}</p>)}
        </section>}
        floating={waiting ? <section className="agent-wait-layer">waiting</section> : null}
      ><div data-testid="reading">reading</div></ConversationSurface>;
    }

    const view = render(<Subject lines={1} waiting={false} />);
    const surface = view.container.querySelector('.conversation-surface');
    const readingSlot = view.container.querySelector('.conversation-reading-slot');
    const inputSlot = view.container.querySelector('.conversation-input-slot');
    const control = view.getByTestId('composer-control');
    control.focus();

    view.rerender(<Subject lines={12} waiting />);
    expect(view.container.querySelector('.conversation-surface')).toBe(surface);
    expect(view.container.querySelector('.conversation-reading-slot')).toBe(readingSlot);
    expect(view.container.querySelector('.conversation-input-slot')).toBe(inputSlot);
    expect(view.getByTestId('composer-control')).toBe(control);
    expect(document.activeElement).toBe(control);
    expect(view.container.querySelector('.conversation-floating-slot .agent-wait-layer')).not.toBeNull();

    view.rerender(<Subject lines={2} waiting={false} />);
    expect(view.container.querySelector('.conversation-reading-slot')).toBe(readingSlot);
    expect(document.activeElement).toBe(control);
  });

  it('keeps the floating stack separate from the reading subtree and preserves caller classes', () => {
    const view = render(<ConversationSurface
      className="is-test-surface"
      input={<div data-testid="composer">composer</div>}
      floating={<div data-testid="waiting">waiting</div>}
    ><div data-testid="reading">reading</div></ConversationSurface>);
    const surface = view.container.querySelector('.conversation-surface');
    const readingSlot = view.container.querySelector('.conversation-reading-slot');
    const bottomStack = view.container.querySelector('.conversation-bottom-stack');

    expect(surface.classList.contains('is-test-surface')).toBe(true);
    expect(readingSlot.contains(view.getByTestId('reading'))).toBe(true);
    expect(readingSlot.contains(view.getByTestId('composer'))).toBe(false);
    expect(readingSlot.contains(view.getByTestId('waiting'))).toBe(false);
    expect(bottomStack.contains(view.getByTestId('composer'))).toBe(true);
    expect(bottomStack.contains(view.getByTestId('waiting'))).toBe(true);
  });
});
