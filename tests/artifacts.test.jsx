import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectFeatureSearchIndex } from '../src/model/feature-search.js';

// src/model/artifacts.js (buildArtifactIndex/artifactList/artifactKey) was
// deleted. Attachment-fact extraction from the ledger now lives in
// src/model/feature-search.js (attachmentFacts/addArtifactReference), driven
// off the same Presentation (selectTimelineItems) every other view reads —
// per ARCHITECTURE-CHARTER.md this is the only legitimate owner left for
// "which artifacts exist in this channel". Envelopes must use the canonical
// `payload: { body }` wrapper (argsOf returns {} otherwise).
function row(channelId, seq, envelope) {
  return { channel_id: channelId, seq, envelope: { ts: 1_700_000_000_000 + seq, visibility: 'public', audience: [], sender: { kind: 'human', id: 'alice' }, ...envelope } };
}

function artifactRows(states, channels) {
  return selectFeatureSearchIndex({ states, channels }).filter((entry) => entry.kind === 'artifact');
}

describe('Artifact 从 ChannelReplica + feature-search 投影索引', () => {
  it('只从合法附件建立频道隔离索引并保留 SourceRef', () => {
    const c1 = createChannelReplicaStore();
    c1.commit(row('c1', 4, { id: 'm1', kind: 'request', type: 'agent.ask', payload: { body: { text: '报告', attachments: [{ resource_id: 'file:report', name: '报告.pdf', media_type: 'application/pdf', size: 42 }] } } }));
    c1.commit(row('c1', 5, { id: 'm1-r', kind: 'response', type: 'agent.ask', parent_id: 'm1', sender: { kind: 'agent', id: 'bot' }, payload: { body: { status: 'completed' } } }));
    const c2 = createChannelReplicaStore();
    c2.commit(row('c2', 7, { id: 'm2', kind: 'request', type: 'agent.ask', payload: { body: { attachments: [{ resource_id: 'file:report', name: '另一个报告.pdf', media_type: 'application/pdf' }] } } }));
    c2.commit(row('c2', 8, { id: 'm2-r', kind: 'response', type: 'agent.ask', parent_id: 'm2', sender: { kind: 'agent', id: 'bot' }, payload: { body: { status: 'completed' } } }));

    const rows = artifactRows([['c1', c1.state('c1')], ['c2', c2.state('c2')]], [{ id: 'c1' }, { id: 'c2' }]);
    const first = rows.find((row) => row.channelId === 'c1');
    expect(first.key).toBe('search:c1:artifact:file:report');
    expect(first.references[0]).toMatchObject({ channelId: 'c1', objectType: 'turn', objectId: 'm1', seq: 4, envelopeId: 'm1', requestId: 'm1' });
    // Channel isolation: c2's identical resource_id never merges into c1's row.
    expect(rows.find((row) => row.channelId === 'c2').key).toBe('search:c2:artifact:file:report');
    expect(rows.find((row) => row.channelId === 'c2').key).not.toBe(first.key);
  });

  it('不会从文件名、普通 JSON、ticket 或 registrar value 猜测产物', () => {
    const state = createChannelReplicaStore();
    state.commit(row('c0', 1, { id: 'm1', kind: 'request', type: 'agent.ask', payload: { body: { text: '请查看 report-v2-final.pdf' } } }));
    state.commit(row('c0', 2, { id: 'm2', kind: 'event', type: 'system.note', payload: { body: { ticket: 'secret', address: 'daemon://hidden/path' } } }));
    state.commit(row('c0', 3, { id: 'm3', kind: 'response', type: 'registrar.result', parent_id: 'm1', payload: { body: { status: 'completed', value: { resource_id: 'looks-like-file', name: 'fake.pdf' } } } }));
    state.commit(row('c0', 4, { id: 'm4', kind: 'event', type: 'system.note', payload: { body: { attachments: [{ resource_id: 'event-file', name: 'not-terminal.pdf' }] } } }));
    expect(artifactRows([['c0', state.state('c0')]], [{ id: 'c0' }])).toEqual([]);
  });

  it('[AD-123] accepts only an explicit version relation and keeps same-channel references linked', () => {
    // 用户能力：搜索产物能显示上传者声明的上一版本；不变量：关系必须来自
    // version_of，且 relation key 仍被限定在当前频道，不从文件名推断。
    const state = createChannelReplicaStore();
    state.commit(row('c0', 1, { id: 'v1', kind: 'request', type: 'agent.ask', payload: { body: { attachments: [{ resource_id: 'r1', name: 'report-final.pdf', media_type: 'application/pdf' }] } } }));
    state.commit(row('c0', 2, { id: 'v1-r', kind: 'response', type: 'agent.ask', parent_id: 'v1', sender: { kind: 'agent', id: 'bot' }, payload: { body: { status: 'completed' } } }));
    state.commit(row('c0', 3, { id: 'v2', kind: 'request', type: 'agent.ask', payload: { body: { attachments: [{ resource_id: 'r2', name: 'report-final-v2.pdf', media_type: 'application/pdf', version_of: 'r1' }] } } }));
    state.commit(row('c0', 4, { id: 'v2-r', kind: 'response', type: 'agent.ask', parent_id: 'v2', sender: { kind: 'agent', id: 'bot' }, payload: { body: { status: 'completed' } } }));
    state.commit(row('c0', 5, { id: 'again', kind: 'request', type: 'agent.ask', payload: { body: { attachments: [{ resource_id: 'r1', name: 'renamed.pdf', media_type: 'application/pdf' }] } } }));
    state.commit(row('c0', 6, { id: 'again-r', kind: 'response', type: 'agent.ask', parent_id: 'again', sender: { kind: 'agent', id: 'bot' }, payload: { body: { status: 'completed' } } }));
    const rows = artifactRows([['c0', state.state('c0')]], [{ id: 'c0' }]);
    const r1 = rows.find((row) => row.resourceId === 'r1');
    const r2 = rows.find((row) => row.resourceId === 'r2');
    // 公开 owner：ChannelReplica 的 Presentation 交给 feature-search 的
    // attachmentFact/addArtifactReference；这里验证最终公开搜索行，而非私有
    // helper 或旧的 artifacts store。
    expect(r2.versionOf).toBe('search:c0:artifact:r1');
    expect(r1.versionOf).toBeUndefined();
    expect(r1.references).toHaveLength(2);
    expect(r1.title).toBe('report-final.pdf');
  });

  it('仅通过正式 artifact 对象接纳结构化产物', () => {
    const state = createChannelReplicaStore();
    state.commit(row('c0', 1, { id: 'q', kind: 'request', type: 'agent.ask', payload: { body: { text: 'go' } } }));
    state.commit(row('c0', 2, { id: 'a', kind: 'response', type: 'business.report', parent_id: 'q', sender: { kind: 'agent', id: 'bot' }, payload: { body: { status: 'completed', artifact: { resource_id: 'report:1', name: '研究报告', media_type: 'text/markdown', artifact_kind: 'report' } } } }));
    const [row0] = artifactRows([['c0', state.state('c0')]], [{ id: 'c0' }]);
    expect(row0).toMatchObject({ resourceId: 'report:1', title: '研究报告', subtitle: 'text/markdown' });
  });
});
