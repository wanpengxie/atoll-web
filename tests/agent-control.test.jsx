// @vitest-environment jsdom
// 恢复自 master:tests/agent-control.test.js（RC，2026-09-19）。
// 旧测试依赖已删除的 src/model/agent-control.js（agentFrozenState/editAdmission/
// lockFromContext）与 src/model/fold.js。新结构里编辑锁/冻结显示的唯一 owner 是
// src/ui/timeline/useWaitingEditingController.jsx：
//   - agentFrozenState → 模块私有的 heldActors(state, now)（未导出，只能通过渲染
//     WaitingLayer 观察其 DOM 效应："已暂停"文案）
//   - editAdmission/lockFromContext（"信一次实时快照，逐帧重新判定锁是否还有效"）
//     整个模型已经不存在：新架构改成"拿到 hold 就信，显式 release 才放"的一次性信任
//     模型，没有逐帧重新校验锁合法性的live re-derivation
// 判定逐条记在 audit-output/RESTORE-MATRIX.md。
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaitingLayer } from '../src/ui/timeline/useWaitingEditingController.jsx';

afterEach(cleanup);

// heldActors 内部用真实 Date.now() 兜底过期判断（WaitingLayer 调用 heldActors(state)
// 不传 now），所以夹具的时间戳必须锚定真实当前时间，不能用玩具值。
function req({ requestId, actorId, type, ts = Date.now(), durationMs, text = 'work', extra = {} }) {
  return {
    id: requestId, type, audience: [actorId], ts,
    payload: { body: { text, ...(durationMs != null ? { duration_ms: durationMs } : {}), ...extra } },
  };
}
function completedTerminal({ requestId, type, extra = {} }) {
  return { kind: 'response', type, parent_id: requestId, payload: { body: { status: 'completed', ...extra } } };
}
function turn({ requestId, actorId, type, requestSeq, ts = Date.now(), durationMs, extra, terminal = null, terminalSeq = requestSeq, provisional = [] }) {
  return { requestId, request: req({ requestId, actorId, type, ts, durationMs, extra }), requestSeq, terminal, terminalSeq, provisional };
}
function timeline(turns) {
  return turns.map((t) => ({ kind: 'turn', turn: t }));
}
function baseProps(overrides = {}) {
  return {
    turns: [], handoffs: [], names: new Map([['agent', 'Agent']]),
    selfId: 'me', access: 'member_active', targetAuthority: { current: true, actorIDs: new Set(['agent']) },
    capabilityIndex: new Map(), editing: null,
    onCancel: vi.fn(), onControl: vi.fn(), onEdit: vi.fn(),
    ...overrides,
  };
}
function pausedFor(actorId) {
  return document.querySelector(`.agent-wait-group[data-agent-id="${actorId}"] .agent-wait-paused`);
}

