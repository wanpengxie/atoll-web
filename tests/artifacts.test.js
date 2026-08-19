import { describe, expect, it } from 'vitest';
import { artifactKey, artifactList, buildArtifactIndex } from '../src/model/artifacts.js';
import { apply, createChannelState } from '../src/model/fold.js';

function row(channelId, seq, envelope) {
  return { channel_id: channelId, seq, envelope: { ts: 1_700_000_000_000 + seq, visibility: 'public', audience: [], sender: { kind: 'human', id: 'alice' }, ...envelope } };
}

describe('Artifact 账本索引', () => {
  it('只从合法附件建立频道隔离索引并保留 SourceRef', () => {
    const c1 = createChannelState('c1');
    const c2 = createChannelState('c2');
    apply(c1, row('c1', 4, { id: 'm1', kind: 'request', type: 'agent.ask', payload: { text: '报告', attachments: [{ resource_id: 'file:report', name: '报告.pdf', media_type: 'application/pdf', size: 42 }] } }));
    apply(c2, row('c2', 7, { id: 'm2', kind: 'request', type: 'agent.ask', payload: { attachments: [{ resource_id: 'file:report', name: '另一个报告.pdf', media_type: 'application/pdf' }] } }));
    const first = artifactList(c1)[0];
    expect(first.key).toBe('artifact:c1:file:report');
    expect(first.source).toMatchObject({ channelId: 'c1', view: 'dynamic', objectType: 'turn', objectId: 'm1', seq: 4, envelopeId: 'm1' });
    expect(buildArtifactIndex(c2).has(first.key)).toBe(false);
    expect(artifactKey('c2', 'file:report')).not.toBe(first.key);
  });

  it('不会从文件名、普通 JSON、ticket 或 registrar value 猜测产物', () => {
    const state = createChannelState('c0');
    apply(state, row('c0', 1, { id: 'm1', kind: 'request', type: 'agent.ask', payload: { text: '请查看 report-v2-final.pdf' } }));
    apply(state, row('c0', 2, { id: 'm2', kind: 'event', type: 'system.note', payload: { ticket: 'secret', address: 'daemon://hidden/path' } }));
    apply(state, row('c0', 4, { id: 'm4', kind: 'event', type: 'agent.tool.ended', payload: { attachments: [{ resource_id: 'event-file', name: 'not-terminal.pdf' }] } }));
    apply(state, row('c0', 3, { id: 'm3', kind: 'response', type: 'registrar.result', parent_id: 'm1', payload: { status: 'completed', value: { resource_id: 'looks-like-file', name: 'fake.pdf' } } }));
    expect(artifactList(state)).toEqual([]);
  });

  it('只接受显式版本关系并合并同资源引用', () => {
    const state = createChannelState('c0');
    apply(state, row('c0', 1, { id: 'v1', kind: 'request', type: 'agent.ask', payload: { attachments: [{ resource_id: 'r1', name: 'report-final.pdf', media_type: 'application/pdf' }] } }));
    apply(state, row('c0', 2, { id: 'v2', kind: 'request', type: 'agent.ask', payload: { attachments: [{ resource_id: 'r2', name: 'report-final-v2.pdf', media_type: 'application/pdf', version_of: 'r1' }] } }));
    apply(state, row('c0', 3, { id: 'again', kind: 'request', type: 'agent.ask', payload: { attachments: [{ resource_id: 'r1', name: 'renamed.pdf', media_type: 'application/pdf' }] } }));
    const index = buildArtifactIndex(state);
    expect(index.get('artifact:c0:r2').versionOf).toBe('artifact:c0:r1');
    expect(index.get('artifact:c0:r1').versionOf).toBeUndefined();
    expect(index.get('artifact:c0:r1').references).toHaveLength(2);
    expect(index.get('artifact:c0:r1').name).toBe('report-final.pdf');
  });

  it('仅通过正式 artifact 对象或注册 adapter 接纳结构化产物', () => {
    const state = createChannelState('c0');
    apply(state, row('c0', 1, { id: 'q', kind: 'request', type: 'agent.ask', payload: { text: 'go' } }));
    apply(state, row('c0', 2, { id: 'a', kind: 'response', type: 'business.report', parent_id: 'q', payload: { status: 'completed', artifact: { resource_id: 'report:1', name: '研究报告', media_type: 'text/markdown', artifact_kind: 'report' } } }));
    expect(artifactList(state)[0]).toMatchObject({ resourceId: 'report:1', kind: 'report', preview: 'text' });
  });
});
