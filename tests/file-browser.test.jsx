// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactsView } from '../src/ui/ArtifactsView.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const channel = { id: 'c0', qualified_name: 'c0' };
const daemons = [{ id: 'local-device', name: 'local-device' }];
const root = 'daemon://local-device/c0/';

describe('channel file browser', () => {
  it('opens the configured storage device instead of the first daemon row', async () => {
    const configured = { id: 'project', qualified_name: 'c0.project', default_storage_device_id: 'remote-id' };
    const mounts = [{ id: 'first-id', name: 'first-device' }, { id: 'remote-id', name: 'mac-mbp' }];
    const onResource = vi.fn(async () => ({ items: [] }));
    render(<ArtifactsView channel={configured} devices={mounts} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    await screen.findByText('当前目录为空');
    expect(onResource).toHaveBeenCalledWith(expect.objectContaining({
      op: 'list', query: expect.objectContaining({ prefix: 'daemon://mac-mbp/c0.project/' }),
    }));
    expect(onResource).not.toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ prefix: 'daemon://first-device/c0.project/' }),
    }));
  });

  it('opens a directory with one row click without previewing it', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onResource = vi.fn(async (payload) => {
      if (payload.op !== 'list') return { status: 'ok' };
      if (payload.query.prefix === root) return { items: [{ id: `${root}docs`, meta: { node_type: 'directory' } }] };
      return { items: [{ id: `${root}docs/readme.md`, meta: { node_type: 'regular', size: 12 } }] };
    });
    render(<ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={onPreview} />);
    const folder = await screen.findByRole('row', { name: /docs/ });
    await user.click(folder);
    expect(onPreview).not.toHaveBeenCalled();
    expect(await screen.findByRole('row', { name: /readme.md/ })).toBeTruthy();
    expect(onResource).toHaveBeenCalledWith(expect.objectContaining({
      op: 'list', query: expect.objectContaining({ prefix: `${root}docs/`, limit: 100 }),
    }));
  });

  it('previews a file from the row and reserves the trailing action for download', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onResource = vi.fn(async (payload) => payload.op === 'list'
      ? { items: [{ id: `${root}readme.md`, meta: { node_type: 'regular', size: 12 } }] }
      : { ticket: 'download-ticket' });
    const createObjectURL = vi.fn(() => 'blob:download');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['hello'])) })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={onPreview} />);
    const row = await screen.findByRole('row', { name: /readme.md/ });

    await user.click(row.querySelector('.finder-name-cell'));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ name: 'readme.md', resourceId: `${root}readme.md`, preview: 'text' }));
    expect(fetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledOnce();
  });

  it('creates a directory through resource create and then refreshes', async () => {
    const user = userEvent.setup();
    const onResource = vi.fn(async (payload) => payload.op === 'list' ? { items: [] } : { status: 'ok' });
    render(<ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    await screen.findByText('当前目录为空');
    await user.click(screen.getByRole('button', { name: /新建文件夹/ }));
    await user.type(screen.getByLabelText('新文件夹名称'), '研究资料');
    await user.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(onResource).toHaveBeenCalledWith({
      channel_id: 'c0', op: 'create', address: `${root}${encodeURIComponent('研究资料')}`, node_type: 'directory',
    }));
    expect(onResource.mock.calls.filter(([payload]) => payload.op === 'list').length).toBeGreaterThanOrEqual(2);
  });

  it('loads the next backend cursor and merges the page', async () => {
    const user = userEvent.setup();
    const onResource = vi.fn(async (payload) => payload.query?.cursor
      ? { items: [{ id: `${root}second.txt`, meta: { node_type: 'regular' } }] }
      : { items: [{ id: `${root}first.txt`, meta: { node_type: 'regular' } }], next: 'cursor-1' });
    render(<ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    await screen.findByRole('row', { name: /first.txt/ });
    await user.click(screen.getByRole('button', { name: '载入更多' }));
    expect(await screen.findByRole('row', { name: /second.txt/ })).toBeTruthy();
    expect(onResource).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ cursor: 'cursor-1' }) }));
  });

  it('creates inside a non-ASCII directory without double-encoding its parent', async () => {
    const user = userEvent.setup();
    const encodedParent = encodeURIComponent('研究资料');
    const onResource = vi.fn(async (payload) => {
      if (payload.op !== 'list') return { status: 'ok' };
      if (payload.query.prefix === root) return { items: [{ id: `${root}${encodedParent}`, meta: { node_type: 'directory' } }] };
      return { items: [] };
    });
    render(<ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    await user.click(await screen.findByRole('row', { name: /研究资料/ }));
    await screen.findByText('当前目录为空');
    await user.click(screen.getByRole('button', { name: /新建文件夹/ }));
    await user.type(screen.getByLabelText('新文件夹名称'), '设计');
    await user.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(onResource).toHaveBeenCalledWith({
      channel_id: 'c0', op: 'create',
      address: `${root}${encodedParent}/${encodeURIComponent('设计')}`,
      node_type: 'directory',
    }));
  });

  it('does not let a completed mutation refresh overwrite a newer directory', async () => {
    const user = userEvent.setup();
    let releaseDelete;
    const deleting = new Promise((resolve) => { releaseDelete = resolve; });
    const onResource = vi.fn(async (payload) => {
      if (payload.op === 'delete') { await deleting; return { status: 'ok' }; }
      if (payload.query?.prefix === `${root}docs/`) return { items: [{ id: `${root}docs/inside.txt`, meta: { node_type: 'regular' } }] };
      return { items: [{ id: `${root}docs`, meta: { node_type: 'directory' } }] };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    await user.click(await screen.findByRole('row', { name: /docs/ }));
    const inside = await screen.findByRole('row', { name: /inside.txt/ });
    await user.click(inside.querySelector('button[title^="删除"]'));
    await user.click(screen.getByRole('button', { name: '返回上一级' }));
    await screen.findByRole('row', { name: /docs/ });
    releaseDelete();
    await deleting;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => expect(onResource.mock.calls.filter(([payload]) => payload.query?.prefix === `${root}docs/`)).toHaveLength(1));
    expect(screen.queryByRole('row', { name: /inside.txt/ })).toBeNull();
  });

  it('returns to the root when the active channel changes', async () => {
    const user = userEvent.setup();
    const onResource = vi.fn(async (payload) => {
      if (payload.query?.prefix === root) return { items: [{ id: `${root}docs`, meta: { node_type: 'directory' } }] };
      if (payload.query?.prefix === `${root}docs/`) return { items: [] };
      if (payload.query?.prefix === 'daemon://local-device/c1/') return { items: [{ id: 'daemon://local-device/c1/fresh.txt', meta: { node_type: 'regular' } }] };
      return { items: [] };
    });
    const view = <ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />;
    const { rerender } = render(view);
    await user.click(await screen.findByRole('row', { name: /docs/ }));
    await screen.findByText('当前目录为空');
    rerender(<ArtifactsView channel={{ id: 'c1', qualified_name: 'c1' }} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    expect(await screen.findByRole('row', { name: /fresh.txt/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'c1', exact: true }).getAttribute('aria-current')).toBe('page');
  });

  it('sorts loaded rows from the column headers', async () => {
    const user = userEvent.setup();
    const onResource = vi.fn(async () => ({ items: [
      { id: `${root}alpha.txt`, meta: { node_type: 'regular', size: 10 } },
      { id: `${root}zulu.txt`, meta: { node_type: 'regular', size: 2 } },
    ] }));
    render(<ArtifactsView channel={channel} devices={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    await screen.findByRole('row', { name: /alpha.txt/ });
    const rowNames = () => screen.getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rowNames()[0]).toContain('alpha.txt');
    await user.click(screen.getByRole('button', { name: '名称' }));
    expect(rowNames()[0]).toContain('zulu.txt');
    await user.click(screen.getByRole('button', { name: '大小' }));
    expect(rowNames()[0]).toContain('zulu.txt');
    expect(screen.getByRole('columnheader', { name: /大小/ }).getAttribute('aria-sort')).toBe('ascending');
  });
});
