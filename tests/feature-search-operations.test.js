import { describe, expect, it } from 'vitest';
import { searchFeatureIndex, selectFeatureSearchIndex } from '../src/model/feature-search.js';

const channels = [{ id: 'c1', name: '研究频道', access: 'member_active' }];

describe('feature search operation projection', () => {
  it('AD-002 exposes one public operation source for an unresolved terminal fact', () => {
    const index = selectFeatureSearchIndex({
      channels,
      operations: [{
        operationId: 'approval-submit',
        channelId: 'c1',
        requestId: 'approval-1',
        kind: 'message_submit',
        title: '提交审批',
        state: 'failed',
        updatedAt: 7,
        source: {
          channelId: 'c1',
          view: 'artifacts',
          objectType: 'operation',
          objectId: 'approval-submit',
          privateTicket: 'must-not-leak',
        },
      }],
    });

    const operations = index.filter((entry) => entry.kind === 'operation');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: 'approval-submit',
      objectType: 'operation',
      state: 'failed',
      source: {
        channelId: 'c1',
        objectId: 'approval-submit',
      },
    });
    expect(operations[0].source).not.toHaveProperty('privateTicket');
  });

  it('AD-003 deduplicates an operation by channel/native id and keeps its newest unsettled state', () => {
    const index = selectFeatureSearchIndex({
      channels,
      operations: [
        {
          operationId: 'upload-1',
          channelId: 'c1',
          title: '旧上传',
          state: 'transferring',
          updatedAt: 10,
        },
        {
          operationId: 'upload-1',
          channelId: 'c1',
          title: '新上传',
          state: 'waiting_ledger',
          updatedAt: 20,
        },
        {
          operationId: 'done-1',
          channelId: 'c1',
          title: '已完成',
          state: 'completed',
          updatedAt: 30,
        },
        {
          operationId: 'settled-after-upload',
          channelId: 'c1',
          title: '进行中的上传',
          state: 'transferring',
          updatedAt: 10,
        },
        {
          operationId: 'settled-after-upload',
          channelId: 'c1',
          title: '上传已完成',
          state: 'completed',
          updatedAt: 20,
        },
      ],
    });

    expect(index.filter((entry) => entry.kind === 'operation')).toEqual([
      expect.objectContaining({ id: 'upload-1', title: '新上传', state: 'waiting_ledger' }),
    ]);
  });

  it('AD-004 makes operation titles searchable and preserves the public source reference', () => {
    const index = selectFeatureSearchIndex({
      channels,
      operations: [{
        operationId: 'export-1',
        channelId: 'c1',
        title: '上传预算附件',
        state: 'waiting_ledger',
        updatedAt: 20,
        source: {
          channelId: 'c1',
          view: 'artifacts',
          objectType: 'operation',
          objectId: 'export-1',
        },
      }],
    });

    expect(searchFeatureIndex(index, '预算附件', { kinds: ['operation'] })).toEqual([
      expect.objectContaining({
        kind: 'operation',
        source: expect.objectContaining({ objectId: 'export-1', channelId: 'c1' }),
      }),
    ]);
  });

  it('keeps a same-request WorkItem ahead of its Operation projection', () => {
    const index = selectFeatureSearchIndex({
      channels,
      tasks: [{
        key: 'approval:c1:approval-1',
        channelId: 'c1',
        kind: 'approval',
        title: '批准上线',
        state: 'failed',
        requestId: 'approval-1',
        updatedAt: 6,
        source: {
          channelId: 'c1',
          view: 'tasks',
          objectType: 'work_item',
          objectId: 'approval:c1:approval-1',
          requestId: 'approval-1',
        },
      }],
      operations: [{
        operationId: 'approval-submit',
        channelId: 'c1',
        requestId: 'approval-1',
        title: '提交审批',
        state: 'failed',
        updatedAt: 7,
      }],
    });

    expect(index.filter((entry) => entry.kind === 'operation')).toHaveLength(0);
    expect(index.filter((entry) => entry.kind === 'work_item')).toEqual([
      expect.objectContaining({ id: 'approval:c1:approval-1', requestId: 'approval-1' }),
    ]);
  });
});
