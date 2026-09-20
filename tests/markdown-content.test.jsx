// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownContent, MarkdownFileReferenceProvider } from '../src/ui/MarkdownContent.jsx';
import { normalizeMathMarkdown } from '../src/model/math-markdown.js';

describe('MarkdownContent', () => {
  it('renders dollar and LaTeX bracket math while leaving code literal', () => {
    const source = [
      '行内 \\(M_t = \\operatorname{Fold}_R(H_t)\\) 与 $G_t$.',
      '',
      '\\[',
      '\\text{Problem}\\rightarrow\\text{Machine}',
      '\\]',
      '',
      '`\\(not math\\)`',
      '',
      '```tex',
      '\\[not math\\]',
      '```',
    ].join('\n');
    const { container } = render(<MarkdownContent text={source} />);
    expect(container.querySelectorAll('.katex').length).toBe(3);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(container.querySelector('code').textContent).toBe('\\(not math\\)');
    expect(container.querySelector('pre code').textContent).toContain('\\[not math\\]');
  });

  it('normalizes only paired, unescaped delimiters outside Markdown code', () => {
    const source = '\\(x\\) `\\(code\\)` \\\\(literal\\\\) \\[y\\] \\[unclosed';
    expect(normalizeMathMarkdown(source)).toBe('$x$ `\\(code\\)` \\\\(literal\\\\) $$y$$ \\[unclosed');
  });

  it('用 CommonMark/GFM AST 渲染表格、任务列表、删除线与链接', () => {
    const source = [
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| 报告 | 完成 |',
      '',
      '- [x] 已核对',
      '',
      '~~旧结论~~ [来源](https://example.com)',
    ].join('\n');
    const { container } = render(<MarkdownContent text={source} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('input[type="checkbox"]')?.disabled).toBe(true);
    expect(container.querySelector('del')?.textContent).toBe('旧结论');
    expect(screen.getByRole('link', { name: '来源' }).getAttribute('target')).toBe('_blank');
  });

  it('不把账本文本中的原始 HTML 当作可执行 DOM', () => {
    const { container } = render(<MarkdownContent text={'<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('prepared AST路径仍使用react-markdown的默认URL协议过滤', () => {
    const { container } = render(<MarkdownContent text="[危险](javascript:alert%281%29)" />);
    expect(container.querySelector('a').getAttribute('href')).toBe('');
  });

  it('在上下文内拦截显式绝对文件链接并保留普通网页链接', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<MarkdownFileReferenceProvider onOpen={onOpen}><MarkdownContent text={'[代码](/srv/atoll/work/main.go:42) [网页](https://example.com)'} /></MarkdownFileReferenceProvider>);
    const file = screen.getByRole('link', { name: '代码' });
    expect(file.getAttribute('target')).toBeNull();
    expect(file.classList.contains('markdown-file-reference')).toBe(true);
    await user.click(file);
    expect(onOpen).toHaveBeenCalledWith({ path: '/srv/atoll/work/main.go', line: 42 });
    expect(screen.getByRole('link', { name: '网页' }).getAttribute('target')).toBe('_blank');
  });

  it('prepared内容复用后仍读取当前文件打开上下文', async () => {
    const user = userEvent.setup();
    const firstOpen = vi.fn();
    const nextOpen = vi.fn();
    const view = render(<MarkdownFileReferenceProvider onOpen={firstOpen}><MarkdownContent contentKey="message:context-refresh:body" text={'[代码](/srv/atoll/work/main.go:42)'} /></MarkdownFileReferenceProvider>);
    view.rerender(<MarkdownFileReferenceProvider onOpen={nextOpen}><MarkdownContent contentKey="message:context-refresh:body" text={'[代码](/srv/atoll/work/main.go:42)'} /></MarkdownFileReferenceProvider>);
    await user.click(view.container.querySelector('a.markdown-file-reference'));
    expect(firstOpen).not.toHaveBeenCalled();
    expect(nextOpen).toHaveBeenCalledWith({ path: '/srv/atoll/work/main.go', line: 42 });
  });

  it('不猜测普通文本、行内代码、相对链接和协议相对链接', () => {
    const onOpen = vi.fn();
    const { container } = render(<MarkdownFileReferenceProvider onOpen={onOpen}><MarkdownContent text={'/srv/a.go:2 `/srv/b.go:3` [相对](docs/a.md) [站点](//example.com/a)'} /></MarkdownFileReferenceProvider>);
    expect(container.querySelectorAll('.markdown-file-reference')).toHaveLength(0);
  });

  it('远程图片解码前后复用同一个稳定媒体外框', () => {
    const { container } = render(<MarkdownContent text={'![架构图](https://example.com/diagram.png)'} />);
    const frame = container.querySelector('[data-viewport-stable-media="image"]');
    const image = frame.querySelector('img');
    expect(frame.dataset.imagePhase).toBe('loading');
    fireEvent.load(image);
    expect(frame.dataset.imagePhase).toBe('ready');
    expect(container.querySelector('[data-viewport-stable-media="image"]')).toBe(frame);
  });

  it('正文前插和流式续写不改名仍存活的语义块', () => {
    const view = render(<MarkdownContent contentKey="message:stable:body" text={'第一段\n\n保留段落'} />);
    const ids = () => Object.fromEntries([...view.container.querySelectorAll('[data-reading-block-id]')]
      .map((node) => [node.textContent, node.dataset.readingBlockId]));
    const initial = ids();
    view.rerender(<MarkdownContent contentKey="message:stable:body" text={'新前文\n\n第一段\n\n保留段落'} />);
    expect(ids()['第一段']).toBe(initial['第一段']);
    expect(ids()['保留段落']).toBe(initial['保留段落']);
    const beforeGrowth = ids()['保留段落'];
    view.rerender(<MarkdownContent contentKey="message:stable:body" text={'新前文\n\n第一段\n\n保留段落继续生成'} />);
    expect(ids()['保留段落继续生成']).toBe(beforeGrowth);
  });

  it('流式尾块更新时保留已完成块的真实DOM和原生选择', () => {
    const view = render(<MarkdownContent contentKey="message:selection:body" text={'已完成段落\n\n生成中'} />);
    const sealed = [...view.container.querySelectorAll('[data-reading-block-id]')]
      .find((node) => node.textContent === '已完成段落');
    const textNode = sealed.querySelector('p').firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    getSelection().removeAllRanges();
    getSelection().addRange(range);

    view.rerender(<MarkdownContent contentKey="message:selection:body" text={'已完成段落\n\n生成中继续'} />);

    const surviving = [...view.container.querySelectorAll('[data-reading-block-id]')]
      .find((node) => node.textContent === '已完成段落');
    expect(surviving.isSameNode(sealed)).toBe(true);
    expect(surviving.querySelector('p').firstChild.isSameNode(textNode)).toBe(true);
    expect(getSelection().anchorNode?.isSameNode(textNode)).toBe(true);
    expect(getSelection().toString()).toBe('已完成');
  });

  it('后台正文更新时保留宽表格的原生横向阅读位置', () => {
    const table = [
      '| marker | alpha | beta | gamma |',
      '| --- | --- | --- | --- |',
      '| marker-111111111111111111111111 | alpha-222222222222222222222222 | beta-333333333333333333333333 | gamma-444444444444444444444444 |',
    ].join('\n');
    const view = render(<MarkdownContent contentKey="message:wide-table:body" text={`${table}\n\n后台初始进度`} />);
    const before = view.container.querySelector('.markdown-table-scroll');
    before.scrollLeft = 137;

    view.rerender(<MarkdownContent contentKey="message:wide-table:body" text={`${table}\n\n后台更新进度`} />);

    const after = view.container.querySelector('.markdown-table-scroll');
    expect(after.isSameNode(before)).toBe(true);
    expect(after.scrollLeft).toBe(137);
  });

});
