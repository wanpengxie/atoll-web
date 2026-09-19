// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('conversation architecture boundaries', () => {
  it('has one mature virtual-list geometry executor and no legacy engine', () => {
    const list = source('src/ui/timeline/VendorListExecutor.jsx');
    const domExecutor = source('src/ui/timeline/reading-dom-command-executor.js');
    const browsing = source('src/ui/timeline/useBrowsingReadingController.js');
    const navigation = source('src/ui/timeline/reading-navigation-coordinator.js');
    const surface = source('src/ui/conversation/ConversationSurface.jsx');
    expect(list).toContain("from 'react-virtuoso'");
    expect(list).not.toContain("from '@tanstack/react-virtual'");
    expect(list).not.toMatch(/scrollTop\s*=|scrollBy\(|\.scrollTo(?:Index)?\s*\(/);
    expect(list).not.toMatch(/pendingContentAnchor|commitBookmark|createScrollAuthority|settleNavigation/);
    // Semantic browsing restore has one activation/input-scoped public
    // Virtuoso positioning command. It never writes raw scrollTop, retries by
    // timer, or performs a pixel-delta correction.
    expect(list).toContain("import { executeReadingDOMCommand } from './reading-dom-command-executor.js'");
    expect(domExecutor.match(/\.scrollToIndex\(\{/g)).toHaveLength(1);
    expect(domExecutor).toMatch(/command\.type === 'position-row'/);
    expect(domExecutor).toMatch(/command\.type === 'scroll-tail'/);
    expect(list).not.toContain('autoscrollToBottom');
    expect(list).toMatch(/followOutput=\{false\}/);
    expect(list).not.toMatch(/followOutput=\{[^}]*READING_MODE|followOutput=['"](?:auto|smooth)['"]/);
    // One local DOM write is the only application geometry writer. Every
    // authorized trigger enters the same issuer; runtime geometry remains a
    // Chromium contract, not a jsdom assertion.
    expect(domExecutor.match(/\broot\.scrollTo\(\{/g)).toHaveLength(1);
    expect(domExecutor).toMatch(/writeScroll\(root, command\.reverse === true \? 0 : root\.scrollHeight\)/);
    expect(list.match(/type:\s*'scroll-tail'/g)).toHaveLength(2);
    expect(list).toMatch(/const enforceFollowingTail = useCallback[\s\S]*?current\.mode !== READING_MODE\.following[\s\S]*?input\.active && input\.direction !== 'newer'[\s\S]*?executeReadingDOMCommand\([\s\S]*?type:\s*'scroll-tail'/);
    expect(list).toMatch(/MutationObserver[\s\S]*?enforceFollowingTail\('layout'\)/);
    expect(list).toMatch(/totalListHeightChanged=\{\(\) => \{[\s\S]*?enforceFollowingTail\('layout'\)/);
    expect(browsing).toMatch(/\bonReadingObservation\b/);
    expect(browsing).toMatch(/\bonPresentationMaterialized\b/);
    expect(browsing).toMatch(/\bon(?:AtTop|NearTop|Underfill)\b/);
    expect(`${browsing}\n${navigation}`).not.toMatch(/document\.|window\.|querySelector|getBoundingClientRect|\.scrollTo\(/);
    expect(`${list}\n${browsing}\n${navigation}`).not.toMatch(/atoll:input-resize-prepared|data-input-resize-transition|timeline-input-resize-content/);
    expect(list).toMatch(/current\.bottomIntent/);
    expect(list).toMatch(/reading\.consumeBottomIntent\(intent\)/);
    expect(surface).not.toMatch(/scrollTop\s*=|scrollBy\(|scrollToIndex/);
    expect(() => source('src/ui/timeline/VirtualTimelineAdapter.jsx')).toThrow();
    expect(() => source('src/ui/timeline/useConversationViewport.js')).toThrow();
    expect(() => source('src/ui/timeline/scroll-authority.js')).toThrow();
  });

  it('keeps reading intent free of DOM and network side effects', () => {
    const model = source('src/model/reading-session.js');
    expect(model).not.toMatch(/document\.|window\.|scroll(?:Top|To|By|IntoView)\b|fetch\(|WebSocket|indexedDB/);
    expect(model).toContain('inputEpoch');
    expect(model).toContain('activationID');
  });

  it('keeps Composer outside the fixed reading geometry contract', () => {
    const surface = source('src/ui/conversation/ConversationSurface.jsx');
    const workspace = source('src/app/WorkspaceApp.jsx');
    const css = source('src/styles/app-shell.css');
    const composer = source('src/styles/composer.css');
    expect(surface).not.toMatch(/ResizeObserver|MutationObserver|requestAnimationFrame|dispatchEvent/);
    expect(surface).not.toMatch(/prepareSendClear|ComposerPresentation|sendClearRevision/);
    expect(surface).toMatch(/className="conversation-bottom-stack"/);
    expect(surface).not.toMatch(/floatingRef|waiting.*height|inputMaxHeight|scroll(?:Top|To|By|IntoView)/i);
    expect(workspace).toMatch(/composer:\s*<Composer model=\{composer\.model\} commands=\{composer\.commands\} \/>/);
    expect(workspace).toMatch(/<ConversationSurface \{\.\.\.conversationPort\} \/>/);
    expect(css).toMatch(/\.conversation-surface\s*\{[^}]*--conversation-composer-base-height:\s*100px[^}]*--conversation-reading-gap:\s*32px[^}]*--conversation-bottom-reserve:/s);
    expect(css).toMatch(/\.conversation-reading-slot\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0 0 var\(--conversation-bottom-reserve\)/s);
    expect(css).toMatch(/\.conversation-bottom-stack\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*0[^}]*max-height:\s*min\(var\(--conversation-input-max-height\), 100%\)/s);
    expect(css).toMatch(/\.conversation-input-slot\s*\{[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/s);
    expect(composer).toMatch(/\.composer-editor\s*\{[^}]*max-height:\s*160px[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.conversation-floating-slot\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*100%/s);
  });

  it('gives mobile keyboard geometry to one visual viewport owner', () => {
    const shell = source('src/app/SurfaceShell.jsx');
    const responsive = source('src/styles/responsive.css');
    const composer = source('src/ui/composer/Composer.jsx');
    expect(shell).toContain('globalThis.visualViewport');
    expect(shell).toContain("viewport.addEventListener('resize', commitFrame)");
    expect(shell).toContain("viewport.addEventListener('scroll', commitFrame)");
    expect(shell).not.toMatch(/scrollTop|scrollTo|scrollBy|querySelector|getBoundingClientRect/);
    expect(responsive).toMatch(/\.shell\[data-visual-viewport-owned="true"\]\s*\{[^}]*--visual-viewport-height/s);
    expect(composer).not.toMatch(/ComposerPresentation|sendClearRevision|prepareSendClear/);
    expect(() => source('src/ui/conversation/ComposerPresentationContext.jsx')).toThrow();
  });

  it('keeps async rich media inside stable first-paint boxes', () => {
    const markdown = source('src/ui/MarkdownContent.jsx');
    const mermaid = source('src/ui/MermaidBlock.jsx');
    const timeline = source('src/styles/timeline.css');
    expect(markdown).toContain('data-viewport-stable-media="image"');
    expect(mermaid).toContain('data-viewport-stable-media="mermaid"');
    expect(timeline).toMatch(/\.markdown-image-frame\s*\{[^}]*aspect-ratio:/s);
    expect(timeline).toMatch(/\.mermaid-stage\s*\{[^}]*block-size:/s);
  });

  it('keeps mobile channel navigation independent from the conversation grid', () => {
    const responsive = source('src/styles/responsive.css');
    expect(responsive).toMatch(/\.shell\.mobile-shell\.mobile-channels-open \.channel-rail\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(responsive).toMatch(/\.shell\.mobile-shell\.mobile-channels-open \.workspace,[\s\S]*visibility:\s*hidden/s);
    expect(responsive).not.toContain('.mobile-shell .dynamic-message-pane > .timeline');
  });
});
