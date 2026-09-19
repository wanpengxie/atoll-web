// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesFeature } from '../src/ui/features/files/FilesFeature.jsx';
import { useAttachmentTransactions } from '../src/app/hooks/useAttachmentTransactions.js';
import { deviceObservation } from './helpers/attachment-transactions-harness.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// src/ui/ArtifactsView.jsx was deleted. It owned both directory state and
// rendering in one component; the same behaviour now splits across
// useAttachmentTransactions (state/network) and FilesFeature (rendering),
// wired together the way WorkspaceApp.jsx:726-768 actually wires them. This
// harness copies that exact glue (including the entry->attachment shaping in
// `attach`) so clicking through FilesFeature drives the real hook, not a
// stand-in.
function Harness({ overrides = {}, resultRef, onClose }) {
  // Memoized on the overrides.activeChannel *reference*: stable across
  // ordinary re-renders (same test keeps the same overrides object), but
  // still recomputes when a test deliberately passes a new `overrides` (the
  // channel-switch test) — never a fresh literal every render.
  const channel = React.useMemo(
    () => (overrides.activeChannel === undefined ? { id: 'c0', qualified_name: 'c0' } : overrides.activeChannel),
    [overrides.activeChannel],
  );
  const activeChannelId = overrides.activeChannelId ?? channel?.id ?? '';
  // WorkspaceApp hands useAttachmentTransactions genuinely stable refs/
  // callbacks (real useRef hooks, useCallback-memoized functions). Building
  // fresh object/function literals here on every render breaks every
  // useCallback dependency array downstream and free-runs an infinite
  // render loop that has nothing to do with production behaviour — so every
  // default is lazily created exactly once via useRef, same as the app does.
  const accessStateRef = useRef(null);
  accessStateRef.current ??= { authorityEpoch: 1, relationship: 'member', existence: 'active', runtime: 'open', unavailable: false, ...overrides.access };
  const wireRefObject = useRef(null);
  wireRefObject.current ??= { resource: overrides.wireResource || vi.fn(async () => ({ items: [] })) };
  const obsRefObject = useRef(null);
  obsRefObject.current ??= { channelDevices: overrides.channelDevices || vi.fn().mockResolvedValue(deviceObservation(overrides.devices || [])) };
  const activeChannelRefObject = useRef(activeChannelId);
  activeChannelRefObject.current = activeChannelId;
  const accessRefObject = useRef(null);
  accessRefObject.current ??= { state: () => accessStateRef.current };
  const draftsRef = useRef(null);
  draftsRef.current ??= overrides.drafts || new Map();
  const fallbacksRef = useRef(null);
  fallbacksRef.current ??= {
    draftFor: overrides.draftFor || ((channelId) => draftsRef.current.get(channelId) || { attachments: [] }),
    updateDraft: overrides.updateDraft || ((channelId, next) => draftsRef.current.set(channelId, next)),
    onNotice: overrides.onNotice || (() => {}),
    onOpenDynamic: overrides.onOpenDynamic || (() => {}),
    persistDraftAttachments: overrides.persistDraftAttachments || (async () => undefined),
    generationFor: overrides.generationFor || (() => 1),
  };
  const attachments = useAttachmentTransactions({
    activeChannel: channel,
    activeChannelId,
    activeChannelRef: activeChannelRefObject,
    accessRef: accessRefObject,
    obsRef: obsRefObject,
    directoryVersion: 0,
    draftFor: fallbacksRef.current.draftFor,
    drafts: draftsRef.current,
    updateDraft: fallbacksRef.current.updateDraft,
    onNotice: fallbacksRef.current.onNotice,
    onOpenDynamic: fallbacksRef.current.onOpenDynamic,
    persistDraftAttachments: fallbacksRef.current.persistDraftAttachments,
    principalId: overrides.principalId || 'human:root:1',
    producerOwnerToken: overrides.producerOwnerToken || 'owner:1',
    generationFor: fallbacksRef.current.generationFor,
    serverWorld: overrides.serverWorld || 'world-1',
    wireRef: wireRefObject,
    wireState: overrides.wireState || 'open',
  });
  resultRef.current = { attachments, wireResource: wireRefObject.current.resource, accessState: accessStateRef.current, drafts: draftsRef.current };
  return <FilesFeature channel={channel} port={{
    devices: attachments.devices,
    deviceId: attachments.deviceId,
    directory: attachments.directory,
    entries: attachments.entries,
    selectedKey: attachments.selectedKey,
    busy: attachments.filesBusy,
    uploading: attachments.filesUploading,
    error: attachments.filesError,
    recent: attachments.recentFiles,
    next: attachments.filesNext,
    scrollTop: attachments.filesScrollTop,
    disabled: overrides.disabled === true,
    attachDisabled: overrides.attachDisabled === true,
    attachDisabledReason: overrides.attachDisabledReason || '',
    commands: {
      upload: async ({ files, directory, deviceId }) => {
        await attachments.uploadChannelFiles(files, { directory, deviceId });
        await attachments.refreshDirectory({ targetDirectory: directory, targetDeviceId: deviceId });
      },
      attach: (entry) => attachments.attach({
        resource_id: entry.resourceId, address: entry.resourceId, name: entry.name,
        media_type: entry.mediaType || 'application/octet-stream', size: Number(entry.size || 0),
      }),
      createDirectory: attachments.createDirectory,
      download: attachments.downloadFile,
      navigate: attachments.navigateFiles,
      loadMore: attachments.loadMoreDirectory,
      preview: (entry) => attachments.previewArtifact(entry, activeChannelId),
      refresh: () => attachments.refreshDirectory(),
      rememberScroll: attachments.rememberFilesScroll,
      remove: attachments.removeFile,
      select: attachments.setSelectedArtifact,
      selectDevice: attachments.selectDevice,
    },
  }} visible onClose={onClose} />;
}

