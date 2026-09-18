// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('conversation architecture boundaries', () => {
  it('has one mature virtual-list geometry executor and no legacy engine', () => {
    const list = source('src/ui/timeline/LegendMessageList.jsx');
    const timeline = source('src/ui/Timeline.jsx');
    expect(list).toContain("from 'react-virtuoso'");
    expect(list).not.toContain("from '@tanstack/react-virtual'");
    expect(list).not.toMatch(/scrollTop\s*=|scrollBy\(/);
    expect(list).not.toMatch(/pendingContentAnchor|commitBookmark|createScrollAuthority|settleNavigation/);
    // Semantic browsing restore has one activation/input-scoped public
    // Virtuoso positioning command. It never writes raw scrollTop, retries by
    // timer, or performs a pixel-delta correction.
    expect(list.match(/virtuosoRef\.current\.scrollToIndex\(\{/g)).toHaveLength(1);
    expect(list).not.toContain('autoscrollToBottom');
    expect(list).toMatch(/followOutput=\{false\}/);
    // One local DOM write is the only application geometry writer. Every
    // authorized trigger enters the same issuer; runtime geometry remains a
    // Chromium contract, not a jsdom assertion.
    expect(list.match(/\broot\.scrollTo\(\{\s*top:\s*root\.scrollHeight,\s*behavior:\s*'auto'\s*\}\)/g)).toHaveLength(1);
    expect(list).toContain("issueBottomIfCurrent('explicit-bottom')");
    expect(list).toContain("issueBottomIfCurrent('item-layout')");
    expect(list).toContain("issueBottomIfCurrent('list-commit')");
    expect(list).toContain("issueBottomIfCurrent('snapshot-commit')");
    expect(list).toContain("issueBottomIfCurrent('viewport-layout')");
    expect(timeline).not.toMatch(/scrollTop\s*=|scrollBy\(|scrollToIndex/);
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

  it('lets ConversationSurface measure only the input stack', () => {
    const surface = source('src/ui/conversation/ConversationSurface.jsx');
    const timeline = source('src/ui/Timeline.jsx');
    const css = source('src/styles/app-shell.css');
    // 要守的是「只有一个观察器实例」，所以数 new，不数这个词的出现次数。
    // 原写法把注释里提到 ResizeObserver 的句子也算进去，于是解释性注释一多
    // 就红，红的却不是它想守的东西（2026-09-18 接手时实测：实例始终只有一个）。
    expect(surface.match(/new ResizeObserver/g)).toHaveLength(1);
    expect(surface).toMatch(/ref=\{inputRef\} className="conversation-bottom-stack"/);
    expect(surface).not.toMatch(/floatingRef|waiting.*height/i);
    expect(timeline).toMatch(/<ConversationSurface input=\{composer\} floating=\{floatingInput\}>/);
    expect(css).toMatch(/\.conversation-surface\s*\{[^}]*--conversation-reading-gap:\s*32px[^}]*grid-template-rows:/s);
    expect(css).toMatch(/\.conversation-bottom-stack\s*\{[^}]*position:\s*relative/s);
    expect(css).toMatch(/\.conversation-floating-slot\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*100%/s);
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
