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
  it('retargets user-authored input growth from the current painted height', () => {
    let naturalHeight = 100;
    let renderedHeight = 100;
    let nextFrame = 1;
    const frames = new Map();
    const observers = [];
    const mutationObservers = [];
    class TestResizeObserver {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('MutationObserver', class TestMutationObserver {
      constructor(callback) { this.callback = callback; mutationObservers.push(this); }
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds() {
      const height = this.classList.contains('conversation-surface')
        ? 640
        : this.classList.contains('composer-wrap')
          ? naturalHeight
          : this.classList.contains('conversation-input-slot')
            ? renderedHeight
            : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: height, width: 800, height, toJSON: () => ({}) };
    });
    function Subject() {
      return <ConversationSurface input={<section className="composer-wrap" data-send-clear-revision="0"><div className="composer-editor">message</div></section>}>
        <div className="timeline" data-viewport-mode="following"><div className="timeline-message-list">reading</div></div>
      </ConversationSurface>;
    }

    const view = render(<Subject />);
    const inputSlot = view.container.querySelector('.conversation-input-slot');
    const scroller = view.container.querySelector('.timeline-message-list');
    let preparedCount = 0;
    scroller.addEventListener('atoll:input-resize-prepared', () => {
      preparedCount += 1;
      scroller.dispatchEvent(new CustomEvent('atoll:timeline-bottom-write', { bubbles: true }));
    });
    naturalHeight = 121;
    renderedHeight = 121;
    act(() => mutationObservers[0].callback([{ type: 'characterData' }]));
    expect(preparedCount).toBe(1);
    expect(inputSlot.dataset.inputResizeTransition).toBe('armed');
    expect(inputSlot.style.getPropertyValue('--input-resize-from-height')).toBe('100px');
    expect(inputSlot.style.getPropertyValue('--input-resize-to-height')).toBe('121px');
    act(() => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback();
      }
    });
    expect(inputSlot.dataset.inputResizeTransition).toBe('running');
    act(() => mutationObservers[0].callback([{ type: 'characterData' }]));
    expect(preparedCount).toBe(1);

    naturalHeight = 142;
    renderedHeight = 111;
    act(() => mutationObservers[0].callback([{ type: 'childList' }]));
    expect(preparedCount).toBe(2);
    expect(inputSlot.dataset.inputResizeTransition).toBe('armed');
    expect(inputSlot.style.getPropertyValue('--input-resize-from-height')).toBe('111px');
    expect(inputSlot.style.getPropertyValue('--input-resize-to-height')).toBe('142px');

    naturalHeight = 142;
    renderedHeight = 142;
    const end = new Event('transitionend', { bubbles: true });
    Object.defineProperty(end, 'propertyName', { value: '--input-resize-progress-height' });
    act(() => view.container.querySelector('.conversation-surface').dispatchEvent(end));
    expect(inputSlot.hasAttribute('data-input-resize-transition')).toBe(false);
    expect(inputSlot.style.getPropertyValue('--input-resize-from-height')).toBe('');
    expect(inputSlot.style.getPropertyValue('--input-resize-to-height')).toBe('');

    inputSlot.style.maxHeight = '150px';
    naturalHeight = 180;
    renderedHeight = 142;
    act(() => mutationObservers[0].callback([{ type: 'characterData' }]));
    expect(preparedCount).toBe(3);
    expect(inputSlot.style.getPropertyValue('--input-resize-from-height')).toBe('142px');
    expect(inputSlot.style.getPropertyValue('--input-resize-to-height')).toBe('150px');
  });

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
