// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UiActivityOverlay } from '../src/ui/UiActivityOverlay.jsx';

afterEach(cleanup);
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const entry = (over = {}) => ({ id: 'r1', type: 'ui.navigate', body: { channel_id: 'c0' }, ok: true, at: Date.now(), ...over });

describe('频道操作了这块屏的回执', () => {
  it('没操作过就什么都不显示', () => {
    const { container } = render(<UiActivityOverlay entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('说清楚发生了什么,而不是只说"有个操作"', () => {
    render(<UiActivityOverlay entries={[
      entry({ id: 'a', type: 'ui.navigate', body: { channel_id: 'c0', view: 'artifacts' } }),
      entry({ id: 'b', type: 'ui.open', body: { path: '/tmp/x.go', line: 42 } }),
    ]} />);
    expect(screen.getByText(/切到 c0 · artifacts/)).toBeTruthy();
    expect(screen.getByText(/打开 \/tmp\/x\.go:42/)).toBeTruthy();
  });

  // 失败的那条尤其要看得见:这条链路存在的一半意义就是前端能说"我没做成"。
  it('没做成的操作要说出原因', () => {
    render(<UiActivityOverlay entries={[entry({ ok: false, error: 'no channel c0.nope here' })]} />);
    expect(screen.getByText(/no channel c0\.nope here/)).toBeTruthy();
  });

  it('最后一条之后一分钟自己消失', () => {
    const { container } = render(<UiActivityOverlay entries={[entry()]} />);
    expect(container.firstChild).not.toBeNull();
    act(() => { vi.advanceTimersByTime(59_000); });
    expect(container.firstChild).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(container.firstChild).toBeNull();
  });

  it('来了新的一条就重新计时', () => {
    const first = entry({ id: 'a' });
    const { container, rerender } = render(<UiActivityOverlay entries={[first]} />);
    act(() => { vi.advanceTimersByTime(55_000); });
    rerender(<UiActivityOverlay entries={[first, entry({ id: 'b', at: Date.now() })]} />);
    act(() => { vi.advanceTimersByTime(30_000); });   // 距第一条已 85s,距第二条才 30s
    expect(container.firstChild).not.toBeNull();
  });

  it('关掉就立刻消失,但下一条操作还会再出现', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = entry({ id: 'a' });
    const { container, rerender } = render(<UiActivityOverlay entries={[first]} />);
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(container.firstChild).toBeNull();
    // 关掉是"这一批我看过了",不是"以后都别烦我"。
    rerender(<UiActivityOverlay entries={[first, entry({ id: 'b', at: Date.now() })]} />);
    expect(container.firstChild).not.toBeNull();
  });
});
