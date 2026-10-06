// @vitest-environment jsdom
// Object-storage addresses (oss://<storage channel>/<host channel>/<path>) in
// messages: parsed, kept as links, opened in Atoll's preview, and read from
// the signed URL the storage seat gives — never through the node's /files.
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownContent, MarkdownFileReferenceProvider } from '../src/ui/MarkdownContent.jsx';
import { attachmentFromFileReference } from '../src/model/file-references.js';
import { parseStorageAddress, storageUrlTransform } from '../src/model/storage-address.js';
import { identifyStorageSeat, isStorageSeatRow, storageTicket } from '../src/model/storage-seat.js';
import { isControlOnlyBody } from '../src/model/conversation-visibility.js';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';
import { SYSTEM_ACTOR_ID, TYPES } from '../src/protocol/vocab.js';
import { mountAttachmentTransactions } from './helpers/attachment-transactions-harness.js';
import { ArtifactPreviewPanel } from '../src/ui/features/files/ArtifactPreviewPanel.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('parseStorageAddress', () => {
  it('splits an address into storage channel, host channel and path', () => {
    expect(parseStorageAddress('oss://c0.storage/c0.dev/reports/q3.pdf')).toEqual({
      address: 'oss://c0.storage/c0.dev/reports/q3.pdf',
      storageChannel: 'c0.storage',
      hostChannel: 'c0.dev',
      path: 'reports/q3.pdf',
      name: 'q3.pdf',
    });
  });

  it('decodes each segment as Markdown hands it over, never turning %2F into a separator', () => {
    expect(parseStorageAddress('oss://c0.storage/c0.dev/%E6%8A%A5%E5%91%8A/q3%20final.md')).toMatchObject({
      address: 'oss://c0.storage/c0.dev/报告/q3 final.md', path: '报告/q3 final.md', name: 'q3 final.md',
    });
    expect(parseStorageAddress('oss://c0.storage/c0.dev/a%2Fb.txt')).toBeNull();
  });

  it('refuses what is not one stored file', () => {
    for (const value of [
      'https://example.com/a.pdf', 'oss://c0.storage', 'oss://c0.storage/c0.dev', 'oss://c0.storage/c0.dev/',
      'oss://c0.storage/c0.dev/reports/', 'oss://c0.storage/c0.dev/../x', 'oss://c0.storage/c0.dev/a/./b',
      'oss://c0.storage/c0.dev/a//b', 'oss://c0.storage/c0.dev/a?x=1', 'oss://c0.storage/c0.dev/%E0%A4%A',
      `oss://c0.storage/c0.dev/${'a'.repeat(1025)}`,
    ]) expect(parseStorageAddress(value), value).toBeNull();
  });
});

describe('Markdown keeps oss:// links and still filters dangerous ones', () => {
  it('urlTransform lets an oss href through and nothing else new', () => {
    expect(storageUrlTransform('oss://c0.storage/c0.dev/a.png', 'href')).toBe('oss://c0.storage/c0.dev/a.png');
    expect(storageUrlTransform('oss://c0.storage/c0.dev/a.png', 'src')).toBe('');
    expect(storageUrlTransform('javascript:alert(1)', 'href')).toBe('');
    expect(storageUrlTransform('https://example.com', 'href')).toBe('https://example.com');
  });

  it('a message with oss links still renders javascript: as an empty href', () => {
    const { container } = render(<MarkdownContent text={'[存储](oss://c0.storage/c0.dev/a.pdf) [危险](javascript:alert%281%29)'} />);
    const [stored, danger] = container.querySelectorAll('a');
    expect(stored.getAttribute('href')).toBe('oss://c0.storage/c0.dev/a.pdf');
    expect(danger.getAttribute('href')).toBe('');
  });

  it('clicking an oss link opens it in Atoll instead of navigating', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<MarkdownFileReferenceProvider onOpen={onOpen}><MarkdownContent text={'见 [Q3 报告](oss://c0.storage/c0.dev/reports/q3.pdf)'} /></MarkdownFileReferenceProvider>);
    const link = screen.getByRole('link', { name: 'Q3 报告' });
    expect(link.getAttribute('target')).toBeNull();
    expect(link.classList.contains('markdown-file-reference')).toBe(true);
    await user.click(link);
    expect(onOpen).toHaveBeenCalledWith({
      resource_id: 'oss://c0.storage/c0.dev/reports/q3.pdf', address: 'oss://c0.storage/c0.dev/reports/q3.pdf', name: 'q3.pdf',
    });
  });

  it('a bare address in text becomes a link; code and trailing punctuation do not', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = render(<MarkdownFileReferenceProvider onOpen={onOpen}><MarkdownContent
      text={'已保存到 oss://c0.storage/c0.dev/notes/q3.txt。另见 `oss://c0.storage/c0.dev/code.txt`'}
    /></MarkdownFileReferenceProvider>);
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('oss://c0.storage/c0.dev/notes/q3.txt');
    expect(container.querySelector('code').textContent).toBe('oss://c0.storage/c0.dev/code.txt');
    await user.click(links[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ resource_id: 'oss://c0.storage/c0.dev/notes/q3.txt' }));
  });

  it('the preview panel turns an oss reference into an attachment named by its address', () => {
    expect(attachmentFromFileReference({ address: 'oss://c0.storage/c0.dev/a/b.png', name: 'b.png' })).toEqual({
      resource_id: 'oss://c0.storage/c0.dev/a/b.png', name: 'b.png', media_type: 'image/png', file_reference: true,
    });
  });
});

