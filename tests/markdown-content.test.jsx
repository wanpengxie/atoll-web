// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
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

  it('不猜测普通文本、行内代码、相对链接和协议相对链接', () => {
    const onOpen = vi.fn();
    const { container } = render(<MarkdownFileReferenceProvider onOpen={onOpen}><MarkdownContent text={'/srv/a.go:2 `/srv/b.go:3` [相对](docs/a.md) [站点](//example.com/a)'} /></MarkdownFileReferenceProvider>);
    expect(container.querySelectorAll('.markdown-file-reference')).toHaveLength(0);
  });
});
