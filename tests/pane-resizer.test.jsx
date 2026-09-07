// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaneResizer } from '../src/ui/primitives/PaneResizer.jsx';

afterEach(cleanup);

describe('PaneResizer', () => {
  it('向变宽方向拖动，逐帧回报并在松手时提交', () => {
    const onResize = vi.fn(); const onCommit = vi.fn();
    render(<PaneResizer kind="rail" grows="right" width={264} onResize={onResize} onCommit={onCommit} label="调整频道栏宽度" />);
    const handle = screen.getByRole('separator', { name: '调整频道栏宽度' });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 264 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 340 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 340 });
    expect(onResize.mock.calls.map(([w]) => w)).toEqual([300, 340]);
    expect(onCommit).toHaveBeenCalledWith(340);
  });

  it('右侧面板向左拖变宽，并受视口上限约束', () => {
    const onResize = vi.fn();
    window.innerWidth = 1000;
    render(<PaneResizer kind="context" grows="left" width={360} onResize={onResize} label="调整右侧面板宽度" />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 640 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 540 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: -5000 });
    expect(onResize.mock.calls.map(([w]) => w)).toEqual([460, 580]);
  });

  it('没有记忆宽度时从实际量出的宽度起步；方向键与双击', () => {
    const onResize = vi.fn(); const onCommit = vi.fn(); const onReset = vi.fn();
    render(<PaneResizer kind="rail" grows="right" width={null} measure={() => 280} onResize={onResize} onCommit={onCommit} onReset={onReset} />);
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(296);
    expect(onCommit).toHaveBeenLastCalledWith(296);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenLastCalledWith(264);
    fireEvent.doubleClick(handle);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});