function Harness({ row, onPreviewResource }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0.dev', narration: [] },
    names: new Map(), selfId: 'me',
    presentationEditing: null, browsingExpandedSlots: new Set(), effectiveFoldOverrides: new Map(),
    approvalStates: {}, onPreviewResource,
  });
  return renderRow(row);
}

describe('resource_link content blocks are attachments', () => {
  it('renders the reply text and each resource_link as an openable attachment', async () => {
    const user = userEvent.setup();
    const onPreviewResource = vi.fn();
    const request = { id: 'r1', type: 'agent.ask', sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], ts: 100, payload: { body: { text: '要报告' } } };
    const terminal = { id: 'r1:t', sender: { id: 'agent-1', kind: 'agent' }, ts: 200, payload: { body: {
      status: 'completed',
      content: [
        { type: 'text', text: '报告在这里' },
        { type: 'resource_link', uri: 'oss://c0.storage/c0.dev/reports/q3.pdf', name: 'q3.pdf', mimeType: 'application/pdf', size: 2048 },
      ],
    } } };
    const turn = { requestId: 'r1', request, terminal, terminalClosureOnly: false, provisional: [], thread: [], status: 'completed' };
    render(<Harness onPreviewResource={onPreviewResource} row={{ id: 'r1', contentRevision: 0, visualSlotID: 'r1', body: { kind: 'turn', turn, thread: [] } }} />);
    expect(screen.getByText('报告在这里')).toBeTruthy();
    const list = screen.getByRole('region', { name: '附件列表' });
    expect(list.textContent).toContain('q3.pdf');
    await user.click(screen.getByRole('button', { name: /q3\.pdf/ }));
    expect(onPreviewResource).toHaveBeenCalledWith('c0.dev', {
      resource_id: 'oss://c0.storage/c0.dev/reports/q3.pdf', name: 'q3.pdf', media_type: 'application/pdf', size: 2048,
    });
  });
});

describe('the storage word is never a conversation row', () => {
  it('storage.get_url is control-only like actor.describe', () => {
    expect(isControlOnlyBody(TYPES.storageGetURL, { path: 'a.pdf' })).toBe(true);
    expect(isControlOnlyBody(TYPES.describe, {})).toBe(true);
  });
});

describe('identifying the storage seat', () => {
  const seat = (id) => ({ id, kind: 'channel', body: 'class channel-seat', name: 'storage' });

  it('reads a seat from the roster by its body, never by its name', () => {
    expect(isStorageSeatRow(seat('channel:1'))).toBe(true);
    expect(isStorageSeatRow({ id: 'tool:1', kind: 'tool', body: 'class s3', name: 'storage' })).toBe(false);
  });

  it('with several seats offering storage words, matches the entry body against the directory id', async () => {
    const request = vi.fn(async (channelId, actorId, word, payload) => {
      if (word === TYPES.describe) return { words: { [TYPES.storageGetURL]: {} } };
      if (word === TYPES.member.get && actorId === SYSTEM_ACTOR_ID) {
        return { params: { body: payload.member === 'channel:b' ? 'ch-storage-id' : 'ch-archive-id' } };
      }
      throw new Error(`unexpected ${word}`);
    });
    await expect(identifyStorageSeat({
      channelId: 'c0.dev', storageChannel: 'c0.storage', seats: [seat('channel:a'), seat('channel:b')],
      directory: [{ id: 'ch-storage-id', qualified_name: 'c0.storage' }, { id: 'ch-archive-id', qualified_name: 'c0.archive' }],
      request,
    })).resolves.toBe('channel:b');
  });

  it('says plainly when the channel has no seat for that storage', async () => {
    await expect(identifyStorageSeat({ channelId: 'c0.dev', storageChannel: 'c0.storage', seats: [], request: vi.fn() }))
      .rejects.toMatchObject({ code: 'storage_seat_missing', message: '当前频道没有通往 c0.storage 的存储座位，读不到这个文件。' });
  });

  it('accepts only an http(s) URL from the reply', () => {
    expect(() => storageTicket({ url: 'javascript:alert(1)', expires_at: '2026-10-06T00:00:00Z' })).toThrow('存储服务没有返回可用的链接。');
    expect(storageTicket({ url: 'https://b.example/x', expires_at: '2026-10-06T00:00:00Z', size: 3, media_type: 'text/plain' }))
      .toEqual({ url: 'https://b.example/x', expiresAtMs: Date.parse('2026-10-06T00:00:00Z'), size: 3, mediaType: 'text/plain' });
  });
});

function textResponse(text) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => text };
}

