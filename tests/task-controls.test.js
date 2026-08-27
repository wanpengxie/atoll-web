import { describe, expect, it } from 'vitest';
import { controlLabel, extraControls, taskControlContext } from '../src/model/task-controls.js';

// 按钮可用性唯一来源 = 消息自己 progress 账上最新 status 帧的 controls（受理方宣告），
// 交上写权限。前端恒不查 describe、恒不按收方身份推断。
//
// 归属不再决定"能不能"，只决定"走哪条路"：频道是一个统一权限边界，能在这里写就
// 能操作这里等待中的活。取消自己发的那条是调用方自闭账；别人发的没有那一臂
// （终态授权是 receiver / caller / substrate 的闭集），改请底座代关。
describe('task control eligibility', () => {
  const processing = {
    request: { id: 'r1', type: 'agent.ask', sender: { id: 'me' }, audience: ['agent'], expires_at: 2000 },
    provisional: [{ envelope: { payload: { status: 'processing', turn_id: 'turn-7', controls: [{ word: 'agent.interrupt' }, { word: 'agent.replace' }] } } }],
    terminal: null,
  };
  const queued = {
    ...processing,
    provisional: [{ envelope: { payload: { status: 'queued', controls: [{ word: 'agent.replace' }, { word: 'agent.steer' }] } } }],
  };

  it('requires a writable channel and an advertised control', () => {
    expect(taskControlContext(processing, { selfId: 'me', access: 'member_active', now: 1000 })).toMatchObject({ canCancel: false, canInsert: false, canEdit: true, canStop: true, location: 'processing', turnId: 'turn-7', expired: false });
    expect(taskControlContext(processing, { selfId: 'me', access: 'member_stale' })).toMatchObject({ canEdit: false, canStop: false });
    expect(taskControlContext(queued, { selfId: 'me', access: 'member_active' })).toMatchObject({ canCancel: true, canInsert: true, canEdit: true, canStop: false, location: 'queued' });
    expect(taskControlContext({ ...processing, terminal: { payload: { status: 'completed' } } }, { selfId: 'me', access: 'member_active' })).toMatchObject({ canCancel: false, canEdit: false, canStop: false, controls: [] });
  });

  // 转发的活是这条规则的真实来由：agent 代人转发的请求，sender 是转发的 agent，
  // 于是委托人自己反而一个按钮都没有。现在除取消外都归任何可写成员。
  it('lets any writing member act on work it did not send', () => {
    expect(taskControlContext(processing, { selfId: 'other', access: 'member_active' })).toMatchObject({ canEdit: true, canStop: true });
    expect(taskControlContext(queued, { selfId: 'other', access: 'member_active' })).toMatchObject({ canInsert: true, canEdit: true });
  });

  // 取消对谁都开，但归属决定走哪条路：自己发的由调用方自闭账，别人发的没有那一臂
  // （终态授权是闭集），只能请底座代关。按钮只有一个，路由不暴露给使用者。
  it('lets anyone cancel, and says which path it must take', () => {
    expect(taskControlContext(queued, { selfId: 'me', access: 'member_active' })).toMatchObject({ canCancel: true, cancelsAsSubstrate: false });
    expect(taskControlContext(queued, { selfId: 'other', access: 'member_active' })).toMatchObject({ canCancel: true, cancelsAsSubstrate: true });
    // 不可写的频道两条路都没有。
    expect(taskControlContext(queued, { selfId: 'other', access: 'member_stale' })).toMatchObject({ canCancel: false, cancelsAsSubstrate: false });
  });

  it('draws nothing when the account advertises no controls', () => {
    const silent = { ...processing, provisional: [{ envelope: { payload: { status: 'processing', turn_id: 'turn-7' } } }] };
    expect(taskControlContext(silent, { selfId: 'me', access: 'member_active' })).toMatchObject({ canEdit: false, canStop: false, canInsert: false, controls: [] });
    const overridden = { ...processing, provisional: [...queued.provisional, { envelope: { payload: { status: 'processing', turn_id: 'turn-7', controls: [] } } }] };
    expect(taskControlContext(overridden, { selfId: 'me', access: 'member_active' })).toMatchObject({ canEdit: false, canInsert: false, location: 'processing' });
  });

  it('routes unknown advertised words to the generic path with label fallback', () => {
    const custom = { ...processing, provisional: [{ envelope: { payload: { status: 'processing', controls: [{ word: 'agent.interrupt' }, { word: 'agent.escalate', label: '升级' }, { word: 'agent.retry' }] } } }] };
    const context = taskControlContext(custom, { selfId: 'me', access: 'member_active' });
    expect(extraControls(context).map((entry) => entry.word)).toEqual(['agent.escalate', 'agent.retry']);
    expect(controlLabel({ word: 'agent.escalate', label: '升级' })).toBe('升级');
    expect(controlLabel({ word: 'agent.retry' })).toBe('retry');
    expect(extraControls(taskControlContext(custom, { selfId: 'other', access: 'member_stale' }))).toEqual([]);
  });
});