const EDIT_CAPABILITY = new Map([['agent', {
  describe: { types: new Map([
    ['agent.replace', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
    ['agent.unhold', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
  ]) },
}]]);

describe('agent control：编辑锁与冻结显示（heldActors/WaitingLayer 承接旧 agentFrozenState）', () => {
  it('[AD-014] waits for the processing target own queued-resumed fact before opening edit', () => {
    // 用户能力：用户只能编辑仍处于等待队列、且已被 hold 接纳为 resumed 的请求。
    // 不变量：processing 期间不提前露出编辑入口；queued+resumed 到账后才由当前
    // 公开 WaitingLayer owner 把编辑动作交给上层 onEdit。
    const processingFrame = {
      seq: 2,
      envelope: {
        kind: 'response', type: 'agent.ask', parent_id: 'work',
        payload: { body: { status: 'processing', controls: [{ word: 'agent.replace' }] } },
      },
    };
    const processingTarget = turn({
      requestId: 'work', actorId: 'agent', type: 'agent.ask', requestSeq: 1,
      provisional: [processingFrame],
    });
    const onEdit = vi.fn();
    const stateBefore = { channelId: 'c0', rows: new Map(), timeline: timeline([processingTarget]) };
    const view = render(<WaitingLayer {...baseProps({
      turns: [processingTarget], state: stateBefore, capabilityIndex: EDIT_CAPABILITY, onEdit,
    })} />);
    const earlyEdit = screen.queryByRole('button', { name: '编辑' });

    const resumedFrame = {
      seq: 5,
      envelope: {
        kind: 'response', type: 'agent.ask', parent_id: 'work',
        payload: { body: { status: 'queued', resumed: true, held_by: 'hold-work', controls: [{ word: 'agent.replace' }] } },
      },
    };
    const resumedTarget = turn({
      requestId: 'work', actorId: 'agent', type: 'agent.ask', requestSeq: 1,
      provisional: [processingFrame, resumedFrame],
    });
    const stateAfter = { channelId: 'c0', rows: new Map(), timeline: timeline([resumedTarget]) };
    view.rerender(<WaitingLayer {...baseProps({
      turns: [resumedTarget], state: stateAfter, capabilityIndex: EDIT_CAPABILITY, onEdit,
    })} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    // 当前公开 owner 仍按 controls 直接显示 processing 编辑入口；保留这个红项，
    // 让产品缺口可由用户路径复现，不在测试中绕过 owner 或修产品。
    expect(earlyEdit).toBeNull();
    expect(onEdit).toHaveBeenCalledWith(resumedTarget, 'agent');
  });

  it('[AD-017] restores the interrupt pause after an overlaid edit hold is released or expires', () => {
    // 用户能力：用户可在已暂停的 agent 上短暂取得编辑 hold，释放/到期后仍应看到
    // 原 interrupt 暂停状态。不变量：临时 hold 不能覆盖并遗失更早的公开停止事实。
    // 公开 owner：WaitingLayer（通过 DOM 的“已暂停”结果观察 state 归约）。
    const stop = turn({
      requestId: 'stop', actorId: 'agent', type: 'agent.interrupt', requestSeq: 1,
      terminal: completedTerminal({ requestId: 'stop', type: 'agent.interrupt' }),
    });
    const hold = turn({
      requestId: 'hold', actorId: 'agent', type: 'agent.hold', requestSeq: 2,
      extra: { target: 'work' },
      terminal: completedTerminal({ requestId: 'hold', type: 'agent.hold' }),
    });
    const release = turn({
      requestId: 'release', actorId: 'agent', type: 'agent.unhold', requestSeq: 3,
      extra: { expected_hold_id: 'hold' },
      terminal: completedTerminal({ requestId: 'release', type: 'agent.unhold', extra: { released: true, hold_id: 'hold' } }),
    });
    const queued = turn({ requestId: 'work', actorId: 'agent', type: 'agent.ask', requestSeq: 4 });
    const releasedState = { channelId: 'c0', rows: new Map(), timeline: timeline([stop, hold, release, queued]) };
    render(<WaitingLayer {...baseProps({ turns: [queued], state: releasedState })} />);
    const pauseAfterRelease = Boolean(pausedFor('agent'));
    cleanup();

    const expiredHold = turn({
      requestId: 'hold-expired', actorId: 'agent', type: 'agent.hold', requestSeq: 2,
      ts: Date.now() - 60 * 1000, durationMs: 1000, extra: { target: 'work' },
      terminal: completedTerminal({ requestId: 'hold-expired', type: 'agent.hold' }),
    });
    const expiredQueued = turn({ requestId: 'work-expired', actorId: 'agent', type: 'agent.ask', requestSeq: 3 });
    const expiredState = { channelId: 'c0', rows: new Map(), timeline: timeline([stop, expiredHold, expiredQueued]) };
    render(<WaitingLayer {...baseProps({ turns: [expiredQueued], state: expiredState })} />);
    const pauseAfterExpiry = Boolean(pausedFor('agent'));

    // 当前 heldActors 只保留最新 hold，unhold/时间到期后会丢弃 stop 的基础事实；
    // 两个期望都保留为红项，等待产品 owner 修复状态转移。
    expect({ pauseAfterRelease, pauseAfterExpiry }).toEqual({ pauseAfterRelease: true, pauseAfterExpiry: true });
  });

  it('32 derives freeze from wall clock expiry and queue advancement', () => {
    // (a) 到期：hold 请求发生在 10 分钟前，只声明 1 分钟时长——早该过期了。
    const expiredHold = turn({ requestId: 'h2', actorId: 'agent', type: 'agent.hold', requestSeq: 1, ts: Date.now() - 10 * 60 * 1000, durationMs: 60 * 1000, terminal: completedTerminal({ requestId: 'h2', type: 'agent.hold' }) });
    const expiredTurn = turn({ requestId: 'queued-a', actorId: 'agent', type: 'agent.ask', requestSeq: 2 });
    const stateExpired = { channelId: 'c0', rows: new Map(), timeline: timeline([expiredHold, expiredTurn]) };
    render(<WaitingLayer {...baseProps({ turns: [expiredTurn], state: stateExpired })} />);
    expect(pausedFor('agent')).toBeNull();
    cleanup();

    // (a') 对照组：同样的 hold，但刚请求、声明 30 分钟——此刻仍应冻结。
    const freshHold = turn({ requestId: 'h2b', actorId: 'agent', type: 'agent.hold', requestSeq: 1, ts: Date.now(), durationMs: 30 * 60 * 1000, terminal: completedTerminal({ requestId: 'h2b', type: 'agent.hold' }) });
    const freshTurn = turn({ requestId: 'queued-b', actorId: 'agent', type: 'agent.ask', requestSeq: 2 });
    const stateFresh = { channelId: 'c0', rows: new Map(), timeline: timeline([freshHold, freshTurn]) };
    render(<WaitingLayer {...baseProps({ turns: [freshTurn], state: stateFresh })} />);
    expect(pausedFor('agent')).toBeTruthy();
    cleanup();

    // (b) 队列前进：hold 声明未完成前，被 hold 的目标已经自己进入 processing（advanced），
    // 冻结不应再显示。
    const advancedHold = turn({ requestId: 'h3', actorId: 'agent', type: 'agent.hold', requestSeq: 1, terminal: completedTerminal({ requestId: 'h3', type: 'agent.hold' }) });
    const advancedTarget = turn({
      requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 2,
      provisional: [{ seq: 5, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'queued', payload: { body: { status: 'processing' } } } }],
    });
    const stateAdvanced = { channelId: 'c0', rows: new Map(), timeline: timeline([advancedHold, advancedTarget]) };
    render(<WaitingLayer {...baseProps({ turns: [advancedTarget], state: stateAdvanced })} />);
    expect(pausedFor('agent')).toBeNull();
  });

  it('33 ignores a late hold fire whose hold_id does not match held_by', () => {
    const holdOp = turn({ requestId: 'h2', actorId: 'agent', type: 'agent.hold', requestSeq: 1, durationMs: 30 * 60 * 1000, terminal: completedTerminal({ requestId: 'h2', type: 'agent.hold' }) });
    const queuedTurn = turn({ requestId: 'q1', actorId: 'agent', type: 'agent.ask', requestSeq: 2 });
    const mismatchExpire = { kind: 'event', type: 'agent.hold_expired', payload: { body: { hold_id: 'h1' } } };
    const stateMismatch = { channelId: 'c0', rows: new Map([[3, mismatchExpire]]), timeline: timeline([holdOp, queuedTurn]) };
    render(<WaitingLayer {...baseProps({ turns: [queuedTurn], state: stateMismatch })} />);
    expect(pausedFor('agent')).toBeTruthy();
    cleanup();

    const matchExpire = { kind: 'event', type: 'agent.hold_expired', payload: { body: { hold_id: 'h2' } } };
    const stateMatch = { channelId: 'c0', rows: new Map([[3, matchExpire]]), timeline: timeline([holdOp, queuedTurn]) };
    render(<WaitingLayer {...baseProps({ turns: [queuedTurn], state: stateMatch })} />);
    expect(pausedFor('agent')).toBeNull();
  });

  it('35（前半）keeps replace under its edit hold：agent.replace 进入缓冲区不会像普通 agent.ask 一样释放持有的编辑锁', () => {
    const holdOp = turn({ requestId: 'hold', actorId: 'agent', type: 'agent.hold', requestSeq: 1, terminal: completedTerminal({ requestId: 'hold', type: 'agent.hold' }) });
    const replaceTurn = turn({
      requestId: 'replacement', actorId: 'agent', type: 'agent.replace', requestSeq: 2,
      provisional: [{ seq: 3, envelope: { kind: 'response', type: 'agent.replace', parent_id: 'replacement', payload: { body: { status: 'queued', resumed: true } } } }],
    });
    const state = { channelId: 'c0', rows: new Map(), timeline: timeline([holdOp, replaceTurn]) };
    render(<WaitingLayer {...baseProps({ turns: [replaceTurn], state })} />);
    expect(pausedFor('agent')).toBeTruthy();
  });

  it('36 keeps the editing lease while a turn already running before the hold keeps reporting progress', () => {
    // running 在 hold 之前就已经在跑；它后续继续报 processing（业务进度）不该被当成
    // "队列前进"而清掉 hold——hold 目标是 queued，不是 running。
    const runningFirstProcessing = { seq: 2, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'running', payload: { body: { status: 'processing' } } } };
    const runningTurn = turn({ requestId: 'running', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [runningFirstProcessing] });
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 3 });
    const holdOp = turn({ requestId: 'h1', actorId: 'agent', type: 'agent.hold', requestSeq: 5, terminal: completedTerminal({ requestId: 'h1', type: 'agent.hold' }) });
    const state = { channelId: 'c0', rows: new Map(), timeline: timeline([runningTurn, queuedTurn, holdOp]) };
    render(<WaitingLayer {...baseProps({ turns: [queuedTurn], state })} />);
    expect(pausedFor('agent')).toBeTruthy();
    cleanup();
    // 业务进度行（非核心状态）与追加的第二条 processing 同样不是"队列前进"。
    runningTurn.provisional = [runningFirstProcessing,
      { seq: 8, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'running', payload: { body: { status: 'tool.started' } } } },
      { seq: 9, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'running', payload: { body: { status: 'processing' } } } }];
    render(<WaitingLayer {...baseProps({ turns: [queuedTurn], state })} />);
    expect(pausedFor('agent')).toBeTruthy();
    cleanup();
    // 队列真的前进了才作废：被 hold 的那一条（queued）自己开跑。
    queuedTurn.provisional = [{ seq: 10, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'queued', payload: { body: { status: 'processing' } } } }];
    render(<WaitingLayer {...baseProps({ turns: [queuedTurn], state })} />);
    expect(pausedFor('agent')).toBeNull();
  });

  it('【缺陷】37 clears the lease when the held target resumes processing after a paused stretch——只认第一条 processing 帧，之后再恢复运行认不出来', () => {
    // target 在 hold 之前已经跑过一次（target-p），随后被 hold 成 queued+resumed，
    // 之后又真的恢复处理（target-p2）——这第二次 processing 才是"队列真的前进"，
    // hold 应该失效。旧 agentFrozenState 逐帧扫描能看到这第二次；新 heldActors 对每个
    // turn 只取 provisional 里"第一条" status==='processing' 帧（找到就 break），
    // 第二次恢复处理的证据被永久丢弃。
    const targetFirstProcessing = { seq: 2, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'target', payload: { body: { status: 'processing' } } } };
    const targetTurn = turn({ requestId: 'target', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [targetFirstProcessing] });
    const holdOp = turn({ requestId: 'h2', actorId: 'agent', type: 'agent.hold', requestSeq: 3, terminal: completedTerminal({ requestId: 'h2', type: 'agent.hold' }) });
    const state = { channelId: 'c0', rows: new Map(), timeline: timeline([targetTurn, holdOp]) };
    render(<WaitingLayer {...baseProps({ turns: [targetTurn], state })} />);
    expect(pausedFor('agent')).toBeTruthy();
    cleanup();
    targetTurn.provisional = [targetFirstProcessing, { seq: 6, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'target', payload: { body: { status: 'processing' } } } }];
    render(<WaitingLayer {...baseProps({ turns: [targetTurn], state })} />);
    // 期望（旧行为）：第二次恢复处理清掉 hold；实际：仍然显示已暂停。
    expect(pausedFor('agent')).toBeNull();
  });

  it('【缺陷】compact unhold closure 不把缺失 released 猜成 legacy true——heldActors 的 terminalCompleted 未排除 terminalClosureOnly', () => {
    // unhold 响应被压缩（terminalClosureOnly=true）时，即便压缩后的 payload 仍然带着
    // released:true 字样，也不能当作真的已释放来处理——旧 agentFrozenState 对此有专门保护。
    // 新 heldActors 的私有 terminalCompleted() 直接读 argsOf(turn.terminal)?.status，完全不看
    // turn.terminalClosureOnly，等价于无条件相信压缩闭包里的字段。
    const holdOp = turn({ requestId: 'hold', actorId: 'agent', type: 'agent.hold', requestSeq: 1, terminal: completedTerminal({ requestId: 'hold', type: 'agent.hold' }) });
    const releaseOp = turn({
      requestId: 'release', actorId: 'agent', type: 'agent.unhold', requestSeq: 2,
      terminal: completedTerminal({ requestId: 'release', type: 'agent.unhold', extra: { released: true } }),
    });
    releaseOp.terminalClosureOnly = true;
    const queuedTurn = turn({ requestId: 'q1', actorId: 'agent', type: 'agent.ask', requestSeq: 3 });
    const state = { channelId: 'c0', rows: new Map(), timeline: timeline([holdOp, releaseOp, queuedTurn]) };
    render(<WaitingLayer {...baseProps({ turns: [queuedTurn], state })} />);
    // 期望（旧行为）：压缩闭包不可信，编辑锁仍显示"已暂停"；实际：被当作真释放，冻结消失。
    expect(pausedFor('agent')).toBeTruthy();
  });
});
