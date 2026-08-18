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
import { ArtifactContext, PREVIEW_LIMITS, readBoundedText } from '../src/ui/context/ArtifactContext.jsx';

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

  it('五千条动态只挂载一个窗口并可翻到更早窗口', async () => {
    const user = userEvent.setup();
    const standalone = Array.from({ length: 5_000 }, (_, index) => ({ seq: index + 1, envelope: envelope(`m-${index}`, index + 1) }));
    const state = { channelId: 'c0', rows: new Map(standalone.map((row) => [row.seq, row.envelope])), turns: new Map(), standalone, orphans: [], narration: [], lastSeq: 5_000 };
    const started = performance.now();
    const view = render(<Timeline state={state} roster={[{ id: 'alice', name: 'Alice' }]} pending={[]} approvalStates={{}} />);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(view.container.querySelectorAll('.standalone-row')).toHaveLength(LIST_WINDOW_SIZE);
    expect(screen.getByText('动态 5000')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /查看更早动态/ }));
    expect(view.container.querySelectorAll('.standalone-row')).toHaveLength(LIST_WINDOW_SIZE);
    expect(screen.getByText('动态 4880')).toBeTruthy();
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
