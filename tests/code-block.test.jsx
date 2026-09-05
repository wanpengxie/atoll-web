// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownContent } from '../src/ui/MarkdownContent.jsx';
import { fenceLanguageOf, prismLanguageOf } from '../src/ui/CodeBlock.jsx';

afterEach(cleanup);

describe('围栏代码块', () => {
  it('语言名和 prism 语法名的映射', () => {
    expect(fenceLanguageOf('language-go')).toBe('go');
    expect(fenceLanguageOf('')).toBe('');
    expect(prismLanguageOf('py')).toBe('python');
    expect(prismLanguageOf('bash')).toBe('plain');
  });

  it('渲染顶栏（语言 + 复制）、高亮 token，并保留 pre > code 结构与原文', async () => {
    const source = '```go\nfunc main() {\n\tfmt.Println("hi")\n}\n```';
    const { container } = render(<MarkdownContent text={source} />);
    const block = container.querySelector('figure.code-block');
    expect(block).toBeTruthy();
    expect(block.getAttribute('data-language')).toBe('go');
    expect(block.querySelector('.code-block-lang').textContent).toBe('go');
    expect(block.querySelector('pre code').textContent).toBe('func main() {\n\tfmt.Println("hi")\n}\n');
    expect(block.querySelectorAll('pre code .token').length).toBeGreaterThan(0);
    expect(block.querySelector('.code-block-line-number')).toBeNull();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fireEvent.click(block.querySelector('.code-block-copy'));
    expect(writeText).toHaveBeenCalledWith('func main() {\n\tfmt.Println("hi")\n}');
    await waitFor(() => expect(block.querySelector('.code-block-copy').textContent).toBe('已复制'));
  });

  it('五行起显示行号；没写语言按纯文本，标签写 text', () => {
    const source = '```\n1\n2\n3\n4\n5\n```';
    const { container } = render(<MarkdownContent text={source} />);
    const block = container.querySelector('figure.code-block');
    expect(block.classList.contains('is-numbered')).toBe(true);
    expect(block.querySelectorAll('.code-block-line-number').length).toBe(5);
    expect(block.querySelector('.code-block-lang').textContent).toBe('text');
  });

  it('行内 code 不受影响', () => {
    const { container } = render(<MarkdownContent text={'一句 `inline` 话'} />);
    expect(container.querySelector('figure.code-block')).toBeNull();
    expect(container.querySelector('code').textContent).toBe('inline');
  });
});
