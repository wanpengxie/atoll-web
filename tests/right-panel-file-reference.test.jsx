// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RightPanelHost } from '../src/app/RightPanelHost.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// 预览区里的链接曾经点不开:消息区被 MarkdownFileReferenceProvider 包着,右侧面板
// 没有。同一段 Markdown 在这边退回成普通 <a target="_blank">,点下去浏览器拿当前
// 站点去访问 /home/... 这条路径,跳到一个本站根本不提供的地址。
//
// 所以这条测试**从面板整体渲染**,而不是自己搭一个 provider 再测 MarkdownContent
// ——后者恒不会失败,因为它测的正好是没坏的那一半。
const MARKDOWN = '见 [设计文档](/home/xiewanpeng/atoll/DESIGN.md:20) 和 [外部](https://example.com/x)';

function panelProps(onFileReference) {
  return {
    panel: { value: 'artifact-focus', focus: { type: 'artifact', key: 'k' }, close: () => {} },
    active: { channel: { id: 'c0' }, state: {}, roster: [], access: 'member_active', selfId: 'me', wireState: 'open' },
    directory: { channels: [] },
    governance: {},
    roster: {},
    workItems: {},
    activity: {},
    artifacts: {
      selected: { key: 'k', channelId: 'c0', resourceId: '/tmp/notes.md', name: 'notes.md', mediaType: 'text/markdown', preview: 'text', kind: 'document', state: 'available' },
      onResource: vi.fn().mockResolvedValue({ ticket: 't' }),
      onDownload: () => {},
      onAttach: () => {},
      onSource: () => {},
      onFileReference,
    },
  };
}

describe('右侧预览面板里的文件链接', () => {
  it('绝对路径链接在 Atoll 里打开,恒不让浏览器去访问那条路径', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => String(MARKDOWN.length) },
      body: null,
      text: async () => MARKDOWN,
      arrayBuffer: async () => new TextEncoder().encode(MARKDOWN).buffer,
    }));
    const onFileReference = vi.fn();
    render(<RightPanelHost {...panelProps(onFileReference)} />);

    const link = await screen.findByRole('link', { name: '设计文档' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(onFileReference).toHaveBeenCalledWith({ path: '/home/xiewanpeng/atoll/DESIGN.md', line: 20 });
    expect(event.defaultPrevented).toBe(true);

    const external = screen.getByRole('link', { name: '外部' });
    external.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onFileReference).toHaveBeenCalledTimes(1);
    expect(external.getAttribute('target')).toBe('_blank');
  });
});
