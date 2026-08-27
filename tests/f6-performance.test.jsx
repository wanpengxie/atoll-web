// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { boundedPage, LIST_WINDOW_SIZE } from '../src/model/list-window.js';
import { buildArtifactIndex } from '../src/model/artifacts.js';
import { orderedTimeline } from '../src/model/fold.js';
import { TasksView } from '../src/ui/TasksView.jsx';
import { Timeline } from '../src/ui/Timeline.jsx';
import { Composer } from '../src/ui/Composer.jsx';
import { ArtifactContext, ArtifactPreviewBody, PREVIEW_LIMITS, readBoundedText } from '../src/ui/context/ArtifactContext.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function envelope(id, seq, attachment) {
  return {
    id, kind: 'event', type: 'human.note', ts: 1_700_000_000_000 + seq,
    sender: { id: 'alice', kind: 'human' }, payload: attachment
      ? { text: `产物 ${seq}`, attachments: [attachment] }
      : { text: `动态 ${seq}` },
  };
}

describe('F6 长列表预算', () => {
  it('固定窗口对一万项投影保持 120 项上限', () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index);
    const started = performance.now();
    const page = boundedPage(values);
    const elapsed = performance.now() - started;
    expect(page.items).toHaveLength(LIST_WINDOW_SIZE);
    expect(page.items[0]).toBe(9_880);
    expect(elapsed).toBeLessThan(50);
  });

  it('同一账本版本复用动态排序和产物索引', () => {
    const standalone = Array.from({ length: 1_000 }, (_, index) => ({ seq: index + 1, envelope: envelope(`m-${index}`, index + 1) }));
    const state = { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], lastSeq: 1_000 };
    expect(orderedTimeline(state)).toBe(orderedTimeline(state));
    expect(buildArtifactIndex(state)).toBe(buildArtifactIndex(state));
  });

  it('五千条动态由虚拟列表限制 DOM', async () => {
    const standalone = Array.from({ length: 5_000 }, (_, index) => ({ seq: index + 1, envelope: envelope(`m-${index}`, index + 1) }));
    const state = { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: 5_000 };
    const started = performance.now();
    const view = render(<Timeline state={state} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(await screen.findByText('动态 1')).toBeTruthy();
    const rendered = view.container.querySelectorAll('.standalone-row').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
    expect(screen.queryByText('动态 5000')).toBeNull();
  });

  it('向前 prepend 时由 Virtuoso 保持窗口且 DOM 仍有界', async () => {
    const makeState = (from) => {
      const standalone = Array.from({ length: 501 - from }, (_, index) => ({ seq: from + index, envelope: envelope(`m-${from + index}`, from + index) }));
      return { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: 500 };
    };
    const view = render(<Timeline state={makeState(201)} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />);
    expect(await screen.findByText('动态 201')).toBeTruthy();
    const before = view.container.querySelectorAll('.standalone-row').length;
    view.rerender(<Timeline state={makeState(169)} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />);
    await waitFor(() => expect(screen.getByText('动态 201')).toBeTruthy());
    expect(view.container.querySelectorAll('.standalone-row').length).toBeLessThanOrEqual(before + 4);
  });

  it('后台历史只进入蓄水池，实时尾部仍立即进入已展开窗口', async () => {
    const makeState = (from, to) => {
      const standalone = Array.from({ length: to - from + 1 }, (_, index) => {
        const seq = from + index;
        return { seq, envelope: envelope(`m-${seq}`, seq) };
      });
      return { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: to };
    };
    const view = render(<Timeline state={makeState(201, 500)} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />);
    expect(await screen.findByText('动态 201')).toBeTruthy();
    const before = view.container.querySelectorAll('.standalone-row').length;
    view.rerender(<Timeline state={makeState(201, 500)} history={{ buffered: 5_000 }} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />);
    expect(view.container.querySelectorAll('.standalone-row').length).toBe(before);
    view.rerender(<Timeline state={makeState(201, 501)} history={{ buffered: 5_000 }} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />);
    expect(view.container.querySelectorAll('.standalone-row').length).toBeLessThan(100);
  });

  it('长动态下逐字输入不会重新渲染 Timeline', async () => {
    const user = userEvent.setup();
    const standalone = Array.from({ length: 5_000 }, (_, index) => ({ seq: index + 1, envelope: envelope(`m-${index}`, index + 1) }));
    const state = { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: 5_000 };
    let timelineRenders = 0;
    let draft = '';
    function TrackedTimeline() {
      timelineRenders += 1;
      return <Timeline state={state} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />;
    }
    render(<><TrackedTimeline /><Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" onDraftChange={(value) => { draft = value; }} onSend={() => Promise.resolve('message-1')} /></>);
    const before = timelineRenders;
    await user.type(screen.getByRole('textbox', { name: '消息' }), '这段输入不应驱动五千条动态重新渲染');
    expect(draft.text).toBe('这段输入不应驱动五千条动态重新渲染');
    expect(draft.doc.type).toBe('doc');
    expect(timelineRenders).toBe(before);
  });

  it('任务集合不超过一个 DOM 窗口', () => {
    const items = Array.from({ length: 1_000 }, (_, index) => ({ key: `task-${index}`, kind: 'task', title: `任务 ${index}`, state: 'active', assigneeActorIds: ['me'], actionableBySelf: true, priority: 'normal', updatedAt: index }));
    const taskView = render(<TasksView items={items} roster={[{ id: 'me', name: '我' }]} selfId="me" providers={[]} onOpen={() => {}} onNewAutomation={() => {}} />);
    expect(taskView.container.querySelectorAll('.work-item-row')).toHaveLength(LIST_WINDOW_SIZE);
  });
});

