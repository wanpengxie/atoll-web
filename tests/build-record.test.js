import { describe, expect, it } from 'vitest';
import {
  buildAttemptLabel,
  buildObjectLabel,
  buildRecord,
  buildResultLabel,
  buildStateLabel,
  buildSummaryText,
  buildTone,
} from '../src/model/build-record.js';

// system.build.finished 的 payload 形状（见 CONFIG_REALIGN_BUILD_SPEC 附录 A）。
function finished(overrides = {}) {
  return {
    object: { kind: 'member', channel: 'ch-project', channel_name: 'c0.project', entry_id: 'e-1', config_id: 'cfg-1', actor_id: 'agent:writer:9', name: 'writer' },
    description: { channel_revision: 3, actor: 'd-writer@1' },
    config: { config_id: 'cfg-1', revision: 2 },
    attempt: 2,
    cause: 'config',
    result: 'failed',
    state: 'stopped',
    reason: 'member writer: service.api_key is a placeholder still unfilled',
    started_at: 10,
    finished_at: 20,
    ...overrides,
  };
}

describe('build record model', () => {
  it('reads a record into a fixed shape, from an object or its JSON text', () => {
    const record = buildRecord(finished());
    expect(record).toEqual({
      object: { kind: 'member', channel: 'ch-project', channelName: 'c0.project', entryId: 'e-1', configId: 'cfg-1', generated: '', actorId: 'agent:writer:9', name: 'writer' },
      channelRevision: 3,
      actor: 'd-writer@1',
      configRevision: 2,
      attempt: 2,
      cause: 'config',
      result: 'failed',
      state: 'stopped',
      reason: 'member writer: service.api_key is a placeholder still unfilled',
      startedAt: 10,
      finishedAt: 20,
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(buildRecord(JSON.stringify(finished()))).toEqual(record);
    // 没有 config 的成员（还没写过这一台的配置）：configRevision 是 null，不是 0。
    expect(buildRecord(finished({ config: undefined })).configRevision).toBeNull();
    // attempt 缺失或不合法按第 1 次算。
    expect(buildRecord(finished({ attempt: 0 })).attempt).toBe(1);
    expect(buildRecord(finished({ attempt: 'x' })).attempt).toBe(1);
  });

  it('is not a build record without an object kind', () => {
    expect(buildRecord(null)).toBeNull();
    expect(buildRecord('not json')).toBeNull();
    expect(buildRecord({ result: 'ok' })).toBeNull();
    expect(buildRecord({ object: { kind: '' } })).toBeNull();
    expect(buildRecord([])).toBeNull();
  });

  it('labels the object, the result, the state and the attempt', () => {
    expect(buildObjectLabel(buildRecord(finished()))).toBe('成员 writer');
    expect(buildObjectLabel(buildRecord(finished({ object: { kind: 'channel', channel: 'c0.a' } })))).toBe('频道 c0.a');
    expect(buildObjectLabel(buildRecord(finished({ object: { kind: 'other' } })))).toBe('other');
    expect(buildResultLabel(buildRecord(finished({ result: 'ok' })))).toBe('成功');
    expect(buildResultLabel(buildRecord(finished({ result: 'superseded' })))).toBe('被新值取代');
    expect(buildResultLabel(buildRecord(finished({ result: undefined })))).toBe('构建中');
    expect(buildResultLabel(null)).toBe('');
    expect(buildStateLabel(buildRecord(finished({ state: 'stopped' })))).toBe('已停止：改描述或配置、或重启后才会再构建');
    expect(buildStateLabel(buildRecord(finished({ state: 'serving' })))).toBe('服务中');
    expect(buildStateLabel(buildRecord(finished({ state: '' })))).toBe('');
    expect(buildAttemptLabel(buildRecord(finished()))).toBe('第 2 次尝试');
  });

  it('says one sentence per record for the timeline and summaries', () => {
    expect(buildSummaryText(buildRecord(finished()), { started: true })).toBe('开始构建成员 writer（第 2 次尝试）');
    expect(buildSummaryText(buildRecord(finished({ result: undefined, state: undefined })))).toBe('开始构建成员 writer（第 2 次尝试）');
    expect(buildSummaryText(buildRecord(finished({ result: 'ok', state: 'ready', reason: '' })))).toBe('成员 writer构建成功，已就绪');
    expect(buildSummaryText(buildRecord(finished({ result: 'ok', state: '', reason: '' })))).toBe('成员 writer构建成功');
    expect(buildSummaryText(buildRecord(finished({ result: 'superseded' })))).toBe('成员 writer的这次构建被更新的值取代');
    expect(buildSummaryText(buildRecord(finished())))
      .toBe('成员 writer构建失败（第 2 次尝试，已停止：改描述或配置、或重启后才会再构建）：member writer: service.api_key is a placeholder still unfilled');
    expect(buildSummaryText(buildRecord(finished({ attempt: 4, reason: '' }))))
      .toBe('成员 writer构建失败（第 4 次尝试，已停止：改描述或配置、或重启后才会再构建）');
    expect(buildSummaryText(null)).toBe('');
  });

  it('picks a tone from result and state', () => {
    expect(buildTone(buildRecord(finished({ result: undefined })))).toBe('pending');
    expect(buildTone(buildRecord(finished({ result: 'ok' })))).toBe('ok');
    expect(buildTone(buildRecord(finished({ result: 'superseded' })))).toBe('muted');
    // 失败就停：没有"下次再试"这一档。
    expect(buildTone(buildRecord(finished()))).toBe('stopped');
    expect(buildTone(null)).toBe('pending');
  });
});
