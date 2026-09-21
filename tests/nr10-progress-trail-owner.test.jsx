// @vitest-environment jsdom
// NR10-01/04: public TimelineRowRenderer owner for process detail and timing.
// Tool input/output is a bounded typed projection in the same drawer owner;
// wire payloads and the retired activity host/store remain out of scope.
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function processRow(seq, process, ts) {
  return {
    seq,
    envelope: {
      id: `nr10-progress-${seq}`,
      sender: { id: 'agent:worker:1', kind: 'agent' },
      ts,
      payload: { body: { status: 'processing', process } },
    },
  };
}

function turn(provisional, overrides = {}) {
  return {
    requestId: 'nr10-request',
    request: {
      id: 'nr10-request',
      kind: 'request',
      type: 'agent.ask',
      ts: '2026-09-21T05:00:00.000Z',
      sender: { id: 'human:root:1', kind: 'human' },
      audience: ['agent:worker:1'],
      payload: { body: { text: '整理过程' } },
    },
    status: 'processing',
    terminal: null,
    provisional,
    thread: [],
    ...overrides,
  };
}

function Renderer({ value, onOpenTurn }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map([['agent:worker:1', 'Worker']]),
    selfId: 'human:root:1',
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
    onOpenTurn,
  });
  return renderRow({
    id: value.requestId,
    contentRevision: 'nr10-1',
    body: { kind: 'turn', turn: value, thread: value.thread },
  });
}

