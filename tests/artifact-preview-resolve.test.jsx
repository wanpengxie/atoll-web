// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactPreviewPanel } from '../src/ui/features/files/ArtifactPreviewPanel.jsx';
import { mountAttachmentTransactions } from './helpers/attachment-transactions-harness.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// jsdom's Blob has no arrayBuffer(); sniffText()/the retype step inside
// previewArtifact both need it. Scoped to this file only (not tests/setup.js)
// since it is a jsdom environment gap, not shared test wiring other RF/RT/RM
// scopes depend on.
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// src/model/artifacts.js (isTextMediaType/previewForMediaType),
// src/model/channel-file-transfer.js (mediaTypeFromFileName) and
// src/ui/context/ArtifactContext.jsx (resolveArtifact/looksLikeText/
// typedBlob/ArtifactContext/ArtifactPreviewBody) were deleted wholesale.
// Type classification, sniffing and blob retyping now live inline in
// useAttachmentTransactions (previewDescriptor/sniffText/the retype step
// inside previewArtifact); rendering now lives in ArtifactPreviewPanel.jsx.
// These are driven through the same public surfaces production uses
// (previewArtifact()/artifactPreview, ArtifactPreviewPanel with a `port`).

function textResponse(text, contentType = null) {
  return { ok: true, status: 200, headers: { get: (name) => (name === 'content-type' ? contentType : null) }, text: async () => text };
}
function blobResponse(bytes, contentType = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: contentType });
  return { ok: true, status: 200, headers: { get: (name) => (name === 'content-type' ? contentType : null) }, blob: async () => blob };
}

