import { describe, expect, it } from 'vitest';
import { apply, createChannelState, reconcileApprovals } from '../src/model/fold.js';
import { trimChannelState } from '../src/model/memory-window.js';
import { selectLocalWaitingTurns, selectWaitingPresentation } from '../src/model/waiting-presentation.js';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = { id: 'agent:worker:1', kind: 'agent' };

function row(seq, envelope) {
  return { channel_id: CHANNEL, seq, envelope };
}

function requestRow(seq, id) {
  return row(seq, {
    id, kind: 'request', type: 'agent.ask', sender: { id: SELF, kind: 'human' },
    audience: [AGENT.id], visibility: 'public', payload: { body: { text: id } },
  });
}

function queuedRow(seq, id) {
  return row(seq, {
    id: `${id}-queued`, parent_id: id, kind: 'response', type: 'agent.ask', sender: AGENT,
    audience: [SELF], visibility: 'public', payload: { body: { status: 'queued', controls: [] } },
  });
}

function terminalRow(seq, id, status = 'completed') {
  return row(seq, {
    id: `${id}-final`, parent_id: id, kind: 'response', type: 'agent.ask', sender: AGENT,
    audience: [SELF], visibility: 'public', payload: { body: { status, text: 'done' } },
  });
}

function noteRow(seq) {
  return row(seq, {
    id: `note-${seq}`, kind: 'event', type: 'human.note', sender: { id: SELF, kind: 'human' },
    visibility: 'public', payload: { body: { text: String(seq) } },
  });
}

function submission(messageId, state) {
  return {
    messageId,
    channelId: CHANNEL,
    state,
    text: messageId,
    createdAt: 1,
    frame: {
      kind: 'request', msg_type: 'agent.ask', audience: [AGENT.id],
      payload: { text: messageId }, visibility: 'public',
    },
  };
}

// 建一条"已完成"的 turn，然后灌足够多的行把它挤出内存窗口。
function foldWithTrimmedTerminalTurn({ maxRows = 40 } = {}) {
  const state = createChannelState(CHANNEL);
  apply(state, requestRow(1, 'work'), SELF);
  apply(state, queuedRow(2, 'work'), SELF);
  apply(state, terminalRow(3, 'work'), SELF);
  for (let seq = 4; seq <= maxRows + 10; seq += 1) apply(state, noteRow(seq), SELF);
  const removed = trimChannelState(state, { maxRows, maxBytes: 8 * 1024 * 1024 });
  return { state, removed };
}

