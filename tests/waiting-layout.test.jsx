// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationSurface } from '../src/ui/conversation/ConversationSurface.jsx';
import { useComposerPresentation } from '../src/ui/conversation/ComposerPresentationContext.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('waiting layout ownership', () => {
  it('releases a synchronous clear preparation when the committed input did not shrink', () => {
    const observers = [];
    class TestResizeObserver {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds() {
      const height = this.classList.contains('conversation-surface') ? 640 : 100;
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height, toJSON: () => ({}) };
    });
    let prepare;
    function Input({ revision }) {
      prepare = useComposerPresentation()?.prepareSendClear;
      return <section className="composer-wrap" data-send-clear-revision={revision}>same height</section>;
    }
    function Subject({ revision }) {
      return <ConversationSurface input={<Input revision={revision} />}><div>reading</div></ConversationSurface>;
    }

    const view = render(<Subject revision={0} />);
    const inputSlot = view.container.querySelector('.conversation-input-slot');
    act(() => { expect(prepare(1)).toBe(true); });
    expect(inputSlot.dataset.sendClearTransition).toBe('prepared');
    view.rerender(<Subject revision={1} />);
    act(() => observers[0].callback());
    expect(inputSlot.hasAttribute('data-send-clear-transition')).toBe(false);
    expect(inputSlot.style.getPropertyValue('--send-clear-from-height')).toBe('');
  });

  it('releases an active clear transition when CSS cancels it', () => {
    let naturalHeight = 180;
    const observers = [];
    class TestResizeObserver {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds() {
      const height = this.classList.contains('conversation-surface') ? 640 : naturalHeight;
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height, toJSON: () => ({}) };
    });
    let prepare;
    function Input({ revision }) {
      prepare = useComposerPresentation()?.prepareSendClear;
      return <section className="composer-wrap" data-send-clear-revision={revision}>message</section>;
    }
    function Subject({ revision }) {
      return <ConversationSurface input={<Input revision={revision} />}><div>reading</div></ConversationSurface>;
    }

    const view = render(<Subject revision={0} />);
    const inputSlot = view.container.querySelector('.conversation-input-slot');
    act(() => { expect(prepare(1)).toBe(true); });
    naturalHeight = 100;
    view.rerender(<Subject revision={1} />);
    act(() => observers[0].callback());
    expect(inputSlot.dataset.sendClearTransition).toBe('armed');

    const cancel = new Event('transitioncancel', { bubbles: true });
    Object.defineProperty(cancel, 'propertyName', { value: 'block-size' });
    act(() => inputSlot.dispatchEvent(cancel));
    expect(inputSlot.hasAttribute('data-send-clear-transition')).toBe(false);
    expect(inputSlot.style.getPropertyValue('--send-clear-from-height')).toBe('');
    expect(inputSlot.style.getPropertyValue('--send-clear-to-height')).toBe('');
  });

  it('observes only the in-flow input while Waiting facts use the fixed list reserve', () => {
    let naturalInputHeight = 104;
    const observers = [];
    class TestResizeObserver {
      constructor(callback) {
        this.callback = callback;
        this.targets = [];
        observers.push(this);
      }
      observe(target) { this.targets.push(target); }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds() {
      const height = this.classList.contains('conversation-surface')
        ? 640
        : this.classList.contains('conversation-input-slot')
          ? Math.min(naturalInputHeight, 416)
          : this.classList.contains('conversation-floating-slot')
            ? (this.querySelector('.agent-wait-layer') ? 300 : 0)
          : this.classList.contains('agent-wait-layer')
            ? 300
            : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height, toJSON: () => ({}) };
    });
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function height() {
      return this.classList.contains('conversation-input-slot')
        ? naturalInputHeight
        : scrollHeight?.get?.call(this) || 0;
    });

    function floating(fact) {
      if (!['queued', 'partial', 'roster'].includes(fact)) return null;
      return <section className="agent-wait-layer" aria-label="等待区">
        {fact === 'partial' && <p role="status">等待证据尚未完整</p>}
        {fact === 'roster' && <header>新的成员名字</header>}
        <p>等待消息</p>
      </section>;
    }
    function Subject({ fact }) {
      return <ConversationSurface
        input={<div data-testid="composer">composer</div>}
        floating={floating(fact)}
      ><div data-testid="reading">reading</div></ConversationSurface>;
    }

    const view = render(<Subject fact="terminal" />);
    const surface = view.container.querySelector('.conversation-surface');
    const inputSlot = view.container.querySelector('.conversation-input-slot');
    expect(surface.style.getPropertyValue('--conversation-input-max-height')).toBe('416px');
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([
      surface,
      inputSlot,
    ]);
    expect(observers[0].targets).not.toContain(view.container.querySelector('.conversation-bottom-stack'));

    for (const fact of ['queued', 'partial', 'roster', 'running', 'terminal']) {
      view.rerender(<Subject fact={fact} />);
      act(() => observers[0].callback());
      expect(surface.style.getPropertyValue('--conversation-input-max-height')).toBe('416px');
      expect(surface.classList.contains('is-input-constrained')).toBe(false);
      expect(surface.style.getPropertyValue('--conversation-floating-obstruction')).toBe('');
      expect(surface.hasAttribute('data-floating-obstruction-transition')).toBe(false);
    }

    naturalInputHeight = 470;
    act(() => observers[0].callback());
    expect(surface.classList.contains('is-input-constrained')).toBe(true);
    naturalInputHeight = 104;
    act(() => observers[0].callback());
    expect(surface.classList.contains('is-input-constrained')).toBe(false);
  });
});
