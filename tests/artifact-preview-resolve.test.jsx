// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTextMediaType, previewForMediaType } from '../src/model/artifacts.js';
import { mediaTypeFromFileName } from '../src/model/channel-file-transfer.js';
import { ArtifactContext, ArtifactPreviewBody, looksLikeText, resolveArtifact } from '../src/ui/context/ArtifactContext.jsx';
import { MarkdownFileReferenceProvider } from '../src/ui/MarkdownContent.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('文件类型判定', () => {
  it('octet-stream 不算声明，按扩展名兜底；无扩展名的常见文本文件也认', () => {
    expect(mediaTypeFromFileName('报告.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(mediaTypeFromFileName('报告.pdf', 'application/pdf')).toBe('application/pdf');
    expect(mediaTypeFromFileName('Makefile')).toBe('text/plain');
    expect(mediaTypeFromFileName('.gitignore')).toBe('text/plain');
    expect(mediaTypeFromFileName('config.toml')).toBe('text/plain');
    expect(mediaTypeFromFileName('blob.xyz', 'application/octet-stream')).toBe('application/octet-stream');
  });

  it('结构化文本的 application/* 走文本预览', () => {
    expect(isTextMediaType('application/xml')).toBe(true);
    expect(isTextMediaType('application/vnd.api+json')).toBe(true);
    expect(isTextMediaType('image/png')).toBe(false);
    expect(previewForMediaType('application/x-yaml')).toBe('text');
    expect(previewForMediaType('application/pdf')).toBe('inline');
  });

  it('resolveArtifact 把误判成 unsupported 的 PDF 纠正为 inline，认得的不动', () => {
    const fixed = resolveArtifact({ name: 'r.pdf', mediaType: 'application/octet-stream', preview: 'unsupported', kind: 'file' });
    expect(fixed).toMatchObject({ mediaType: 'application/pdf', preview: 'inline', kind: 'document' });
    const same = { name: 'a.png', mediaType: 'image/png', preview: 'image', kind: 'image' };
    expect(resolveArtifact(same)).toBe(same);
  });

  it('looksLikeText：UTF-8 文本认，带 NUL 或非法字节不认', () => {
    expect(looksLikeText(new TextEncoder().encode('第一行\n第二行'))).toBe('第一行\n第二行');
    expect(looksLikeText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))).toBeNull();
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
    expect(looksLikeText(new Uint8Array([]))).toBe('');
  });
});

function fetchBytes(bytes) {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    headers: { get: (name) => (name === 'content-length' ? String(bytes.byteLength) : null) },
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    text: () => Promise.resolve(new TextDecoder().decode(bytes)),
  });
}

describe('预览面板', () => {
  it('类型认不出的文件嗅探为文本后按源码预览，并给复制按钮', async () => {
    const bytes = new TextEncoder().encode('key = value\nname = "atoll"\n');
    vi.stubGlobal('fetch', fetchBytes(bytes));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ArtifactContext artifact={{ name: 'settings.unknownext', mediaType: 'application/octet-stream', preview: 'unsupported', resourceId: 'r1', channelId: 'c0', size: bytes.byteLength }} onResource={() => Promise.resolve({ ticket: 't' })} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('.artifact-source-preview')).toBeTruthy());
    expect(document.querySelector('.artifact-source-preview').textContent).toContain('name = "atoll"');
    const copy = screen.getByRole('button', { name: '复制' });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('key = value\nname = "atoll"\n');
    await waitFor(() => expect(copy.textContent).toBe('已复制'));
  });

  it('嗅探出二进制则维持"不支持预览"，没有复制按钮', async () => {
    vi.stubGlobal('fetch', fetchBytes(new Uint8Array([0x00, 0x01, 0x02, 0x03])));
    const onDownload = vi.fn();
    render(<ArtifactContext artifact={{ name: 'blob.bin', mediaType: 'application/octet-stream', preview: 'unsupported', resourceId: 'r2', channelId: 'c0', size: 4 }} onResource={() => Promise.resolve({ ticket: 't' })} onDownload={onDownload} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('此文件暂不支持站内预览')).toBeTruthy());
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下载 blob.bin' }));
    expect(onDownload).toHaveBeenCalledWith({ resource_id: 'r2', name: 'blob.bin', media_type: 'application/octet-stream', size: 4 });
  });

  it('PDF 用 object 内嵌并带回退文案；没带类型的 .pdf 也能进这条路', () => {
    render(<ArtifactPreviewBody artifact={{ name: '报告.pdf', mediaType: 'application/octet-stream', preview: 'unsupported' }} preview={{ phase: 'ready', url: 'blob:x' }} />);
    const object = document.querySelector('object.artifact-pdf');
    expect(object.getAttribute('type')).toBe('application/pdf');
    expect(object.getAttribute('data')).toBe('blob:x');
    expect(object.textContent).toContain('不能内嵌显示 PDF');
  });
});

