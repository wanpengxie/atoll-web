// @vitest-environment jsdom
// NR07-02/03 and NR08 public composition coverage. Width state, bounds, and
// persistence remain owned by WorkspaceLayout; the feature tree only receives
// a presentation-only layout port.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';

const CONTEXT_KEY = 'atoll.web.pane.context';
const ARTIFACT_KEY = 'atoll.web.pane.artifact';
const RAIL_KEY = 'atoll.web.pane.rail';

afterEach(() => {
  cleanup();
  [CONTEXT_KEY, ARTIFACT_KEY, RAIL_KEY].forEach((key) => localStorage.removeItem(key));
});

beforeEach(() => {
  [CONTEXT_KEY, ARTIFACT_KEY, RAIL_KEY].forEach((key) => localStorage.removeItem(key));
  window.innerWidth = 1280;
});

function session() {
  return {
    wireState: 'open',
    me: { id: 'human:root:1', display_name: '我' },
    onLogout: vi.fn(),
  };
}

function navigation() {
  return {
    channels: [{ id: 'c0', name: 'c0', access: 'member_active' }],
    channel: { id: 'c0', name: 'c0', access: 'member_active' },
    unread: {},
    agentActivity: { byChannel: {} },
    activeChannelId: 'c0',
    activeView: 'conversation',
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
  };
}

function contextPanel(onClose = vi.fn()) {
  return <WorkspaceRightPanel
    panel="roster"
    channel={{ id: 'c0' }}
    roster={{ rows: [], busy: false, commands: {} }}
    onClose={onClose}
  />;
}

function artifactPanel(onClose = vi.fn()) {
  return <WorkspaceRightPanel
    panel="artifact"
    channel={{ id: 'c0' }}
    files={{
      selectedArtifact: {
        key: 'artifact:c0:r1',
        channelId: 'c0',
        name: 'notes.md',
        mediaType: 'text/markdown',
        resourceId: 'r1',
      },
      preview: { status: 'ready', text: '正文' },
      commands: {},
    }}
    onClose={onClose}
  />;
}

function renderLayout(rightPanel) {
  const view = render(<WorkspaceLayout session={session()} navigation={navigation()} rightPanel={rightPanel} />);
  return {
    ...view,
    host: () => view.container.querySelector('.context-host'),
    handle: (name = '调整右侧面板宽度') => screen.getByRole('separator', { name }),
  };
}

describe('NR07-02/03 context pane public owner', () => {
  it('grows left, reports preview frames, clamps to the workspace reserve, and commits only on pointer-up', () => {
    window.innerWidth = 1000;
    const view = renderLayout(contextPanel());
    const handle = view.handle();

    expect(view.host().style.getPropertyValue('--context-width')).toBe('');
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 11, clientX: 640 });
    fireEvent.pointerMove(handle, { pointerId: 11, clientX: 540 });
    expect(view.host().style.getPropertyValue('--context-width')).toBe('460px');
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 11, clientX: -5000 });
    expect(view.host().style.getPropertyValue('--context-width')).toBe('580px');
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 11, clientX: -5000 });
    expect(localStorage.getItem(CONTEXT_KEY)).toBe('580');
  });

  it('uses 16px keyboard steps and Home/double-click reset without leaving a second owner', () => {
    localStorage.setItem(CONTEXT_KEY, '360');
    const view = renderLayout(contextPanel());
    const handle = view.handle();

    expect(handle.getAttribute('aria-valuemin')).toBe('300');
    expect(view.host().style.getPropertyValue('--context-width')).toBe('360px');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(view.host().style.getPropertyValue('--context-width')).toBe('376px');
    expect(localStorage.getItem(CONTEXT_KEY)).toBe('376');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(view.host().style.getPropertyValue('--context-width')).toBe('360px');
    expect(localStorage.getItem(CONTEXT_KEY)).toBe('360');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(view.host().style.getPropertyValue('--context-width')).toBe('');
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.doubleClick(handle);
    expect(view.host().style.getPropertyValue('--context-width')).toBe('');
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
    expect(localStorage.getItem(ARTIFACT_KEY)).toBeNull();
  });
});

describe('NR08 artifact pane public owner', () => {
  it('keeps artifact width independent, grows left, and enforces its own minimum', () => {
    const view = renderLayout(artifactPanel());
    const handle = view.handle();

    expect(view.host().getAttribute('data-context-type')).toBe('artifact');
    expect(handle.getAttribute('aria-valuemin')).toBe('420');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 21, clientX: 760 });
    fireEvent.pointerMove(handle, { pointerId: 21, clientX: 680 });
    expect(view.host().style.getPropertyValue('--context-width')).toBe('600px');
    fireEvent.pointerMove(handle, { pointerId: 21, clientX: 5000 });
    expect(view.host().style.getPropertyValue('--context-width')).toBe('420px');
    fireEvent.pointerUp(handle, { pointerId: 21, clientX: 5000 });

    expect(localStorage.getItem(ARTIFACT_KEY)).toBe('420');
    expect(localStorage.getItem(CONTEXT_KEY)).toBeNull();
  });
});