describe('F6 预览生命周期预算', () => {
  const imageArtifact = { channelId: 'c0', resourceId: 'r1', name: '大图.png', mediaType: 'image/png', kind: 'image', preview: 'image', size: 10, source: { seq: 1 } };
  const props = { authorName: 'Alice', onDownload: () => {}, onAttach: () => {}, onSource: () => {}, onClose: () => {} };

  it('文本文件定位并标记消息链接指定的行号', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const view = render(<ArtifactPreviewBody artifact={{ preview: 'text', line: 2 }} preview={{ phase: 'ready', text: '第一行\n第二行\n第三行' }} />);
    const target = view.container.querySelector('[data-line="2"]');
    expect(target?.textContent).toBe('第二行');
    expect(target?.classList.contains('is-target')).toBe(true);
    expect(view.container.querySelector('pre')?.textContent).toBe('第一行\n第二行\n第三行');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
  });

  it('文本流超过 512 KiB 时立即取消 reader', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const chunks = [new Uint8Array(300 * 1024), new Uint8Array(300 * 1024)];
    const reader = { read: vi.fn(() => Promise.resolve(chunks.length ? { done: false, value: chunks.shift() } : { done: true })), cancel, releaseLock: vi.fn() };
    const response = { headers: { get: () => '0' }, body: { getReader: () => reader } };
    await expect(readBoundedText(response)).rejects.toThrow(/超过站内预览上限/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('已知超限文件在申请 ticket 前安全降级', async () => {
    const onResource = vi.fn();
    render(<ArtifactContext artifact={{ ...imageArtifact, size: PREVIEW_LIMITS.image + 1 }} onResource={onResource} {...props} />);
    expect(await screen.findByText(/超过站内预览上限/)).toBeTruthy();
    expect(onResource).not.toHaveBeenCalled();
  });

  it('服务端声明大小或实际 Blob 超限时不创建 Object URL', async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const blob = vi.fn(() => Promise.resolve({ size: PREVIEW_LIMITS.image + 1 }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, headers: { get: () => String(PREVIEW_LIMITS.image + 1) }, blob })));
    const first = render(<ArtifactContext artifact={imageArtifact} onResource={() => Promise.resolve({ ticket: 't', address: 'a' })} {...props} />);
    expect(await screen.findByText(/超过站内预览上限/)).toBeTruthy();
    expect(blob).not.toHaveBeenCalled();
    first.unmount();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, headers: { get: () => '0' }, blob })));
    render(<ArtifactContext artifact={imageArtifact} onResource={() => Promise.resolve({ ticket: 't', address: 'a' })} {...props} />);
    expect(await screen.findByText(/超过站内预览上限/)).toBeTruthy();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('关闭预览会取消 fetch，并释放晚到的 Object URL', async () => {
    let resolveBlob;
    const blobPromise = new Promise((resolve) => { resolveBlob = resolve; });
    let fetchSignal;
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      fetchSignal = options.signal;
      return Promise.resolve({ ok: true, headers: { get: () => '10' }, blob: () => blobPromise });
    }));
    const createObjectURL = vi.fn(() => 'blob:preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const view = render(<ArtifactContext artifact={imageArtifact} onResource={() => Promise.resolve({ ticket: 't', address: 'a' })} {...props} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    view.unmount();
    expect(fetchSignal.aborted).toBe(true);
    resolveBlob(new Blob(['1234567890'], { type: 'image/png' }));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview'));
  });
});