describe('等待区终态不倒退（Replica fold 为唯一权威）', () => {
  it('R1：窗口摘掉已终态 turn 后，local echo 恒不把它复活进等待区', () => {
    const { state, removed } = foldWithTrimmedTerminalTurn();
    expect(removed).toBeGreaterThan(0);
    // 前提：canonical turn 已被窗口摘掉，但 Replica 仍握着紧凑终态证明。
    expect(state.turns.has('work')).toBe(false);
    expect(state._unmatchedTerminalClosures.has('work')).toBe(true);

    const localTurns = selectLocalWaitingTurns([submission('work', 'uncertain')], SELF);
    expect(localTurns).toHaveLength(1);
    const waiting = selectWaitingPresentation(state, { controlCurrent: true, localTurns });
    expect(waiting.map((turn) => turn.requestId)).toEqual([]);
  });

  it('R1b：continuity 也不能把窗口外的已终态请求留在等待区', () => {
    const { state } = foldWithTrimmedTerminalTurn();
    const waiting = selectWaitingPresentation(state, {
      controlCurrent: true,
      continuityIDs: new Set(['work']),
    });
    expect(waiting.map((turn) => turn.requestId)).toEqual([]);
  });

  it('R2：没有精确 closure 时，Replica 不得把历史空洞里的 request 猜成已终态', () => {
    const { state } = foldWithTrimmedTerminalTurn();
    // 模拟破坏性回收：精确 closure 不在了。此后 Replica 已经没有按 request id
    // 可验证的终态证明；被裁过的 seq 区间只能说明“这些行曾装入”，不能说明空洞
    // 里的任意 request 都已终态。正确方向只能保守地继续展示 queued。
    state._unmatchedTerminalClosures.clear();
    apply(state, requestRow(1, 'work'), SELF);
    apply(state, queuedRow(2, 'work'), SELF);
    const turn = state.turns.get('work');
    expect(turn).toBeTruthy();
    const waiting = selectWaitingPresentation(state, { controlCurrent: true });
    expect(waiting.map((item) => item.requestId)).toEqual(['work']);
  });

  it('R2b：窗口从未装入过的更老请求仍可以是真的 queued（恒不过度声明）', () => {
    const { state } = foldWithTrimmedTerminalTurn();
    // seq 0 从来没进过内存窗口（本会话最早装入的是 seq 1），归档不得覆盖它。
    apply(state, requestRow(0, 'older'), SELF);
    apply(state, { channel_id: CHANNEL, seq: 0.5, envelope: null }, SELF);
    apply(state, row(1000, {
      id: 'older-queued', parent_id: 'older', kind: 'response', type: 'agent.ask', sender: AGENT,
      audience: [SELF], visibility: 'public', payload: { body: { status: 'queued', controls: [] } },
    }), SELF);
    const waiting = selectWaitingPresentation(state, { controlCurrent: true });
    expect(waiting.map((item) => item.requestId)).toEqual(['older']);
  });

  it('R3：窗口摘掉 request 行但 turn 因终态在窗口内而存活，历史页重装 request 恒不抹掉终态', () => {
    const state = createChannelState(CHANNEL);
    apply(state, requestRow(1, 'work'), SELF);
    apply(state, queuedRow(2, 'work'), SELF);
    for (let seq = 3; seq <= 99; seq += 1) apply(state, noteRow(seq), SELF);
    apply(state, terminalRow(100, 'work'), SELF);
    expect(trimChannelState(state, { maxRows: 40, maxBytes: 8 * 1024 * 1024 })).toBeGreaterThan(0);
    // 终态行还在窗口里，所以 turn 本体存活；但 request/queued 两行已被摘掉。
    expect(state.turns.get('work')?.terminal).toBeTruthy();
    expect(state.rows.has(1)).toBe(false);

    // 往回翻：历史页把 request + queued 原样送回来。
    apply(state, requestRow(1, 'work'), SELF);
    apply(state, queuedRow(2, 'work'), SELF);
    expect(state.turns.get('work')?.terminal).toBeTruthy();
    const waiting = selectWaitingPresentation(state, { controlCurrent: true });
    expect(waiting.map((item) => item.requestId)).toEqual([]);
  });

  it('R3b：重装 request 恒不丢失已装入的进度帧与终态序号', () => {
    const state = createChannelState(CHANNEL);
    apply(state, requestRow(1, 'work'), SELF);
    apply(state, queuedRow(2, 'work'), SELF);
    for (let seq = 3; seq <= 99; seq += 1) apply(state, noteRow(seq), SELF);
    apply(state, terminalRow(100, 'work', 'failed'), SELF);
    trimChannelState(state, { maxRows: 40, maxBytes: 8 * 1024 * 1024 });
    const before = state.turns.get('work');
    const provisionalBefore = before.provisional.length;
    apply(state, requestRow(1, 'work'), SELF);
    const after = state.turns.get('work');
    expect(after.status).toBe('failed');
    expect(after.terminalSeq).toBe(100);
    expect(after.provisional.length).toBe(provisionalBefore);
  });

  it('未终态的请求恒不被归档误伤：开着的 turn 整段留在窗口内', () => {
    const state = createChannelState(CHANNEL);
    apply(state, requestRow(1, 'open-work'), SELF);
    apply(state, queuedRow(2, 'open-work'), SELF);
    for (let seq = 3; seq <= 60; seq += 1) apply(state, noteRow(seq), SELF);
    trimChannelState(state, { maxRows: 40, maxBytes: 8 * 1024 * 1024 });
    expect(state.turns.has('open-work')).toBe(true);
    const waiting = selectWaitingPresentation(state, { controlCurrent: true });
    expect(waiting.map((item) => item.requestId)).toEqual(['open-work']);
  });
});

