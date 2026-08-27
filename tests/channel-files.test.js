import { describe, expect, it } from 'vitest';
import { channelMountRoot, directoryEntries, fileListCommand, normalizeDirectory, parentDirectory } from '../src/model/channel-files.js';

describe('channel mounted files', () => {
  it('builds the real Atoll file-list prefix for the active channel mount', () => {
    expect(channelMountRoot({ daemonName: 'local-device', qualifiedChannel: 'c0.project' })).toBe('daemon://local-device/c0.project/');
    expect(fileListCommand({ channelId: 'project-id', daemonName: 'local-device', qualifiedChannel: 'c0.project', directory: 'docs/design/' })).toEqual({
      channel_id: 'project-id', op: 'list', query: { prefix: 'daemon://local-device/c0.project/docs/design/', limit: 100 },
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