describe('NR10 TimelineRowRenderer process trail', () => {
  it('opens safe public process正文 without exposing tool JSON', () => {
    const value = turn([
      processRow(1, { kind: 'stage', stage: 'text', text: '面向人的处理中进度' }, '2026-09-21T05:00:01.000Z'),
      processRow(2, { kind: 'stage', stage: 'thinking', text: '正在核对来源' }, '2026-09-21T05:00:02.000Z'),
      processRow(3, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-1', tool: 'search', outcome: 'completed',
        detail: '搜索过程已完成，命中 3 条来源。',
        input: { query: '账本模型', filters: { scope: 'channel' }, secret: 'must-not-render' },
        output: { hits: 3, secret: 'must-not-render' },
      }, '2026-09-21T05:00:03.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const answer = view.container.querySelector('.agent-progress-text');
    expect(answer?.textContent).toContain('面向人的处理中进度');

    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    const rows = [...trail.querySelectorAll('.progress-row')];
    expect(rows.map((row) => row.querySelector('.progress-row-line')?.textContent)).toEqual([
      '正在核对来源',
      'tool: search 完成',
    ]);
    fireEvent.click(rows[0].querySelector('button[title="查看完整内容"]'));

    const drawer = view.container.querySelector('[role="dialog"].progress-drawer');
    expect(drawer).toBeTruthy();
    expect(drawer?.textContent).toContain('正在核对来源');
    expect(drawer?.querySelector('pre')).toBeNull();
    expect(drawer?.textContent).not.toContain('must-not-render');
    fireEvent.click(drawer.querySelector('button[aria-label="关闭详情"]'));
    expect(view.container.querySelector('[role="dialog"].progress-drawer')).toBeNull();

    const tool = rows[1];
    fireEvent.click(tool.querySelector('button[title="查看完整内容"]'));
    const toolDrawer = view.container.querySelector('[role="dialog"].progress-drawer');
    expect(toolDrawer?.textContent).toContain('input');
    expect(toolDrawer?.textContent).toContain('账本模型');
    expect(toolDrawer?.textContent).toContain('output');
    expect(toolDrawer?.textContent).toContain('3');
    expect(toolDrawer?.textContent).not.toContain('must-not-render');
    const nested = toolDrawer?.querySelector('details');
    expect(nested).toBeTruthy();
    expect(nested.hasAttribute('open')).toBe(false);
    fireEvent.click(nested.querySelector('summary'));
    expect(nested.hasAttribute('open')).toBe(true);
    expect(toolDrawer?.textContent).toContain('scope');
  });

  it('shows every live row timestamp and only the latest row live duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T05:00:12.000Z'));
    const value = turn([
      processRow(1, { kind: 'stage', stage: 'thinking', text: '第一步' }, '2026-09-21T05:00:00.000Z'),
      processRow(2, { kind: 'stage', stage: 'stage', text: '第二步' }, '2026-09-21T05:00:10.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const trail = view.container.querySelector('.progress-trail.running');
    expect(trail.querySelectorAll('.progress-row time')).toHaveLength(2);
    expect(trail.querySelectorAll('.progress-row-duration')).toHaveLength(1);
    const before = trail.querySelector('.progress-row-duration').textContent;

    act(() => vi.advanceTimersByTime(2000));
    const after = trail.querySelector('.progress-row-duration').textContent;
    expect(after).not.toBe(before);
    expect(after).toContain('00:04');

    fireEvent.click(trail.querySelector('.progress-running-header'));
    expect(trail.querySelectorAll('.progress-row time')).toHaveLength(2);
    expect(trail.querySelectorAll('.progress-row-duration')).toHaveLength(1);
  });

  it('keeps an open tool drawer on the same call when its ended detail arrives', () => {
    const started = turn([
      processRow(1, {
        kind: 'tool', phase: 'started', tool_call_id: 'call-live', tool: 'search',
        detail: '开始搜索…',
        input: { query: 'initial', secret: 'must-not-render' },
      }, '2026-09-21T05:00:01.000Z'),
    ]);
    const view = render(<Renderer value={started} />);
    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    fireEvent.click(trail.querySelector('button[title="查看完整内容"]'));
    expect(view.container.querySelector('.progress-drawer-body')?.textContent).toContain('开始搜索…');

    const ended = turn([
      ...started.provisional,
      processRow(2, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-live', tool: 'search', outcome: 'completed',
        detail: '同一工具调用的公开结果。',
        output: { hits: 3, secret: 'must-not-render' },
      }, '2026-09-21T05:00:02.000Z'),
    ]);
    view.rerender(<Renderer value={ended} />);

    const drawer = view.container.querySelector('.progress-drawer-body');
    expect(drawer?.textContent).toContain('同一工具调用的公开结果。');
    expect(drawer?.textContent).toContain('initial');
    expect(drawer?.textContent).toContain('hits');
    expect(drawer?.textContent).not.toContain('must-not-render');
    expect(view.container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('keeps a tool status row non-actionable when typed detail and data are empty', () => {
    const value = turn([
      processRow(1, {
        kind: 'tool', phase: 'started', tool_call_id: 'call-no-detail', tool: 'search',
      }, '2026-09-21T05:00:01.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    const row = trail.querySelector('.progress-row');
    expect(row?.textContent).toContain('tool: search …');
    expect(row?.querySelector('button[title="查看完整内容"]')).toBeNull();
    expect(view.container.querySelector('[role="dialog"].progress-drawer')).toBeNull();
  });

  it('opens a bounded typed tool-data drawer even when detail text is absent', () => {
    const value = turn([
      processRow(1, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-data-only', tool: 'search', outcome: 'completed',
        input: { query: '账本模型', secret: 'must-not-render' },
        output: { hits: 3, secret: 'must-not-render' },
      }, '2026-09-21T05:00:01.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    const row = trail.querySelector('.progress-row');
    expect(row?.querySelector('button[title="查看完整内容"]')).toBeTruthy();
    fireEvent.click(row.querySelector('button[title="查看完整内容"]'));
    const drawer = view.container.querySelector('[role="dialog"].progress-drawer');
    expect(drawer?.textContent).toContain('账本模型');
    expect(drawer?.textContent).toContain('hits');
    expect(drawer?.textContent).not.toContain('must-not-render');
  });

  it('keeps native structured summaries in the modal focus cycle and returns the opener', () => {
    const value = turn([
      processRow(1, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-focus', tool: 'search', outcome: 'completed',
        input: { query: '账本模型', filters: { scope: 'channel' } },
      }, '2026-09-21T05:00:01.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    const row = trail.querySelector('.progress-row');
    const opener = row.querySelector('button[title="查看完整内容"]');
    opener.focus();
    fireEvent.click(opener);

    const drawer = view.container.querySelector('[role="dialog"].progress-drawer');
    const close = drawer.querySelector('button[aria-label="关闭详情"]');
    const summary = drawer.querySelector('.progress-json-shell details > summary');
    expect(summary).toBeTruthy();
    expect(document.activeElement).toBe(close);

    // jsdom does not perform the browser's default Tab movement, so the two
    // normal-direction assertions explicitly model that movement while the
    // modal's boundary cases exercise useModalFocus's native summary query.
    const forward = fireEvent.keyDown(close, { key: 'Tab', code: 'Tab' });
    expect(forward).toBe(true);
    summary.focus();
    expect(document.activeElement).toBe(summary);
    const backward = fireEvent.keyDown(summary, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(backward).toBe(true);
    close.focus();
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(summary);
    fireEvent.keyDown(summary, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(close);

    fireEvent.click(close);
    expect(view.container.querySelector('[role="dialog"].progress-drawer')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('bounds long and deeply nested typed tool data before rendering', () => {
    const longValue = `head-${'x'.repeat(5000)}-tail-marker`;
    const manyItems = Array.from({ length: 80 }, (_, index) => index === 79 ? 'array-tail-marker' : `item-${index}`);
    const manyFields = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [index === 79 ? 'field-tail-marker' : `field-${index}`, index]));
    const value = turn([
      processRow(1, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-bounded', tool: 'search', outcome: 'completed',
        input: {
          longValue,
          nested: { level1: { level2: { level3: { level4: 'not-rendered' } } } },
          manyItems,
          manyFields,
        },
      }, '2026-09-21T05:00:01.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    fireEvent.click(trail.querySelector('button[title="查看完整内容"]'));
    const drawer = view.container.querySelector('[role="dialog"].progress-drawer');
    expect(drawer?.textContent).toContain('head-');
    expect(drawer?.textContent).toContain('已省略');
    expect(drawer?.textContent).toContain('内容已折叠');
    expect(drawer?.textContent).not.toContain('tail-marker');
    expect(drawer?.textContent).not.toContain('not-rendered');
    expect(drawer?.textContent).not.toContain('array-tail-marker');
    expect(drawer?.textContent).not.toContain('field-tail-marker');
  });

  it('uses one total budget and fails closed for cyclic or unreadable data', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const unreadable = {};
    Object.defineProperty(unreadable, 'boom', {
      enumerable: true,
      get() { throw new Error('unreadable tool field'); },
    });
    const value = turn([
      processRow(1, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-cycle', tool: 'search', outcome: 'completed',
        input: cyclic,
      }, '2026-09-21T05:00:01.000Z'),
      processRow(2, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-unreadable', tool: 'search', outcome: 'completed',
        output: unreadable,
      }, '2026-09-21T05:00:02.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    const rows = [...trail.querySelectorAll('.progress-row')];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.querySelector('button[title="查看完整内容"]'))).toBe(true);
    expect(view.container.querySelector('.progress-drawer')).toBeNull();
  });

  it('gates the top-level public process action on typed progress正文', () => {
    const onOpenTurn = vi.fn();
    const started = turn([
      processRow(1, {
        kind: 'tool', phase: 'started', tool_call_id: 'call-top-level', tool: 'search',
      }, '2026-09-21T05:00:01.000Z'),
    ]);
    const view = render(<Renderer value={started} onOpenTurn={onOpenTurn} />);
    expect(view.queryAllByRole('button', { name: '查看过程' })).toHaveLength(0);
    expect(onOpenTurn).not.toHaveBeenCalled();
    expect(view.container.querySelector('.progress-drawer')).toBeNull();

    const ended = turn([
      ...started.provisional,
      processRow(2, {
        kind: 'tool', phase: 'ended', tool_call_id: 'call-top-level', tool: 'search',
        outcome: 'completed', detail: '顶层入口可见的公开结果。',
      }, '2026-09-21T05:00:02.000Z'),
    ]);
    view.rerender(<Renderer value={ended} onOpenTurn={onOpenTurn} />);
    const processButtons = view.getAllByRole('button', { name: '查看过程' });
    expect(processButtons).toHaveLength(2);
    fireEvent.click(processButtons[0]);
    expect(onOpenTurn).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'nr10-request' }));
  });

  it('keeps interleaved tool calls paired by tool_call_id', () => {
    const value = turn([
      processRow(1, { kind: 'tool', phase: 'started', tool_call_id: 'call-a', tool: 'search' }, '2026-09-21T05:00:01.000Z'),
      processRow(2, { kind: 'tool', phase: 'started', tool_call_id: 'call-b', tool: 'read' }, '2026-09-21T05:00:02.000Z'),
      processRow(3, { kind: 'tool', phase: 'ended', tool_call_id: 'call-a', tool: 'search', detail: 'A 的公开结果。' }, '2026-09-21T05:00:03.000Z'),
      processRow(4, { kind: 'tool', phase: 'ended', tool_call_id: 'call-b', tool: 'read', detail: 'B 的公开结果。' }, '2026-09-21T05:00:04.000Z'),
    ]);
    const view = render(<Renderer value={value} />);
    const trail = view.container.querySelector('.progress-trail.running');
    fireEvent.click(trail.querySelector('.progress-running-header'));
    const rows = [...trail.querySelectorAll('.progress-row')];
    expect(rows.map((row) => row.querySelector('.progress-row-line')?.textContent)).toEqual([
      'tool: search 完成',
      'tool: read 完成',
    ]);

    fireEvent.click(rows[0].querySelector('button[title="查看完整内容"]'));
    expect(view.container.querySelector('.progress-drawer-body')?.textContent).toContain('A 的公开结果。');
    expect(view.container.querySelector('.progress-drawer-body')?.textContent).not.toContain('B 的公开结果。');
    fireEvent.click(view.container.querySelector('button[aria-label="关闭详情"]'));
    fireEvent.click(rows[1].querySelector('button[title="查看完整内容"]'));
    expect(view.container.querySelector('.progress-drawer-body')?.textContent).toContain('B 的公开结果。');
    expect(view.container.querySelector('.progress-drawer-body')?.textContent).not.toContain('A 的公开结果。');
  });
});
