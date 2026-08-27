// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactsView } from '../src/ui/ArtifactsView.jsx';

afterEach(cleanup);

const channel = { id: 'c0', qualified_name: 'c0' };
const daemons = [{ id: 'device-id', name: 'local-device' }];
const root = 'daemon://local-device/c0/';

describe('channel file browser', () => {
  it('selects a directory without previewing it and navigates only on open', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onResource = vi.fn(async (payload) => {
      if (payload.op !== 'list') return { status: 'ok' };
      if (payload.query.prefix === root) return { items: [{ id: `${root}docs`, meta: { node_type: 'directory' } }] };
      return { items: [{ id: `${root}docs/readme.md`, meta: { node_type: 'regular', size: 12 } }] };
    });
    render(<ArtifactsView channel={channel} daemons={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={onPreview} />);
    const folder = await screen.findByRole('row', { name: /docs/ });
    await user.click(folder);
    expect(onPreview).not.toHaveBeenCalled();
    await user.dblClick(folder);
    expect(await screen.findByRole('row', { name: /readme.md/ })).toBeTruthy();
    expect(onResource).toHaveBeenCalledWith(expect.objectContaining({
      op: 'list', query: expect.objectContaining({ prefix: `${root}docs/`, limit: 100 }),
    }));
  });

  it('creates a directory through resource create and then refreshes', async () => {
    const user = userEvent.setup();
    const onResource = vi.fn(async (payload) => payload.op === 'list' ? { items: [] } : { status: 'ok' });
    render(<ArtifactsView channel={channel} daemons={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
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
    render(<ArtifactsView channel={channel} daemons={daemons} onResource={onResource} onAttach={vi.fn()} onPreview={vi.fn()} />);
    await screen.findByRole('row', { name: /first.txt/ });
    await user.click(screen.getByRole('button', { name: '载入更多' }));
    expect(await screen.findByRole('row', { name: /second.txt/ })).toBeTruthy();
    expect(onResource).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ cursor: 'cursor-1' }) }));
  });
});
