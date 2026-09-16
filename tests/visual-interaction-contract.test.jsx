// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversationViewport } from '../src/ui/timeline/useConversationViewport.js';

const repoRoot = process.cwd();
const source = (relative) => readFileSync(resolve(repoRoot, relative), 'utf8');

afterEach(cleanup);

describe('visual interaction architecture', () => {
  it('keeps DOM geometry and physical timeline scrolling out of the viewport state machine', () => {
    const viewport = source('src/ui/timeline/useConversationViewport.js');
    expect(viewport).not.toMatch(/scrollTop|getBoundingClientRect|querySelector|requestAnimationFrame|react-virtuoso/);
    expect(viewport).not.toContain('ViewportLayoutContext');
  });

  it('keeps the virtual-list adapter as the only timeline scroll executor', () => {
    const adapter = source('src/ui/timeline/VirtualTimelineAdapter.jsx');
    const timeline = source('src/ui/Timeline.jsx');
    const fold = source('src/ui/timeline/FoldableBody.jsx');
    expect(adapter).not.toContain("from 'react-virtuoso'");
    expect(adapter).not.toMatch(/scrollToIndex|requestAnimationFrame|setTimeout/);
    expect(adapter.match(/scrollTop\s*=/g)).toHaveLength(1);
    expect(adapter).toContain('getSnapshotBeforeUpdate');
    expect(adapter).toContain('memo(function PresentationRow');
    expect(timeline).not.toMatch(/scrollIntoView|scrollTop\s*[+\-]?=|scrollToIndex/);
    expect(fold).not.toMatch(/scrollIntoView|scrollTop|getBoundingClientRect|requestAnimationFrame/);
  });

  it('keeps message-row geometry free from independent height animation', () => {
    const timeline = source('src/styles/timeline.css');
    const timelineComponent = source('src/ui/Timeline.jsx');
    expect(timeline).not.toMatch(/\.timeline-virtual-item[^}]*transition:\s*(?:all|height|padding|margin|transform)/s);
    expect(timelineComponent).not.toContain('timeline-bottom-dock');
  });

  it('keeps Composer and waiting state as overlays that cannot resize Conversation', () => {
    const composer = source('src/ui/Composer.jsx');
    const timelineComponent = source('src/ui/Timeline.jsx');
    const adapter = source('src/ui/timeline/VirtualTimelineAdapter.jsx');
    const shell = source('src/styles/app-shell.css');
    const timeline = source('src/styles/timeline.css');
    const composerStyles = source('src/styles/composer.css');

    expect(composer).not.toMatch(/ResizeObserver|composer-overlay-height|is-composer-layout-transitioning/);
    expect(timelineComponent).not.toMatch(/ResizeObserver|agent-wait-dock-height/);
    expect(timelineComponent).toMatch(/conversation-bottom-overlay[\s\S]*<WaitingLayer[\s\S]*\{composer\}/);
    expect(timeline).not.toMatch(/composer-overlay-height|agent-wait-dock-height|is-composer-layout-transitioning/);
    expect(timeline).toMatch(/\.agent-wait-dock\s*\{[^}]*position:\s*relative/s);
    expect(timeline).toMatch(/\.timeline\s*\{[^}]*margin-bottom:\s*0/s);
    expect(shell).toMatch(/\.dynamic-message-pane\s*\{[^}]*--conversation-composer-height:\s*112px/s);
    expect(shell).toMatch(/\.dynamic-message-pane\s*\{[^}]*--conversation-reading-gap:\s*32px/s);
    expect(shell).toMatch(/\.dynamic-message-pane\s*\{[^}]*--conversation-composer-lane:\s*calc\(var\(--conversation-composer-height\)\s*\+\s*var\(--conversation-reading-gap\)\)/s);
    expect(shell).toMatch(/\.dynamic-message-pane\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s*var\(--conversation-composer-lane\)/s);
    expect(shell).toMatch(/\.conversation-bottom-overlay\s*\{[^}]*position:\s*absolute[^}]*flex-direction:\s*column/s);
    expect(adapter).not.toMatch(/TimelineFooter|timeline-overlay-clearance/);
    expect(timeline).not.toContain('timeline-overlay-clearance');
    expect(composerStyles).toMatch(/\.composer-wrap\s*\{[^}]*position:\s*relative/s);
    expect(composerStyles).toMatch(/\.composer-state-rail\s*\{[^}]*height:\s*18px/s);
  });

  it('gives asynchronously decoded rich media stable first-paint geometry', () => {
    const markdown = source('src/ui/MarkdownContent.jsx');
    const mermaid = source('src/ui/MermaidBlock.jsx');
    const timeline = source('src/styles/timeline.css');
    expect(markdown).toContain('StableMarkdownImage');
    expect(markdown).toContain('data-viewport-stable-media="image"');
    expect(mermaid).toContain('data-viewport-stable-media="mermaid"');
    expect(timeline).toMatch(/\.markdown-image-frame\s*\{[^}]*aspect-ratio:/s);
    expect(timeline).toMatch(/\.mermaid-stage\s*\{[^}]*block-size:/s);
  });

  it('makes compact and mobile files and terminal exclusive full-width surfaces', () => {
    const responsive = source('src/styles/responsive.css');
    expect(responsive).toContain('.compact-shell .dynamic-workspace.files-split-open > .dynamic-message-pane,');
    expect(responsive).toContain('.mobile-shell .dynamic-workspace.files-split-open > .dynamic-message-pane { visibility: hidden; pointer-events: none; }');
    expect(responsive).toContain('.mobile-shell .dynamic-workspace.files-split-open > .artifacts-view { grid-row: 1; grid-column: 1;');
    expect(responsive).toContain('.mobile-shell .dynamic-workspace.terminal-split-open > .terminal-view { grid-row: 1; grid-column: 1;');
  });

  it('keeps the mobile channel directory as an independent viewport surface', () => {
    const responsive = source('src/styles/responsive.css');
    expect(responsive).toMatch(/\.shell\.mobile-shell\.mobile-channels-open \.channel-rail\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(responsive).toMatch(/\.shell\.mobile-shell\.mobile-channels-open \.workspace,[\s\S]*visibility:\s*hidden/s);
  });
});