describe('previewing a stored file reads the signed URL, not /files', () => {
  const storedEntry = (name, mediaType = '') => ({
    key: `resource:c0.dev:oss://c0.storage/c0.dev/${name}`,
    resourceId: `oss://c0.storage/c0.dev/${name}`,
    name,
    mediaType: mediaType || 'application/octet-stream',
    size: 0,
  });

  it('shows an image straight from the signed URL: no node read, no fetch, no size cap', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const resolveStorageURL = vi.fn(async () => ({ url: 'https://bucket.example/c0.dev/big.png?sig=1', expiresAtMs: Date.now() + 300_000, size: 200 * 1024 * 1024, mediaType: 'image/png' }));
    const { view, wireResource } = mountAttachmentTransactions({ activeChannel: { id: 'c0.dev', qualified_name: 'c0.dev' }, resolveStorageURL });
    await act(async () => { await view.result.current.previewArtifact({ ...storedEntry('big.png', 'image/png'), size: 200 * 1024 * 1024 }, 'c0.dev'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(view.result.current.artifactPreview).toMatchObject({ kind: 'image', url: 'https://bucket.example/c0.dev/big.png?sig=1' });
    expect(resolveStorageURL).toHaveBeenCalledWith('c0.dev', 'oss://c0.storage/c0.dev/big.png', { inline: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(wireResource).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'read' }));
  });

  it('reads text from the signed URL without credentials', async () => {
    const fetch = vi.fn(async () => textResponse('Q3 纪要'));
    vi.stubGlobal('fetch', fetch);
    const resolveStorageURL = vi.fn(async () => ({ url: 'https://bucket.example/c0.dev/notes.txt?sig=2', expiresAtMs: Date.now() + 300_000, size: 9, mediaType: 'text/plain' }));
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0.dev', qualified_name: 'c0.dev' }, resolveStorageURL });
    await act(async () => { await view.result.current.previewArtifact(storedEntry('notes.txt'), 'c0.dev'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('ready'));
    expect(view.result.current.artifactPreview).toMatchObject({ kind: 'text', text: 'Q3 纪要' });
    expect(fetch).toHaveBeenCalledWith('https://bucket.example/c0.dev/notes.txt?sig=2', expect.objectContaining({ credentials: 'omit' }));
    // Only the address is remembered; the signed URL never enters history.
    expect(view.result.current.recentFiles[0]).toMatchObject({ resourceId: 'oss://c0.storage/c0.dev/notes.txt' });
    expect(JSON.stringify(view.result.current.recentFiles)).not.toContain('sig=2');
  });

  it('shows the resolver\'s reason when the file belongs to another channel', async () => {
    const resolveStorageURL = vi.fn(async () => {
      throw Object.assign(new Error('这个文件属于频道 c0.cvmax，不在当前频道 c0.dev 里；请到 c0.cvmax 打开它。'), { code: 'storage_foreign_channel' });
    });
    const { view } = mountAttachmentTransactions({ activeChannel: { id: 'c0.dev', qualified_name: 'c0.dev' }, resolveStorageURL });
    await act(async () => { await view.result.current.previewArtifact({ ...storedEntry('x.pdf'), resourceId: 'oss://c0.storage/c0.cvmax/x.pdf' }, 'c0.dev'); });
    await waitFor(() => expect(view.result.current.artifactPreview.status).toBe('error'));
    expect(view.result.current.artifactPreview.error).toBe('这个文件属于频道 c0.cvmax，不在当前频道 c0.dev 里；请到 c0.cvmax 打开它。');
    // Downloading it would fail the same way, so the panel does not offer it.
    expect(view.result.current.artifactPreview.downloadable).toBe(false);
    const artifact = { name: 'x.pdf', resourceId: 'oss://c0.storage/c0.cvmax/x.pdf', channelId: 'c0.dev' };
    render(<ArtifactPreviewPanel channel={{ id: 'c0.dev' }} port={{ selectedArtifact: artifact, preview: view.result.current.artifactPreview, commands: { download: vi.fn() } }} onClose={() => {}} />);
    expect(screen.getByText('预览暂不可用')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '下载 x.pdf' })).toBeNull();
  });

  it('downloads from an attachment URL the storage signs', async () => {
    const resolveStorageURL = vi.fn(async () => ({ url: 'https://bucket.example/c0.dev/q3.pdf?disp=attachment', expiresAtMs: Date.now() + 300_000, mediaType: 'application/pdf' }));
    const clicked = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicked.push(this.href); });
    const { view, wireResource } = mountAttachmentTransactions({ activeChannel: { id: 'c0.dev', qualified_name: 'c0.dev' }, resolveStorageURL });
    await act(async () => { await view.result.current.downloadFile(storedEntry('q3.pdf')); });
    expect(resolveStorageURL).toHaveBeenCalledWith('c0.dev', 'oss://c0.storage/c0.dev/q3.pdf', { inline: false });
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(['https://bucket.example/c0.dev/q3.pdf?disp=attachment']);
    expect(wireResource).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'read' }));
  });
});
