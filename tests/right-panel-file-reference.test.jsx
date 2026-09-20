// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactPreviewPanel } from '../src/ui/features/files/ArtifactPreviewPanel.jsx';
import { FilesFeature } from '../src/ui/features/files/FilesFeature.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// src/app/RightPanelHost.jsx was deleted. Its artifact-preview mode is now
// src/ui/features/files/ArtifactPreviewPanel.jsx, rendered by WorkspaceRightPanel.
// The current composition root owns the only navigation command:
// files.commands.preview (WorkspaceApp.filesPort). The panel-level provider
// must pass parsed references into that public command, and must fail closed
// when the command or source channel is unavailable. The Reading context also
// consumes that same `port.recent` projection; it does not create a bookmark
// or history store of its own.
const MARKDOWN = '见 [设计文档](/home/xiewanpeng/atoll/DESIGN.md:20) 和 [外部](https://example.com/x)';

function rightPanelProps({ channelId = 'c0', selectedChannelId = channelId, previewCommand, commands } = {}) {
  const preview = previewCommand || vi.fn();
  return {
    panel: 'artifact',
    channel: { id: channelId },
    files: {
      selectedArtifact: { key: 'k', channelId: selectedChannelId, name: 'notes.md', mediaType: 'text/markdown', resourceId: 'r1' },
      preview: { status: 'ready', text: MARKDOWN },
      commands: commands === undefined ? { preview } : commands,
    },
    tasks: {},
    roster: {},
    governance: {},
    automation: {},
    activity: {},
    onClose: () => {},
  };
}

describe('右侧文件详情面板里的文件链接', () => {
  it('公开 preview owner 存在时，绝对路径链接通过当前频道 command 在 Atoll 内打开', async () => {
    const previewCommand = vi.fn();
    render(<WorkspaceRightPanel {...rightPanelProps({ previewCommand })} />);
    const link = await screen.findByRole('link', { name: '设计文档' });
    expect(link.getAttribute('target')).toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(previewCommand).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'c0',
      resourceId: '/home/xiewanpeng/atoll/DESIGN.md',
      resource_id: '/home/xiewanpeng/atoll/DESIGN.md',
      name: 'DESIGN.md',
      mediaType: 'text/markdown',
      line: 20,
    }));
    const external = screen.getByRole('link', { name: '外部' });
    const externalEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    external.dispatchEvent(externalEvent);
    expect(externalEvent.defaultPrevented).toBe(false);
    expect(external.getAttribute('target')).toBe('_blank');
  });

  it('缺少公开 preview command 时，文件引用阻止 host 导航但不伪造内部打开', async () => {
    render(<WorkspaceRightPanel {...rightPanelProps({ commands: {} })} />);
    const link = await screen.findByRole('link', { name: '设计文档' });
    expect(link.getAttribute('target')).toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('频道切换后，旧 artifact 不能借当前 command 打开到新频道', async () => {
    const previewCommand = vi.fn();
    const view = render(<WorkspaceRightPanel {...rightPanelProps({ previewCommand })} />);
    view.rerender(<WorkspaceRightPanel {...rightPanelProps({
      channelId: 'c1', selectedChannelId: 'c0', previewCommand,
    })} />);
    const link = await screen.findByRole('link', { name: '设计文档' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(previewCommand).not.toHaveBeenCalled();
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

  it('右侧最近阅读上下文复用现有 recent/preview port', () => {
    const onPreview = vi.fn();
    const onClose = vi.fn();
    const recent = { key: 'recent:c0:r1', channelId: 'c0', resourceId: '/tmp/a.md', name: 'a.md', lastOpenedAt: 1 };
    render(<WorkspaceRightPanel
      panel="reading-history"
      channel={{ id: 'c0' }}
      files={{ recent: [recent], commands: { preview: onPreview } }}
      onClose={onClose}
    />);
    const context = screen.getByRole('complementary', { name: '最近阅读' });
    expect(context.textContent).toContain('a.md');
    fireEvent.click(within(context).getByRole('button', { name: /a\.md/ }));
    expect(onPreview).toHaveBeenCalledWith(recent);
    fireEvent.click(within(context).getByRole('button', { name: '关闭最近阅读' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
