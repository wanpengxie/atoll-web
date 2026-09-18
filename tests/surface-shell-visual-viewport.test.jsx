// @vitest-environment jsdom
import React, { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SurfaceShell } from '../src/app/SurfaceShell.jsx';

class MutableVisualViewport extends EventTarget {
  width = 390;
  height = 844;
  offsetTop = 0;
  offsetLeft = 0;
  scale = 1;

  commit(patch, type = 'resize') {
    Object.assign(this, patch);
    this.dispatchEvent(new Event(type));
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('publishes one synchronous visual viewport frame without remounting focused content', () => {
  const viewport = new MutableVisualViewport();
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  const hostRef = createRef();
  const view = render(<SurfaceShell ref={hostRef} topology="mobile" className="shell">
    <input aria-label="draft" defaultValue="stable selection" />
  </SurfaceShell>);
  const host = hostRef.current;
  const input = view.getByLabelText('draft');
  input.focus();
  input.setSelectionRange(2, 8);

  expect(host.hasAttribute('data-visual-viewport-owned')).toBe(false);
  viewport.commit({ height: 500, offsetTop: 18 });
  expect(host.style.getPropertyValue('--visual-viewport-height')).toBe('500px');
  expect(host.style.getPropertyValue('--visual-viewport-offset-top')).toBe('18px');
  expect(view.getByLabelText('draft')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8]);

  viewport.commit({ offsetTop: 22 }, 'scroll');
  expect(host.style.getPropertyValue('--visual-viewport-offset-top')).toBe('22px');

  // Pinch zoom stays browser-owned; the app must not counter-scale it.
  viewport.commit({ scale: 2 });
  expect(host.hasAttribute('data-visual-viewport-owned')).toBe(false);
  expect(host.style.getPropertyValue('--visual-viewport-height')).toBe('');

  viewport.commit({ scale: 1, height: 500 });
  expect(host.dataset.visualViewportOwned).toBe('true');
  view.rerender(<SurfaceShell ref={hostRef} topology="compact" className="shell">
    <input aria-label="draft" defaultValue="stable selection" />
  </SurfaceShell>);
  expect(host.dataset.visualViewportOwned).toBe('true');
  expect(view.getByLabelText('draft')).toBe(input);
  viewport.commit({ width: 700, height: 480 });
  expect(host.style.getPropertyValue('--visual-viewport-width')).toBe('700px');
  expect(host.style.getPropertyValue('--visual-viewport-height')).toBe('480px');
  view.rerender(<SurfaceShell ref={hostRef} topology="desktop" className="shell">
    <input aria-label="draft" defaultValue="stable selection" />
  </SurfaceShell>);
  expect(host.dataset.visualViewportOwned).toBe('true');
  viewport.commit({ width: 390, height: 844, offsetTop: 0, offsetLeft: 0 });
  expect(host.hasAttribute('data-visual-viewport-owned')).toBe(false);
});
