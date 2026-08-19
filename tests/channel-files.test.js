import { describe, expect, it } from 'vitest';
import { channelMountRoot, directoryEntries, fileListCommand, normalizeDirectory, parentDirectory } from '../src/model/channel-files.js';

describe('channel mounted files', () => {
  it('builds the real Atoll file-list prefix for the active channel mount', () => {
    expect(channelMountRoot({ daemonId: 'local-device', qualifiedChannel: 'c0.project' })).toBe('daemon://local-device/c0.project/');
    expect(fileListCommand({ channelId: 'project-id', daemonId: 'local-device', qualifiedChannel: 'c0.project', directory: 'docs/design/' })).toEqual({
      channel_id: 'project-id', op: 'list', query: { prefix: 'daemon://local-device/c0.project/docs/design/' },
    });
  });

  it('projects recursive backend rows into immediate folders and files', () => {
    const prefix = 'daemon://local-device/c0/';
    expect(directoryEntries([
      { id: `${prefix}docs/a.txt`, kind: 'file', ops: ['read'] },
      { id: `${prefix}docs/nested/b.txt`, kind: 'file', ops: ['read'] },
      { id: `${prefix}readme.md`, kind: 'file', ops: ['read'] },
      { id: 'kv:ignore', kind: 'kv' },
    ], prefix)).toEqual([
      { key: 'dir:docs', kind: 'directory', name: 'docs', directory: 'docs/' },
      { key: `${'file:'}${prefix}readme.md`, kind: 'file', name: 'readme.md', resourceId: `${prefix}readme.md`, ops: ['read'] },
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
