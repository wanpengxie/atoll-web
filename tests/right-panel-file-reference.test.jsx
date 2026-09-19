// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactPreviewPanel } from '../src/ui/features/files/ArtifactPreviewPanel.jsx';
import { FilesFeature } from '../src/ui/features/files/FilesFeature.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// src/app/RightPanelHost.jsx was deleted. Its artifact-preview mode is now
// src/ui/features/files/ArtifactPreviewPanel.jsx, rendered by
// WorkspaceRightPanel with no wrapper around it (grepped: WorkspaceApp never
// imports MarkdownFileReferenceProvider). Its reading-history mode moved
// inside FilesFeature (`port.recent`, wired from attachments.recentFiles in
// WorkspaceApp.jsx:738).
const MARKDOWN = '见 [设计文档](/home/xiewanpeng/atoll/DESIGN.md:20) 和 [外部](https://example.com/x)';

describe('右侧文件详情面板里的文件链接', () => {
  it.fails('【缺陷】绝对路径链接应在 Atoll 里打开、恒不让浏览器去访问那条路径 —— ArtifactPreviewPanel 没有被 MarkdownFileReferenceProvider 包裹，历史 bug 复现', async () => {
    // This renders exactly what WorkspaceRightPanel renders for the
    // WORKSPACE_FEATURE_PANEL.artifact branch: <ArtifactPreviewPanel
    // port={files} onClose={onClose} /> with no provider around it, because
    // that is genuinely what production does.
    render(<ArtifactPreviewPanel
      port={{ selectedArtifact: { name: 'notes.md', mediaType: 'text/markdown', resourceId: 'r1' }, preview: { status: 'ready', text: MARKDOWN } }}
      onClose={() => {}}
    />);
    const link = await screen.findByRole('link', { name: '设计文档' });
    // Desired (old, still-correct) behaviour: an absolute-path reference is
    // intercepted and never left as a plain new-tab external link.
    expect(link.getAttribute('target')).not.toBe('_blank');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('保留外链的新标签页语义，不把普通网页链接拦成文件引用', async () => {
    render(<ArtifactPreviewPanel
      port={{ selectedArtifact: { name: 'notes.md', mediaType: 'text/markdown', resourceId: 'r1' }, preview: { status: 'ready', text: MARKDOWN } }}
      onClose={() => {}}
    />);
    const external = await screen.findByRole('link', { name: '外部' });
    expect(external.getAttribute('target')).toBe('_blank');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    external.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('嵌套文件里"关闭"复用"返回上一个文件"的语义，不在有上一层时整段退出', async () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    render(<ArtifactPreviewPanel
      port={{
        selectedArtifact: { name: 'b.md', mediaType: 'text/markdown', resourceId: 'r2' },
        preview: { status: 'ready', text: '正文' },
        canGoBack: true,
        commands: { back: onBack },
      }}
      onClose={onClose}
    />);
    fireEvent.click(await screen.findByRole('button', { name: '返回上一个文件' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭文件详情' }));
    // While a previous file is still on the stack, the panel's own close
    // button performs the same "go back" as the explicit arrow button — it
    // must never call the raw onClose prop (that would drop the whole stack).
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('没有上一层时，关闭按钮走真正的 onClose', async () => {
    const onClose = vi.fn();
    render(<ArtifactPreviewPanel
      port={{ selectedArtifact: { name: 'a.md', mediaType: 'text/markdown', resourceId: 'r1' }, preview: { status: 'ready', text: '正文' } }}
      onClose={onClose}
    />);
    fireEvent.click(await screen.findByRole('button', { name: '关闭文件详情' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('最近阅读列表可以直接重新打开文件', async () => {
    const onPreview = vi.fn();
    const recent = { channelId: 'c0', resourceId: '/tmp/a.md', name: 'a.md', lastOpenedAt: 1 };
    render(<FilesFeature
      channel={{ id: 'c0' }}
      port={{ deviceId: 'local-device', devices: [{ id: 'local-device' }], entries: [], recent: [recent], commands: { preview: onPreview } }}
    />);
    fireEvent.click(screen.getByRole('button', { name: /a\.md/ }));
    expect(onPreview).toHaveBeenCalledWith(recent);
  });
});