describe('semantic navigation', () => {
  const rows = [
    { id: 'row-1', seqLow: 1, seqHigh: 1 },
    { id: 'row-2', seqLow: 2, seqHigh: 2 },
  ];

  function props(navigationTarget = null, items = rows) {
    return {
      channelId: 'c0',
      lastSeq: items.at(-1)?.seqHigh || 0,
      history: { attached: true, hasOlder: false, buffered: 0 },
      viewKey: 'c0:all',
      listKey: 'c0:all',
      geometryKey: '2:stable:',
      items,
      firstVisibleSeq: items[0]?.seqLow || 0,
      latestVisibleSeq: items.at(-1)?.seqHigh || 0,
      viewSpec: {},
      navigationTarget,
      onNavigationTargetConsumed: vi.fn(),
    };
  }

  it('consumes one navigation command once even when the feed later changes', () => {
    const initial = props();
    const { result, rerender } = renderHook((value) => useConversationViewport(value), { initialProps: initial });
    const focus = vi.fn();
    result.current.adapterRef.current = { focus };
    const target = { channelId: 'c0', rowID: 'row-1', token: 7 };
    const withTarget = { ...props(target), onNavigationTargetConsumed: initial.onNavigationTargetConsumed };
    rerender(withTarget);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ rowID: 'row-1' });
    expect(initial.onNavigationTargetConsumed).toHaveBeenCalledWith(7);

    rerender({
      ...withTarget,
      items: [...rows, { id: 'row-3', seqLow: 3, seqHigh: 3 }],
      lastSeq: 3,
      latestVisibleSeq: 3,
    });
    expect(focus).toHaveBeenCalledOnce();
  });

  it('requires downward intent before physical tail geometry can resume following', () => {
    const { result } = renderHook(() => useConversationViewport(props()));
    expect(result.current.isFollowing()).toBe(true);
    act(() => result.current.handleUserIntent('older'));
    expect(result.current.isFollowing()).toBe(false);
    // A collapse/resize may put the bottom into view; geometry alone is not intent.
    act(() => result.current.handleAtBottomChange(true));
    expect(result.current.isFollowing()).toBe(false);
    act(() => result.current.handleUserIntent('newer'));
    expect(result.current.isFollowing()).toBe(true);
  });

  it('never lets a stale physical snapshot override following intent', () => {
    const staleState = { scrollTop: 480, ranges: [{ startIndex: 0, endIndex: 1, size: 84 }] };
    const { result } = renderHook(() => useConversationViewport({
      ...props(),
      initialSession: {
        mode: 'following',
        anchor: null,
        viewportSnapshot: {
          listKey: 'c0:all', geometryKey: '2:stable:', firstItemIndex: 999_998, state: staleState,
        },
      },
    }));

    expect(result.current.measurementSnapshot).toBeNull();
    expect(result.current.isFollowing()).toBe(true);
  });

  it('uses matching measurements only to accelerate semantic browsing restore', () => {
    const state = { version: 1, width: 800, rows: [{ id: 'row-1', size: 84 }] };
    const { result } = renderHook(() => useConversationViewport({
      ...props(),
      initialSession: {
        mode: 'browsing',
        anchor: { rowID: 'row-1', offset: -8, seq: 1 },
        viewportSnapshot: {
          listKey: 'c0:all', geometryKey: '2:stable:', firstItemIndex: 999_998, state,
        },
      },
    }));

    expect(result.current.measurementSnapshot).toEqual(state);
    expect(result.current.isFollowing()).toBe(false);
  });
});
