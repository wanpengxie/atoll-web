import { describe, expect, it } from 'vitest';
import { availableDefaultStorageDeviceId, channelDefaultStorageDeviceId, channelMountRoot, directoryEntries, fileListCommand, normalizeDirectory, parentDirectory } from '../src/model/channel-files.js';

describe('channel mounted files', () => {
  it('defaults legacy channels to local-device and never guesses from daemon ordering', () => {
    expect(channelDefaultStorageDeviceId({ id: 'c0' })).toBe('local-device');
    expect(availableDefaultStorageDeviceId({ id: 'c0' }, [
      { id: 'remote-id', name: 'mac-mbp' },
      { id: 'local-device', name: 'local-device' },
    ])).toBe('local-device');
    expect(availableDefaultStorageDeviceId({ id: 'c0', default_storage_device_id: 'missing' }, [
      { id: 'remote-id', name: 'mac-mbp' },
    ])).toBe('');
    expect(channelDefaultStorageDeviceId({ id: 'c0', default_storage_device_id: 'stale' }, [
      { id: 'remote-id', name: 'mac-mbp', defaultStorage: true },
    ])).toBe('remote-id');
  });

  it('builds the real Atoll file-list prefix for the active channel mount', () => {
    expect(channelMountRoot({ deviceId: 'device-7f3a', channelId: 'project-id' })).toBe('daemon://device-7f3a/project-id/');
    expect(fileListCommand({ channelId: 'project-id', deviceId: 'device-7f3a', directory: 'docs/design/' })).toEqual({
      channel_id: 'project-id', op: 'list', query: { prefix: 'daemon://device-7f3a/project-id/docs/design/', limit: 100 },
    });
  });

  it('uses physical node_type and never invents folders from path slashes', () => {
    const prefix = 'daemon://local-device/c0/';
    expect(directoryEntries([
      { id: `${prefix}docs`, kind: 'file', ops: ['read'], meta: { node_type: 'directory' } },
      { id: `${prefix}docs/a.txt`, kind: 'file', ops: ['read'], meta: { node_type: 'regular' } },
      { id: `${prefix}readme.md`, kind: 'file', ops: ['read'], meta: { node_type: 'regular' } },
      { id: 'kv:ignore', kind: 'kv' },
    ], prefix)).toEqual([
      { key: `dir:${prefix}docs`, kind: 'directory', nodeType: 'directory', name: 'docs', directory: 'docs/', resourceId: `${prefix}docs`, ops: ['read'] },
      { key: `${'file:'}${prefix}readme.md`, kind: 'file', nodeType: 'regular', name: 'readme.md', resourceId: `${prefix}readme.md`, ops: ['read'] },
    ]);
  });

  it('keeps directory state logical and encodes every path segment once at the wire edge', () => {
    const prefix = 'daemon://local-device/c0/';
    const [entry] = directoryEntries([
      { id: `${prefix}${encodeURIComponent('研究资料')}`, meta: { node_type: 'directory' } },
    ], prefix);
    expect(entry).toMatchObject({ name: '研究资料', directory: '研究资料/' });
    expect(fileListCommand({
      channelId: 'c0', deviceId: 'local-device', directory: `${entry.directory}设计/`,
    }).query.prefix).toBe(`${prefix}${encodeURIComponent('研究资料')}/${encodeURIComponent('设计')}/`);
  });

  it('normalizes breadcrumbs without allowing traversal', () => {
    expect(normalizeDirectory('/docs/design')).toBe('docs/design/');
    expect(parentDirectory('docs/design/')).toBe('docs/');
    expect(() => normalizeDirectory('docs/../secret')).toThrow();
  });

  it('keeps backend file metadata for Finder columns without inventing values', () => {
    const prefix = 'daemon://local-device/c0/';
    expect(directoryEntries([{ id: `${prefix}report.pdf`, meta: { size: 2048, media_type: 'application/pdf', modified_at: '2026-08-20T00:00:00Z' } }], prefix)[0]).toMatchObject({
      name: 'report.pdf', size: 2048, mediaType: 'application/pdf', modifiedAt: '2026-08-20T00:00:00Z',
    });
  });
});