describe('blob 类型', () => {
  it('节点回 octet-stream 时按判定类型重打 blob，服务端说了具体类型就尊重', async () => {
    const { typedBlob } = await import('../src/ui/context/ArtifactContext.jsx');
    const raw = new Blob(['%PDF-1.4'], { type: 'application/octet-stream' });
    expect(typedBlob(raw, 'application/pdf').type).toBe('application/pdf');
    expect(typedBlob(new Blob(['x']), 'image/png').type).toBe('image/png');
    const declared = new Blob(['x'], { type: 'image/jpeg' });
    expect(typedBlob(declared, 'image/png')).toBe(declared);
    expect(typedBlob(raw, 'application/octet-stream')).toBe(raw);
  });

  it('PDF 预览用重打过类型的 blob 建 object URL', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      blob: () => Promise.resolve(new Blob([bytes], { type: 'application/octet-stream' })),
    }));
    const created = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: (blob) => { created.push(blob); return 'blob:pdf'; }, revokeObjectURL: () => {} }));
    render(<ArtifactContext artifact={{ name: '报告.pdf', mediaType: 'application/octet-stream', preview: 'unsupported', resourceId: 'r3', channelId: 'c0', size: bytes.byteLength }} onResource={() => Promise.resolve({ ticket: 't' })} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('object.artifact-pdf')).toBeTruthy());
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('application/pdf');
  });
});

// 预览区里的链接曾经点不开:消息区被 MarkdownFileReferenceProvider 包着,右侧面板
// 没有,于是同一段 Markdown 在这边退回成普通 <a target="_blank">——点下去浏览器拿
// 当前站点去访问 /home/... 这条路径,跳到一个本站根本不提供的地址。
describe('预览区里的文件链接', () => {
  it('绝对路径链接交给 provider,在 Atoll 里打开,恒不让浏览器去访问那条路径', async () => {
    const onOpen = vi.fn();
    render(<MarkdownFileReferenceProvider onOpen={onOpen}>
      <ArtifactPreviewBody
        artifact={{ name: 'notes.md', mediaType: 'text/markdown', preview: 'text' }}
        preview={{ phase: 'ready', text: '见 [设计文档](/home/xiewanpeng/atoll/DESIGN.md:20)' }}
        textMode="preview"
        onTextModeChange={() => {}}
      />
    </MarkdownFileReferenceProvider>);
    const link = await screen.findByRole('link', { name: '设计文档' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(onOpen).toHaveBeenCalledWith({ path: '/home/xiewanpeng/atoll/DESIGN.md', line: 20 });
    expect(event.defaultPrevented).toBe(true);
  });

  it('外部链接照常是外部链接', async () => {
    const onOpen = vi.fn();
    render(<MarkdownFileReferenceProvider onOpen={onOpen}>
      <ArtifactPreviewBody
        artifact={{ name: 'notes.md', mediaType: 'text/markdown', preview: 'text' }}
        preview={{ phase: 'ready', text: '见 [外部](https://example.com/x)' }}
        textMode="preview"
        onTextModeChange={() => {}}
      />
    </MarkdownFileReferenceProvider>);
    const link = await screen.findByRole('link', { name: '外部' });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