function renderHarness(overrides = {}) {
  const resultRef = { current: null };
  const view = render(<Harness overrides={overrides} resultRef={resultRef} />);
  return { view, resultRef };
}

describe('channel file browser (FilesFeature + useAttachmentTransactions)', () => {
  it('opens the configured storage device instead of the first daemon row', async () => {
    const wireResource = vi.fn(async () => ({ items: [] }));
    renderHarness({
      activeChannel: { id: 'project', qualified_name: 'c0.project', default_storage_device_id: 'remote-id' },
      devices: [{ id: 'first-id', name: 'first-device' }, { id: 'remote-id', name: 'mac-mbp', defaultStorage: true }],
      wireResource,
    });
    await screen.findByText('当前目录为空');
    expect(wireResource).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ prefix: 'daemon://mac-mbp/c0.project/' }) }));
    expect(wireResource).not.toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ prefix: 'daemon://first-device/c0.project/' }) }));
  });

  it('opens a directory with one row click without previewing it', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async (payload) => {
      if (payload.op !== 'list') return { status: 'ok' };
      if (payload.query.prefix === root) return { items: [{ id: `${root}docs`, meta: { node_type: 'directory' } }] };
      return { items: [{ id: `${root}docs/readme.md`, meta: { node_type: 'regular', size: 12 } }] };
    });
    const { resultRef } = renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    const folder = await screen.findByRole('row', { name: /docs/ });
    await user.click(folder);
    expect(await screen.findByRole('row', { name: /readme.md/ })).toBeTruthy();
    // A row click always marks the row selected (FileRows calls
    // commands.select unconditionally); what the old test actually defended
    // is that a directory click never *opens a preview* the way a file
    // click does — no read/fetch ever starts.
    expect(resultRef.current.attachments.artifactPreview.status).toBe('idle');
    expect(wireResource).toHaveBeenCalledWith(expect.objectContaining({ op: 'list', query: expect.objectContaining({ prefix: `${root}docs/`, limit: 100 }) }));
  });

  it('previews a file from the row and reserves the trailing action for download', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async (payload) => (payload.op === 'list'
      ? { items: [{ id: `${root}readme.md`, meta: { node_type: 'regular', size: 12 } }] }
      : { ticket: 'download-ticket' }));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:download'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, headers: { get: () => null }, blob: () => Promise.resolve(new Blob(['hello'])), text: () => Promise.resolve('hello') })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { resultRef } = renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    const row = await screen.findByRole('row', { name: /readme.md/ });

    await user.click(row.querySelector('.finder-name-cell'));
    await waitFor(() => expect(resultRef.current.attachments.selectedArtifact).toMatchObject({ name: 'readme.md', resourceId: `${root}readme.md` }));
    // Clicking the row opens the preview itself now (previewArtifact fetches
    // eagerly instead of only notifying a parent); what the old test really
    // protects is that the download button is a *separate* operation that
    // never doubles as the preview action.
    await waitFor(() => expect(resultRef.current.attachments.artifactPreview.status).not.toBe('loading'));
    expect(click).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '下载' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    vi.restoreAllMocks();
  });

  it('reopens a recently viewed file without navigating back to its directory', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async () => ({ items: [] }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, headers: { get: () => null }, text: () => Promise.resolve('x') })));
    const { resultRef } = renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    await waitFor(() => expect(resultRef.current.attachments.deviceId).toBe('local-device'));
    // Seed a recent file the way a prior preview would have: preview it once
    // from a different directory, then navigate away.
    await act(async () => { await resultRef.current.attachments.previewArtifact({ key: 'r', channelId: 'c0', resourceId: `${root}deep/report.md`, name: 'report.md', mediaType: 'text/markdown' }, 'c0'); });
    await act(async () => { resultRef.current.attachments.navigateFiles(''); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'report.md' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'report.md' }));
    await waitFor(() => expect(resultRef.current.attachments.selectedArtifact).toMatchObject({ resourceId: `${root}deep/report.md` }));
    // Never re-derived the directory from the resourceId; still sitting at root.
    expect(resultRef.current.attachments.directory).toBe('');
  });

  it('creates a directory through resource create and then refreshes', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async (payload) => (payload.op === 'list' ? { items: [] } : { status: 'ok' }));
    renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    await screen.findByText('当前目录为空');
    await user.click(screen.getByRole('button', { name: /新建文件夹/ }));
    await user.type(screen.getByLabelText('新文件夹名称'), '研究资料');
    await user.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(wireResource).toHaveBeenCalledWith({
      channel_id: 'c0', op: 'create', address: `${root}${encodeURIComponent('研究资料')}`, node_type: 'directory',
    }));
    expect(wireResource.mock.calls.filter(([payload]) => payload.op === 'list').length).toBeGreaterThanOrEqual(2);
  });

  it('loads the next backend cursor and merges the page', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async (payload) => (payload.query?.cursor
      ? { items: [{ id: `${root}second.txt`, meta: { node_type: 'regular' } }] }
      : { items: [{ id: `${root}first.txt`, meta: { node_type: 'regular' } }], next: 'cursor-1' }));
    renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    await screen.findByRole('row', { name: /first.txt/ });
    await user.click(screen.getByRole('button', { name: '载入更多' }));
    expect(await screen.findByRole('row', { name: /second.txt/ })).toBeTruthy();
    expect(wireResource).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ cursor: 'cursor-1' }) }));
  });

  it('creates inside a non-ASCII directory without double-encoding its parent', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const encodedParent = encodeURIComponent('研究资料');
    const wireResource = vi.fn(async (payload) => {
      if (payload.op !== 'list') return { status: 'ok' };
      if (payload.query.prefix === root) return { items: [{ id: `${root}${encodedParent}`, meta: { node_type: 'directory' } }] };
      return { items: [] };
    });
    renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    await user.click(await screen.findByRole('row', { name: /研究资料/ }));
    await screen.findByText('当前目录为空');
    await user.click(screen.getByRole('button', { name: /新建文件夹/ }));
    await user.type(screen.getByLabelText('新文件夹名称'), '设计');
    await user.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(wireResource).toHaveBeenCalledWith({
      channel_id: 'c0', op: 'create', address: `${root}${encodedParent}/${encodeURIComponent('设计')}`, node_type: 'directory',
    }));
  });

  it('does not let a completed mutation refresh overwrite a newer directory', async () => {
    // The delete settles after the user returns to the root. The attachment
    // owner must not let the old directory's completion replace the newer
    // committed view or abort its refresh.
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    let releaseDelete;
    const deleting = new Promise((resolve) => { releaseDelete = resolve; });
    const wireResource = vi.fn(async (payload) => {
      if (payload.op === 'delete') { await deleting; return { status: 'ok' }; }
      if (payload.query?.prefix === `${root}docs/`) return { items: [{ id: `${root}docs/inside.txt`, meta: { node_type: 'regular' } }] };
      return { items: [{ id: `${root}docs`, meta: { node_type: 'directory' } }] };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    await user.click(await screen.findByRole('row', { name: /docs/ }));
    const inside = await screen.findByRole('row', { name: /inside.txt/ });
    await user.click(inside.querySelector('button[title^="删除"]'));
    await user.click(screen.getByRole('button', { name: '返回上一级' }));
    await screen.findByRole('row', { name: /docs/ });
    releaseDelete();
    await deleting;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => expect(screen.queryByRole('row', { name: /inside.txt/ })).toBeNull());
    expect(screen.getByRole('row', { name: /docs/ })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('returns to the root when the active channel changes', async () => {
    // Channel reset and directory refresh share one attachment owner. A
    // render committed for the new channel must not issue a request with the
    // old channel's directory/device closure.
    const user = userEvent.setup();
    const wireResource = vi.fn(async (payload) => {
      if (payload.query?.prefix === 'daemon://local-device/c0/') return { items: [{ id: 'daemon://local-device/c0/docs', meta: { node_type: 'directory' } }] };
      if (payload.query?.prefix === 'daemon://local-device/c0/docs/') return { items: [] };
      if (payload.query?.prefix === 'daemon://local-device/c1/') return { items: [{ id: 'daemon://local-device/c1/fresh.txt', meta: { node_type: 'regular' } }] };
      return { items: [] };
    });
    const resultRef = { current: null };
    const view = render(<Harness overrides={{ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource }} resultRef={resultRef} />);
    await user.click(await screen.findByRole('row', { name: /docs/ }));
    await screen.findByText('当前目录为空');
    view.rerender(<Harness overrides={{ activeChannel: { id: 'c1', qualified_name: 'c1' }, devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource }} resultRef={resultRef} />);
    expect(await screen.findByRole('row', { name: /fresh.txt/ })).toBeTruthy();
  });

  it('sorts loaded rows from the column headers', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async () => ({ items: [
      { id: `${root}alpha.txt`, meta: { node_type: 'regular', size: 10 } },
      { id: `${root}zulu.txt`, meta: { node_type: 'regular', size: 2 } },
    ] }));
    renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    await screen.findByRole('row', { name: /alpha.txt/ });
    const rowNames = () => screen.getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(rowNames()[0]).toContain('alpha.txt');
    await user.click(screen.getByRole('button', { name: '名称' }));
    expect(rowNames()[0]).toContain('zulu.txt');
    await user.click(screen.getByRole('button', { name: '大小' }));
    expect(rowNames()[0]).toContain('zulu.txt');
    expect(screen.getByRole('columnheader', { name: /大小/ }).getAttribute('aria-sort')).toBe('ascending');
  });

  it('keeps reads available while disabling every mutating row action', async () => {
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async () => ({ items: [{ id: `${root}read-only.txt`, meta: { node_type: 'regular', size: 1 } }] }));
    renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource, disabled: true, attachDisabled: true });
    await screen.findByRole('row', { name: /read-only.txt/ });
    expect(screen.getByRole('button', { name: '附加' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '删除' }).disabled).toBe(true);
    expect(wireResource).toHaveBeenCalledWith(expect.objectContaining({ op: 'list' }));
  });

  it('routes directory reads through the owned file-operation authority window', async () => {
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async (payload) => (payload.op === 'list'
      ? { items: [{ id: `${root}secret.txt`, meta: { node_type: 'regular' } }] }
      : { items: [] }));
    // A relationship that fails the read gate (member/observer only) proves
    // the list call is authorized through assessFileOperation() the same
    // way a write is, not sent as a bare unauthenticated resource() call —
    // the mount's own automatic directory listing never lands any entries.
    const { resultRef } = renderHarness({
      devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }],
      wireResource,
      access: { relationship: 'none' },
    });
    await waitFor(() => expect(resultRef.current.attachments.filesError).toContain('当前频道权限不允许这项文件操作'));
    expect(resultRef.current.attachments.entries).toEqual([]);
  });

  it('does not treat a delete as succeeded once the captured file owner goes stale mid-flight', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    let releaseDelete;
    const gate = new Promise((resolve) => { releaseDelete = resolve; });
    const wireResource = vi.fn(async (payload) => {
      if (payload.op === 'delete') { await gate; return { status: 'ok' }; }
      return { items: [{ id: `${root}owned.txt`, meta: { node_type: 'regular' } }] };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { resultRef } = renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource });
    const row = await screen.findByRole('row', { name: /owned.txt/ });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    user.click(row.querySelector('button[title^="删除"]'));
    await waitFor(() => expect(wireResource).toHaveBeenCalledWith(expect.objectContaining({ op: 'delete' })));
    // The delete request is already on the wire (a network send in flight
    // can't be un-sent); authority changes right after.
    resultRef.current.accessState.authorityEpoch = 2;
    releaseDelete();
    expect((await screen.findByRole('alert')).textContent).toContain('频道授权事实已变化');
    // Its settle recheck fails, so the client never treats it as a
    // successful delete: the row stays, selection/refresh never ran.
    expect(screen.getByRole('row', { name: /owned.txt/ })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('keeps a rejected durable attachment out of the composer projection', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async () => ({ items: [{ id: `${root}draft.txt`, meta: { node_type: 'regular' } }] }));
    const persistDraftAttachments = vi.fn(async () => { throw new Error('草稿所有权已变化'); });
    const { resultRef } = renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource, persistDraftAttachments });
    await screen.findByRole('row', { name: /draft.txt/ });
    await user.click(screen.getByRole('button', { name: '附加' }));
    // The rejection is real, the owner publishes it, and the attachment never lands.
    await waitFor(() => expect(persistDraftAttachments).toHaveBeenCalledOnce());
    expect(resultRef.current.attachments.composerAttachments).toEqual([]);
  });

  it('surfaces an attach rejection as a visible file error', async () => {
    const user = userEvent.setup();
    const root = 'daemon://local-device/c0/';
    const wireResource = vi.fn(async () => ({ items: [{ id: `${root}draft.txt`, meta: { node_type: 'regular' } }] }));
    const persistDraftAttachments = vi.fn(async () => { throw new Error('草稿所有权已变化'); });
    renderHarness({ devices: [{ id: 'local-device', name: 'local-device', defaultStorage: true }], wireResource, persistDraftAttachments });
    await screen.findByRole('row', { name: /draft.txt/ });
    await user.click(screen.getByRole('button', { name: '附加' }));
    expect((await screen.findByRole('alert')).textContent).toContain('草稿所有权已变化');
  });
});