describe('只有精确 closure 才能替窗口外的 terminal 作证', () => {
  it('精确 closure 被破坏后，human.approve 保守地重新成为待办', () => {
    const state = createChannelState(CHANNEL);
    const ask = (seq, id) => row(seq, {
      id, kind: 'request', type: 'human.approve', sender: AGENT,
      audience: [SELF], visibility: 'public', payload: { body: { text: 'approve me' } },
    });
    apply(state, ask(1, 'ask'), SELF);
    expect(state.approvals.has('ask')).toBe(true);
    apply(state, terminalRow(2, 'ask'), SELF);
    expect(state.approvals.has('ask')).toBe(false);
    for (let seq = 3; seq <= 60; seq += 1) apply(state, noteRow(seq), SELF);
    trimChannelState(state, { maxRows: 40, maxBytes: 8 * 1024 * 1024 });
    state._unmatchedTerminalClosures.clear();
    apply(state, ask(1, 'ask'), SELF);
    expect(state.turns.get('ask')?.terminal).toBeNull();
    expect(state.approvals.has('ask')).toBe(true);
    reconcileApprovals(state, SELF);
    expect(state.approvals.has('ask')).toBe(true);
  });
});

describe('compact closure 正确性优先于伪有界指标', () => {
  it('超过 512 条时仍保留每个 request id 的精确终态证明', () => {
    const state = createChannelState(CHANNEL);
    let seq = 1;
    const ids = [];
    for (let index = 0; index < 700; index += 1) {
      const id = `work-${index}`;
      ids.push({ id, requestSeq: seq });
      apply(state, requestRow(seq++, id), SELF);
      apply(state, queuedRow(seq++, id), SELF);
      apply(state, terminalRow(seq++, id), SELF);
      trimChannelState(state, { maxRows: 30, maxBytes: 8 * 1024 * 1024 });
    }
    const evicted = ids.filter((item) => !state.turns.has(item.id));
    expect(evicted.length).toBeGreaterThan(512);
    expect(state._unmatchedTerminalClosures.size).toBe(evicted.length);
    // 任选最老一条，history 回读 request+queued 后仍由原 compact closure 收口。
    const oldest = evicted[0];
    apply(state, requestRow(oldest.requestSeq, oldest.id), SELF);
    apply(state, queuedRow(oldest.requestSeq + 1, oldest.id), SELF);
    expect(state.turns.get(oldest.id)?.terminal).toBeTruthy();
    expect(selectWaitingPresentation(state, { controlCurrent: true }).map((item) => item.requestId)).toEqual([]);
  });

  it('terminal 先于 request 的历史后缀超过 512 条时也不能丢精确保护', () => {
    const state = createChannelState(CHANNEL);
    const ids = [];
    for (let index = 0; index < 700; index += 1) {
      const id = `work-${index}`;
      ids.push(id);
      apply(state, terminalRow(10_000 + index, id), SELF);
    }
    expect(state._unmatchedTerminalClosures.size).toBe(700);
    const localTurns = selectLocalWaitingTurns(ids.slice(0, 5).map((id) => submission(id, 'uncertain')), SELF);
    expect(localTurns.length).toBe(5);
    const waiting = selectWaitingPresentation(state, { controlCurrent: true, localTurns });
    expect(waiting.map((item) => item.requestId)).toEqual([]);
  });

  it('真实 history/live/trim 交错：非连续历史空洞里的 queued 恒不被区间压缩吞掉', () => {
    const state = createChannelState(CHANNEL);

    // 模拟 257 个彼此不连续的 history 小段。每个已装入小段都有完整 request+terminal，
    // 但段间空洞从未装入；随后 live 头到达并触发移动端 trim。
    for (let index = 0; index < 270; index += 1) {
      const base = 1_000 + index * 10;
      const id = `closed-${index}`;
      apply(state, requestRow(base, id), SELF);
      apply(state, terminalRow(base + 1, id), SELF);
    }
    apply(state, noteRow(100_000), SELF);
    expect(trimChannelState(state, { maxRows: 2, maxBytes: 8 * 1024 * 1024 })).toBeGreaterThan(0);

    // seq=1003 位于第一个真实空洞。它随后由更老 history 页补回，queued 状态则从
    // 当前 live 头到达。Replica 从未见过它的 terminal，所以 Waiting 必须展示它。
    apply(state, requestRow(1_003, 'real-open-in-gap'), SELF);
    apply(state, queuedRow(200_000, 'real-open-in-gap'), SELF);
    expect(state.turns.get('real-open-in-gap')?.terminal).toBeNull();
    expect(selectWaitingPresentation(state, { controlCurrent: true }).map((item) => item.requestId))
      .toContain('real-open-in-gap');
  });
});
