// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderDiagram = vi.fn();
const initialize = vi.fn();

vi.mock('mermaid', () => ({
  default: { initialize, render: renderDiagram },
}));

import { MarkdownContent } from '../src/ui/MarkdownContent.jsx';
import { clearMermaidDiagramCache } from '../src/ui/MermaidBlock.jsx';

afterEach(() => {
  cleanup();
  clearMermaidDiagramCache();
  renderDiagram.mockReset();
});

describe('Mermaid 围栏图表', () => {
  it('渲染图表，并可切换查看原始源码', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-diagram="ok"><text>A</text></svg>' });
    const { container } = render(<MarkdownContent text={'```mermaid\ngraph LR\n  A --> B\n```'} />);

    await waitFor(() => expect(container.querySelector('svg[data-diagram="ok"]')).toBeTruthy());
    expect(renderDiagram).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph LR\n  A --> B');
    fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
    expect(container.querySelector('pre code').textContent).toContain('graph LR');
    fireEvent.click(screen.getByRole('button', { name: '查看图表' }));
    expect(container.querySelector('svg[data-diagram="ok"]')).toBeTruthy();
  });

  it('语法错误时展示错误和源码，不影响消息其余内容', async () => {
    renderDiagram.mockRejectedValue(new Error('Parse error on line 2'));
    const { container } = render(<MarkdownContent text={'前文\n\n```mermaid\nbroken\n```\n\n后文'} />);

    await screen.findByRole('alert');
    expect(screen.getByText('图表语法有误')).toBeTruthy();
    expect(container.querySelector('pre code').textContent).toContain('broken');
    expect(container.textContent).toContain('前文');
    expect(container.textContent).toContain('后文');
  });

  it('消息流父级刷新时不重复绘制同一张图', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-diagram="stable"><text>A</text></svg>' });
    const source = '```mermaid\ngraph LR\n  A --> B\n```';
    const view = render(<MarkdownContent text={source} />);
    await waitFor(() => expect(view.container.querySelector('svg[data-diagram="stable"]')).toBeTruthy());

    view.rerender(<MarkdownContent text={source} className="parent-refreshed" />);
    await Promise.resolve();
    expect(renderDiagram).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('svg[data-diagram="stable"]')).toBeTruthy();

    view.rerender(<MarkdownContent text={`${source}\n\n后续流式文本`} className="parent-refreshed" />);
    await Promise.resolve();
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it('React 严格模式的 effect 探测不会并发重画', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-diagram="strict" />' });
    const { container } = render(<React.StrictMode><MarkdownContent text={'```mermaid\ngraph TD\nA-->B\n```'} /></React.StrictMode>);
    await waitFor(() => expect(container.querySelector('svg[data-diagram="strict"]')).toBeTruthy());
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it('虚拟列表卸载再挂载时首帧复用 SVG，不退回占位或源码', async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-diagram="cached" />' });
    const source = '```mermaid\ngraph LR\ncache-->stable\n```';
    const first = render(<MarkdownContent text={source} />);
    await waitFor(() => expect(first.container.querySelector('svg[data-diagram="cached"]')).toBeTruthy());
    first.unmount();

    const second = render(<MarkdownContent text={source} />);
    expect(second.container.querySelector('svg[data-diagram="cached"]')).toBeTruthy();
    expect(screen.queryByText('正在绘图…')).toBeNull();
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });

  it('相同图表复用一次渲染，但每个挂载拥有独立的 SVG 引用 ID', async () => {
    renderDiagram.mockResolvedValue({
      svg: '<svg id="canonical"><defs><marker id="arrow"><path /></marker></defs><path class="edge" marker-end="url(#arrow)" /></svg>',
    });
    const diagram = '```mermaid\ngraph LR\nA-->B\n```';
    const { container } = render(<MarkdownContent text={`${diagram}\n\n${diagram}`} />);
    await waitFor(() => expect(container.querySelectorAll('.mermaid-diagram svg')).toHaveLength(2));

    const svgs = [...container.querySelectorAll('.mermaid-diagram svg')];
    const markerIds = svgs.map((svg) => svg.querySelector('marker').id);
    expect(new Set(markerIds).size).toBe(2);
    expect(svgs[0].querySelector('.edge').getAttribute('marker-end')).toBe(`url(#${markerIds[0]})`);
    expect(svgs[1].querySelector('.edge').getAttribute('marker-end')).toBe(`url(#${markerIds[1]})`);
    expect(renderDiagram).toHaveBeenCalledTimes(1);
  });
});
