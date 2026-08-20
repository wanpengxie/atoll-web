// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from '../src/ui/MarkdownContent.jsx';

describe('MarkdownContent', () => {
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
});
