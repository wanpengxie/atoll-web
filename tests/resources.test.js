import { describe, expect, it } from 'vitest';
import { attachmentFromResource, createDirectoryResource, createFileTicket, deleteFileResource, fileAddress, kvResource, readFileTicket } from '../src/model/resources.js';

describe('resource model', () => {
  it('does not require resource_id for list', () => {
    expect(kvResource({ channelId: 'c0', op: 'list' })).toEqual({ channel_id: 'c0', op: 'list' });
  });
  it('builds KV and file frames with separate control/data plane fields', () => {
    expect(kvResource({ channelId: 'c0', op: 'write', id: 'kv:demo', args: { value: 2 } })).toEqual({ channel_id: 'c0', op: 'write', resource_id: 'kv:demo', args: { value: 2 } });
    const address = fileAddress({ deviceId: 'd1', channelId: 'c0', path: 'reports/a.txt' });
    expect(createFileTicket({ channelId: 'c0', address })).toEqual({ channel_id: 'c0', op: 'create', address, with_content: true });
    expect(createDirectoryResource({ channelId: 'c0', address })).toEqual({ channel_id: 'c0', op: 'create', address, node_type: 'directory' });
    expect(deleteFileResource({ channelId: 'c0', resourceId: address })).toEqual({ channel_id: 'c0', op: 'delete', resource_id: address });
    expect(readFileTicket({ channelId: 'c0', resourceId: 'file:a' })).toEqual({ channel_id: 'c0', op: 'read', resource_id: 'file:a', with_content: true });
    expect(readFileTicket({ channelId: 'c0', resourceId: '/srv/频道/报告 1.md' })).toEqual({ channel_id: 'c0', op: 'read', resource_id: '/srv/频道/报告 1.md', with_content: true });
  });
  it('rejects traversal paths and creates safe attachment metadata', () => {
    expect(() => fileAddress({ deviceId: 'd1', channelId: 'c0', path: '../a' })).toThrow('..');
    expect(attachmentFromResource({ resourceId: 'file:a', file: { name: 'a.txt', type: 'text/plain', size: 3 } })).toEqual({ resource_id: 'file:a', name: 'a.txt', media_type: 'text/plain', size: 3 });
  });
});