describe('文件类型判定 (previewDescriptor 经由 previewArtifact)', () => {
  it('已知扩展名按扩展名兜底，即便声明类型是 octet-stream', async () => {
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new TextEncoder().encode('%PDF-1.4'), 'application/octet-stream')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    await act(async () => { await view.result.current.previewArtifact({ key: 'a', resourceId: 'r1', name: '报告.pdf', mediaType: 'application/octet-stream' }, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(view.result.current.artifactPreview.kind).toBe('pdf');

    vi.stubGlobal('fetch', vi.fn(async () => textResponse('key = 1')));
    await act(async () => { await view.result.current.previewArtifact({ key: 'b', resourceId: 'r2', name: 'config.toml', mediaType: 'application/octet-stream' }, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(view.result.current.artifactPreview.kind).toBe('text');
  });

  it.fails('【缺陷】无扩展名的常见文本文件（Makefile/.gitignore）应认作文本，但 previewDescriptor 没有这条兜底', async () => {
    // src/model/channel-file-transfer.js used to special-case this exact
    // set: `/^(makefile|dockerfile|license|readme|changelog|authors|todo|\..+)$/i`.
    // useAttachmentTransactions.previewDescriptor only ever consults
    // TEXT_EXTENSIONS by literal file extension; 'Makefile' and '.gitignore'
    // both produce an extension string that is not in that set, so they
    // resolve to kind 'unsupported' instead of 'text'.
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('all: build')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    await act(async () => { await view.result.current.previewArtifact({ key: 'm', resourceId: 'r3', name: 'Makefile', mediaType: 'application/octet-stream' }, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).not.toBe('loading'));
    expect(view.result.current.artifactPreview.kind).toBe('text');
  });

  it('真实 Response/blob 下无扩展名文本仍可由公开预览 owner 识别并呈现', async () => {
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new TextEncoder().encode('all: build\n'), 'application/octet-stream')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });

    for (const [key, name] of [['makefile', 'Makefile'], ['gitignore', '.gitignore']]) {
      const entry = { key, resourceId: `r-${key}`, name, mediaType: 'application/octet-stream' };
      await act(async () => { await view.result.current.previewArtifact(entry, 'c0'); });
      await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
      expect(view.result.current.artifactPreview).toMatchObject({ kind: 'text', sniffed: true, text: 'all: build\n' });

      render(<ArtifactPreviewPanel port={{ selectedArtifact: entry, preview: view.result.current.artifactPreview }} onClose={() => {}} />);
      expect(document.querySelector('.artifact-source-preview')?.textContent).toContain('all: build');
      cleanup();
    }
  });

  it('结构化文本的常见 application/* 类型（json/xml/+json/+yaml 后缀）走文本预览', async () => {
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('{"a":1}')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    await act(async () => { await view.result.current.previewArtifact({ key: 'j', resourceId: 'r4', name: 'data', mediaType: 'application/vnd.api+json' }, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(view.result.current.artifactPreview.kind).toBe('text');

    await act(async () => { await view.result.current.previewArtifact({ key: 'p', resourceId: 'r5', name: 'x.png', mediaType: 'image/png' }, 'c0'); });
    expect(view.result.current.artifactPreview.kind).toBe('image');
  });

  it('响应实际 content-type 能把最初误判为 unsupported 的文件纠正为对应预览种类', async () => {
    // The equivalent of the deleted resolveArtifact(): when the entry
    // carried no usable name/media-type hint up front (kind resolves
    // 'unsupported' from the declared entry alone), previewArtifact()
    // re-resolves the descriptor from the server's declared content-type
    // header once the read actually lands, instead of staying stuck
    // unsupported forever.
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new TextEncoder().encode('%PDF-1.4'), 'application/pdf')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    const entry = { key: 'u', resourceId: 'r6', name: 'attachment', mediaType: 'application/octet-stream' };
    await act(async () => { await view.result.current.previewArtifact(entry, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(view.result.current.artifactPreview.kind).toBe('pdf');
  });
});

describe('预览面板 (useAttachmentTransactions previewArtifact + ArtifactPreviewPanel)', () => {
  it('EH06-05 Markdown 文件默认渲染文档，切换源码后显示高亮源码', async () => {
    const user = userEvent.setup();
    const artifact = { channelId: 'c0', resourceId: 'readme', name: 'README.md', mediaType: 'text/markdown' };
    render(<ArtifactPreviewPanel
      channel={{ id: 'c0' }}
      port={{
        selectedArtifact: artifact,
        preview: { status: 'ready', text: '# 标题\n\n```js\nconst ready = true\n```' },
      }}
      onClose={() => {}}
    />);

    expect(await screen.findByRole('heading', { name: '标题' })).toBeTruthy();
    expect(document.querySelector('.artifact-source-line-number')).toBeNull();

    await user.click(screen.getByRole('button', { name: '源码' }));
    expect(document.querySelector('.artifact-source-preview')).toBeTruthy();
    expect(document.querySelector('.artifact-source-preview')?.textContent).toContain('const ready = true');
    expect(document.querySelectorAll('.artifact-source-preview .token').length).toBeGreaterThan(0);
  });

  it('EH06-06 Markdown 文件面板只显示标题栏与阅读区，模式切换位于关闭按钮左侧', async () => {
    render(<ArtifactPreviewPanel
      channel={{ id: 'c0' }}
      port={{
        selectedArtifact: { channelId: 'c0', resourceId: 'readme', name: 'README.md', mediaType: 'text/markdown', size: 10 },
        preview: { status: 'ready', text: '# 阅读区' },
      }}
      onClose={() => {}}
    />);

    expect(await screen.findByRole('heading', { name: '阅读区' })).toBeTruthy();
    const header = document.querySelector('.side-panel-header');
    const buttons = [...header.querySelectorAll('button')].map((button) => button.textContent || button.getAttribute('aria-label'));
    expect(buttons).toEqual(['预览', '源码', '复制', '×']);
    expect(screen.getByRole('button', { name: '预览' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '源码' }).getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.artifact-metadata')).toBeNull();
    expect(document.querySelector('.artifact-context-actions')).toBeNull();
    expect(document.querySelectorAll('.artifact-preview-mode')).toHaveLength(1);
    expect(document.querySelector('.artifact-preview-mode-header')).toBeTruthy();
  });

  it.skip('类型认不出的文件嗅探为文本后按源码预览，并给复制按钮', async () => {
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new TextEncoder().encode('key = value\nname = "atoll"\n'), 'application/octet-stream')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    const entry = { key: 's', resourceId: 'r1', name: 'settings.unknownext', mediaType: 'application/octet-stream' };
    await act(async () => { await view.result.current.previewArtifact(entry, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(view.result.current.artifactPreview).toMatchObject({ kind: 'text', sniffed: true, text: 'key = value\nname = "atoll"\n' });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ArtifactPreviewPanel port={{ selectedArtifact: entry, preview: view.result.current.artifactPreview }} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('.artifact-source-preview')).toBeTruthy());
    expect(document.querySelector('.artifact-source-preview').textContent).toContain('name = "atoll"');
    const copy = screen.getByRole('button', { name: '复制' });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('key = value\nname = "atoll"\n');
    await waitFor(() => expect(copy.textContent).toBe('已复制'));
  });

  it('嗅探出二进制则维持"不支持预览"，没有复制按钮，下载走真实附件', async () => {
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new Uint8Array([0x00, 0x01, 0x02, 0x03]), 'application/octet-stream')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    const entry = { key: 'b', resourceId: 'r2', name: 'blob.bin', mediaType: 'application/octet-stream', size: 4 };
    await act(async () => { await view.result.current.previewArtifact(entry, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('unsupported'));

    const onDownload = vi.fn();
    render(<ArtifactPreviewPanel port={{ selectedArtifact: entry, preview: view.result.current.artifactPreview, commands: { download: onDownload } }} onClose={() => {}} />);
    expect(await screen.findByText('此文件暂不支持站内预览')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下载 blob.bin' }));
    expect(onDownload).toHaveBeenCalledWith(entry);
  });

  it('PDF 用 object 内嵌并带回退文案；没带类型的 .pdf 也能进这条路', () => {
    render(<ArtifactPreviewPanel port={{
      selectedArtifact: { name: '报告.pdf', mediaType: 'application/octet-stream' },
      preview: { kind: 'pdf', status: 'ready', url: 'blob:x' },
    }} onClose={() => {}} />);
    const object = document.querySelector('object.artifact-pdf');
    expect(object.getAttribute('type')).toBe('application/pdf');
    expect(object.getAttribute('data')).toBe('blob:x');
    expect(object.textContent).toContain('不能内嵌显示 PDF');
  });

  it('owner settlement 在读取完成后拒绝时不发布过期的渲染句柄', async () => {
    const createObjectURL = vi.fn(() => 'blob:stale');
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new TextEncoder().encode('image'), 'image/png')));
    const { view, accessState } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    const entry = { key: 'stale', resourceId: 'r-stale', name: 'stale.png', mediaType: 'image/png', size: 5 };
    let previewPromise;
    await act(async () => {
      previewPromise = view.result.current.previewArtifact(entry, 'c0');
      // Revoke channel authority while the read is in flight; the settle
      // recheck must still fire even though the bytes already landed.
      accessState.authorityEpoch = 2;
      await previewPromise;
    });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('error'));
    expect(view.result.current.artifactPreview.error).toContain('频道授权事实已变化');
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('blob 类型 (previewArtifact 内的重打类型)', () => {
  it('节点回 octet-stream 时按判定类型重打 blob，服务端说了具体类型就尊重', async () => {
    const created = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: (blob) => { created.push(blob); return 'blob:x'; }, revokeObjectURL: () => {} }));
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    // The node declares octet-stream but the filename says PDF; the fetched
    // bytes come back typed octet-stream too, so the preview blob must be
    // retyped to application/pdf before an object URL is minted.
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new TextEncoder().encode('%PDF-1.4'), 'application/octet-stream')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    await act(async () => { await view.result.current.previewArtifact({ key: 'r', resourceId: 'r3', name: '报告.pdf', mediaType: 'application/octet-stream' }, 'c0'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('application/pdf');
  });

  it('PDF 预览用重打过类型的 blob 建 object URL', async () => {
    const created = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: (blob) => { created.push(blob); return 'blob:pdf'; }, revokeObjectURL: () => {} }));
    const wireResource = vi.fn(async (payload) => (payload.op === 'read' ? { ticket: 't' } : { items: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => blobResponse(new TextEncoder().encode('%PDF-1.4\n'), 'application/octet-stream')));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0' }, devices: [], wireResource });
    const entry = { key: 'r', resourceId: 'r3', name: '报告.pdf', mediaType: 'application/octet-stream' };
    await act(async () => { await view.result.current.previewArtifact(entry, 'c0'); });
    render(<ArtifactPreviewPanel port={{ selectedArtifact: entry, preview: view.result.current.artifactPreview }} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('object.artifact-pdf')).toBeTruthy());
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('application/pdf');
  });
});

describe('预览区里的文件链接（ArtifactPreviewPanel → Files typed preview owner）', () => {
  const MARKDOWN = '见 [设计文档](/home/xiewanpeng/atoll/DESIGN.md:20) 和 [外部](https://example.com/x)';
  it('绝对路径链接交给 provider，在 Atoll 里打开，恒不让浏览器去访问那条路径', async () => {
    const preview = vi.fn();
    render(<ArtifactPreviewPanel
      channel={{ id: 'c0' }}
      port={{
        selectedArtifact: { channelId: 'c0', name: 'notes.md', mediaType: 'text/markdown' },
        preview: { status: 'ready', text: MARKDOWN },
        commands: { preview },
      }}
      onClose={() => {}}
    />);
    const link = await screen.findByRole('link', { name: '设计文档' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'c0',
      resourceId: '/home/xiewanpeng/atoll/DESIGN.md',
      resource_id: '/home/xiewanpeng/atoll/DESIGN.md',
      name: 'DESIGN.md',
      mediaType: 'text/markdown',
      line: 20,
    }));
    expect(event.defaultPrevented).toBe(true);
  });

  it('外部链接照常是外部链接', async () => {
    const preview = vi.fn();
    render(<ArtifactPreviewPanel
      channel={{ id: 'c0' }}
      port={{
        selectedArtifact: { channelId: 'c0', name: 'notes.md', mediaType: 'text/markdown' },
        preview: { status: 'ready', text: MARKDOWN },
        commands: { preview },
      }}
      onClose={() => {}}
    />);
    const link = await screen.findByRole('link', { name: '外部' });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(preview).not.toHaveBeenCalled();
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
