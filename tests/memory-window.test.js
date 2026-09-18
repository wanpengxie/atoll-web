import { describe, expect, it } from 'vitest';
import { apply, createChannelState, requestClosure, terminalResultPayload, terminalResultState, terminalRetainedValue } from '../src/model/fold.js';
import { estimateRowBytes, MOBILE_WINDOW, trimChannelState } from '../src/model/memory-window.js';
import { notificationDisposition } from '../src/model/notification-policy.js';
import { relatedEnvelopeIds, relatedEnvelopeIdsIncremental } from '../src/model/timeline-scope.js';
import { selectWaitingPresentation } from '../src/model/waiting-presentation.js';
import { mergedInto, preemptedBy } from '../src/model/agent-control.js';

const ME = 'human:me:1';

function ask(seq, id, { text = 'hi', open = false } = {}) {
  return { channel_id: 'c', seq, envelope: { id, kind: 'request', type: 'agent.ask', sender: { id: ME }, audience: ['agent:a:1'], payload: { text }, correlation_id: id } };
}
function answer(seq, id, parent) {
  return { channel_id: 'c', seq, envelope: { id, kind: 'response', type: 'agent.ask', parent_id: parent, sender: { id: 'agent:a:1' }, audience: [ME], payload: { status: 'completed', text: 'ok' }, correlation_id: parent } };
}

function progress(seq, id, parent, status = 'queued') {
  return { channel_id: 'c', seq, envelope: { id, kind: 'response', type: 'agent.ask', parent_id: parent, sender: { id: 'agent:a:1' }, audience: [ME], payload: { status, controls: [] }, correlation_id: parent } };
}

function forceTrimPast(state, fromSeq = 301) {
  for (let seq = fromSeq; seq < fromSeq + 24; seq += 1) {
    apply(state, { channel_id: 'c', seq, envelope: { id: `noise-${seq}`, kind: 'event', type: 'human.note', payload: { text: 'noise' } } }, ME);
  }
  trimChannelState(state, { maxRows: 8, maxBytes: 1e9 });
}

function channelWith(pairs, { openLast = false } = {}) {
  const state = createChannelState('c');
  let seq = 1;
  for (let index = 0; index < pairs; index += 1) {
    const id = `q-${index}`;
    apply(state, ask(seq++, id), ME);
    if (!(openLast && index === pairs - 1)) apply(state, answer(seq++, `a-${index}`, id), ME);
  }
  return state;
}

describe('内存窗口', () => {
  it('超过水位才动手,一次砍到八成,并且留下的是最近的', () => {
    const state = channelWith(40);
    expect(state.rows.size).toBe(80);
    expect(trimChannelState(state, { maxRows: 100, maxBytes: 1e9 })).toBe(0);

    const removed = trimChannelState(state, { maxRows: 40, maxBytes: 1e9 });
    expect(removed).toBeGreaterThan(0);
    expect(state.rows.size).toBeLessThanOrEqual(40);
    expect(Math.max(...state.rows.keys())).toBe(80);
    // 摘掉的行不能在任何一张索引里留下影子。
    for (const id of state._seenIds) expect(state._envelopesById.has(id)).toBe(true);
    expect(state._seenIds.size).toBe(state._envelopesById.size);
    expect(state._envelopesById.size).toBe(state.rows.size);
    expect(state._rowMaxSeq).toHaveLength(state._rowOrder.length);
    expect(state._rowMaxSeq.every((value, index) => index === 0 || value >= state._rowMaxSeq[index - 1])).toBe(true);
  });

  it('低水位只决定一次保留多少,不会让每条新消息都触发裁剪', () => {
    const state = channelWith(21);
    trimChannelState(state, { maxRows: 40, maxBytes: 1e9 });
    expect(state.rows.size).toBeLessThan(40);
    const next = Math.max(...state.rows.keys()) + 1;
    apply(state, { channel_id: 'c', seq: next, envelope: { id: 'tail', kind: 'event', type: 'human.note', payload: { text: 'tail' } } }, ME);
    expect(trimChannelState(state, { maxRows: 40, maxBytes: 1e9 })).toBe(0);
  });

  // 半段 turn 恒不能渲染:开着的那一段整段留住,哪怕它比水位老。
  it('还没闭合的 turn 整段留住', () => {
    const state = channelWith(40, { openLast: true });
    const openTurn = [...state.turns.values()].find((turn) => !turn.terminal);
    trimChannelState(state, { maxRows: 4, maxBytes: 1e9 });
    expect(state.turns.has(openTurn.requestId)).toBe(true);
    expect(state.rows.has(openTurn.requestSeq)).toBe(true);
  });

  it('保留先到 terminal 的 compact closure，窗口裁剪后旧 queued 不能复活', () => {
    const state = createChannelState('c');
    const terminal = answer(300, 'terminal-first', 'older-request');
    apply(state, terminal, ME);
    forceTrimPast(state);

    expect(state.rows.has(300)).toBe(false);
    expect(state._unmatchedByParent.has('older-request')).toBe(false);
    expect(state._unmatchedTerminalClosures.get('older-request')).toMatchObject({ seq: 300 });

    // Re-reading the same terminal after its full row was trimmed is
    // idempotent and must not create a conflicting second terminal at drain.
    apply(state, terminal, ME);
    apply(state, ask(100, 'older-request'), ME);
    apply(state, progress(101, 'older-queued', 'older-request'), ME);

    const turn = state.turns.get('older-request');
    expect(turn).toMatchObject({ terminalSeq: 300, latestStatus: 'completed' });
    expect(state.anomalies.filter((entry) => entry.code === 'terminal_conflict')).toEqual([]);
    expect(selectWaitingPresentation(state, { controlCurrent: true })).toEqual([]);
  });

  it('多个乱序 unmatched terminal 由 earliest seq 吸收', () => {
    const state = createChannelState('c');
    apply(state, answer(300, 'later-terminal', 'older-request'), ME);
    apply(state, answer(200, 'earlier-terminal', 'older-request'), ME);
    forceTrimPast(state, 401);

    expect(state._unmatchedTerminalClosures.get('older-request')).toMatchObject({ seq: 200 });
    apply(state, ask(100, 'older-request'), ME);
    apply(state, progress(101, 'older-queued', 'older-request'), ME);
    expect(state.turns.get('older-request')).toMatchObject({ terminalSeq: 200, latestStatus: 'completed' });
    expect(selectWaitingPresentation(state, { controlCurrent: true })).toEqual([]);
  });

  it('已匹配 terminal 被裁剪后仍以 compact closure 阻止旧 queued 复活', () => {
    const state = createChannelState('c');
    apply(state, ask(100, 'closed-request'), ME);
    apply(state, progress(101, 'closed-queued', 'closed-request'), ME);
    apply(state, answer(300, 'closed-terminal', 'closed-request'), ME);
    expect(state.turns.get('closed-request')).toMatchObject({ terminalSeq: 300, latestStatus: 'completed' });

    forceTrimPast(state, 401);

    expect(state.turns.has('closed-request')).toBe(false);
    expect(state.rows.has(300)).toBe(false);
    expect(state._unmatchedTerminalClosures.get('closed-request')).toMatchObject({
      seq: 300,
      closureOnly: true,
      envelope: { id: 'closed-terminal', parent_id: 'closed-request', payload: { status: 'completed' } },
    });
    expect(state._unmatchedTerminalClosures.get('closed-request').envelope.payload).not.toHaveProperty('text');

    // A later page may end before the terminal suffix which was already
    // scanned and trimmed. The request atomically drains its retained closure;
    // the following stale queued row cannot reopen it.
    apply(state, ask(100, 'closed-request'), ME);
    expect(state._unmatchedTerminalClosures.has('closed-request')).toBe(false);
    apply(state, progress(101, 'closed-queued', 'closed-request'), ME);
    expect(state.turns.get('closed-request')).toMatchObject({
      terminalSeq: 300,
      latestStatus: 'completed',
      terminalClosureOnly: true,
      terminal: { payload: { status: 'completed' } },
    });
    expect(state.turns.get('closed-request').terminal.payload).not.toHaveProperty('text');
    expect(requestClosure(state, 'closed-request')?.source).toBe('closure');
    expect(terminalResultPayload(state.turns.get('closed-request'))).toBeNull();
    expect(terminalResultState(state.turns.get('closed-request'))).toEqual({
      phase: 'unavailable', error: '终态详情不可用，请刷新或重新进入频道',
    });
    expect(selectWaitingPresentation(state, { controlCurrent: true })).toEqual([]);

    // The exact terminal row may be restored by a later history/cache page.
    // It upgrades lifecycle-only evidence to the full body; it is not a
    // conflicting second terminal.
    const restoredTerminal = answer(300, 'closed-terminal', 'closed-request');
    apply(state, restoredTerminal, ME);
    expect(state.turns.get('closed-request')).toMatchObject({
      terminalSeq: 300,
      terminalClosureOnly: false,
      terminal: { id: 'closed-terminal', payload: { status: 'completed', text: 'ok' } },
      text: 'ok',
    });
    expect(requestClosure(state, 'closed-request')?.source).toBe('turn');
    expect(terminalResultPayload(state.turns.get('closed-request'))).toMatchObject({ status: 'completed', text: 'ok' });
    expect(terminalResultState(state.turns.get('closed-request'))).toEqual({ phase: 'available', error: '' });
    expect(notificationDisposition(state, restoredTerminal.envelope, ME)).toBe('final');
    expect(state.anomalies.filter((entry) => entry.code === 'terminal_conflict')).toEqual([]);
  });

  it('nested steer 关系在 compact owner 归一后仍可驱动 merge/preempt', () => {
    const state = createChannelState('c');
    const request = {
      channel_id: 'c', seq: 100,
      envelope: { id: 'steer', kind: 'request', type: 'agent.steer', sender: { id: ME }, audience: ['agent:a:1'], payload: { text: '改道' } },
    };
    const terminal = {
      channel_id: 'c', seq: 300,
      envelope: {
        id: 'steer-terminal', parent_id: 'steer', kind: 'response', type: 'agent.steer',
        sender: { id: 'agent:a:1' }, audience: [ME],
        payload: { status: 'completed', value: { merged_into: 'turn-7', preempted_by: 'replacement-8', replaced_by: 'turn-9' } },
      },
    };
    apply(state, request, ME);
    apply(state, terminal, ME);
    forceTrimPast(state, 401);
    apply(state, request, ME);

    const turn = state.turns.get('steer');
    expect(turn).toMatchObject({
      terminalClosureOnly: true,
      terminal: { payload: { status: 'completed', merged_into: 'turn-7', preempted_by: 'replacement-8', replaced_by: 'turn-9' } },
    });
    expect(turn.terminal.payload).not.toHaveProperty('value');
    expect(mergedInto(turn)).toBe('turn-7');
    expect(preemptedBy(turn)).toBe('replacement-8');
    expect(terminalRetainedValue(turn, 'replaced_by')).toBe('turn-9');
  });

  it('compact closure 只接受同一 ledger terminal 的 full envelope 升级', () => {
    const state = createChannelState('c');
    apply(state, answer(300, 'canonical-terminal', 'work'), ME);
    forceTrimPast(state, 401);
    apply(state, ask(100, 'work'), ME);

    const closure = state.turns.get('work').terminal;
    expect(state.turns.get('work').terminalClosureOnly).toBe(true);

    // A distinct terminal cannot use the upgrade path merely because it has
    // the same parent and terminal status.
    apply(state, answer(301, 'conflicting-terminal', 'work'), ME);
    expect(state.turns.get('work').terminal).toBe(closure);
    expect(state.turns.get('work').terminalClosureOnly).toBe(true);
    expect(state.anomalies.filter((entry) => entry.code === 'terminal_conflict')).toHaveLength(1);

    // The canonical row still upgrades after the conflicting row, and an
    // exact repeat remains idempotent rather than becoming another conflict.
    apply(state, answer(300, 'canonical-terminal', 'work'), ME);
    const canonical = state.turns.get('work').terminal;
    expect(state.turns.get('work').terminalClosureOnly).toBe(false);
    expect(canonical.payload.text).toBe('ok');
    state._seenIds.delete('canonical-terminal');
    state._envelopesById.delete('canonical-terminal');
    apply(state, answer(300, 'canonical-terminal', 'work'), ME);
    expect(state.turns.get('work').terminal).toBe(canonical);
    expect(state.anomalies.filter((entry) => entry.code === 'terminal_conflict')).toHaveLength(1);
  });

  it('compact closure 已吸收后仍由更早 ledger terminal 取得 canonical 位置', () => {
    const state = createChannelState('c');
    apply(state, answer(300, 'later-terminal', 'work'), ME);
    forceTrimPast(state, 401);
    apply(state, ask(100, 'work'), ME);
    expect(state.turns.get('work')).toMatchObject({
      terminalSeq: 300,
      terminalClosureOnly: true,
      terminal: { id: 'later-terminal' },
    });

    apply(state, answer(200, 'earlier-terminal', 'work'), ME);
    expect(state.turns.get('work')).toMatchObject({
      terminalSeq: 200,
      terminalClosureOnly: false,
      terminal: { id: 'earlier-terminal', payload: { status: 'completed', text: 'ok' } },
    });
    expect(state.anomalies.filter((entry) => entry.code === 'terminal_conflict')).toMatchObject([
      { seq: 300, envelopeId: 'later-terminal', requestId: 'work' },
    ]);
  });

  it('terminal closure retention is isolated by channel state even for the same request id', () => {
    const closed = createChannelState('closed-channel');
    const open = createChannelState('open-channel');
    const channelRow = (channelId, row) => ({ ...row, channel_id: channelId });

    apply(closed, channelRow('closed-channel', ask(100, 'same-request')), ME);
    apply(closed, channelRow('closed-channel', progress(101, 'closed-queued', 'same-request')), ME);
    apply(closed, channelRow('closed-channel', answer(300, 'closed-terminal', 'same-request')), ME);
    for (let seq = 401; seq < 425; seq += 1) apply(closed, {
      channel_id: 'closed-channel', seq,
      envelope: { id: `closed-noise-${seq}`, kind: 'event', type: 'human.note', payload: { text: 'noise' } },
    }, ME);
    trimChannelState(closed, { maxRows: 8, maxBytes: 1e9 });

    apply(open, channelRow('open-channel', ask(100, 'same-request')), ME);
    apply(open, channelRow('open-channel', progress(101, 'open-queued', 'same-request')), ME);

    expect(closed._unmatchedTerminalClosures.has('same-request')).toBe(true);
    expect(open._unmatchedTerminalClosures.has('same-request')).toBe(false);
    expect(selectWaitingPresentation(open, { controlCurrent: true }).map((turn) => turn.requestId)).toEqual(['same-request']);
  });

  it('unmatched process/provisional 正文仍随窗口淘汰，不生成 closure', () => {
    const state = createChannelState('c');
    apply(state, progress(300, 'process-first', 'older-request', 'processing'), ME);
    forceTrimPast(state);
    expect(state._unmatchedByParent.has('older-request')).toBe(false);
    expect(state._unmatchedTerminalClosures.has('older-request')).toBe(false);
  });

  it('闭合且整段在窗口外的 turn 连同它的相关索引一起摘掉', () => {
    const state = channelWith(40);
    trimChannelState(state, { maxRows: 10, maxBytes: 1e9 });
    expect(state.turns.size).toBeLessThan(40);
    for (const ids of state.correlations.values()) {
      for (const id of ids) expect(state.turns.has(id)).toBe(true);
    }
    for (const turn of state.turns.values()) expect(state.rows.has(turn.requestSeq)).toBe(true);
  });

  // 窗口一动,增量索引的基线就不成立了——必须能重建出与全量版一致的答案。
  it('裁剪之后「我的往来」索引仍与全量版相等', () => {
    const state = channelWith(30);
    relatedEnvelopeIdsIncremental(state, ME);
    trimChannelState(state, { maxRows: 10, maxBytes: 1e9 });
    expect([...relatedEnvelopeIdsIncremental(state, ME)].sort()).toEqual([...relatedEnvelopeIds(state, ME)].sort());
  });

  // 往回翻会把窗口外的行补回来。增量索引按 seq 单向前进,认不出"更早的行又回来了",
  // 所以它必须自己发现基线不成立并重建——否则刚读回来的历史在「我的往来」里是隐形的。
  it('历史回读之后,索引把补回来的行也算进「我的往来」', () => {
    const state = createChannelState('c');
    let seq = 1;
    const rows = [];
    for (let index = 0; index < 12; index += 1) {
      const id = `q-${index}`;
      rows.push(ask(seq++, id), answer(seq++, `a-${index}`, id));
    }
    for (const row of rows) apply(state, row, ME);
    relatedEnvelopeIdsIncremental(state, ME);
    trimChannelState(state, { maxRows: 8, maxBytes: 1e9 });
    const afterTrim = relatedEnvelopeIdsIncremental(state, ME);
    expect(afterTrim.has('q-0')).toBe(false);

    // 回读:把最早那一对补回来。
    apply(state, rows[0], ME);
    apply(state, rows[1], ME);
    const afterBackfill = relatedEnvelopeIdsIncremental(state, ME);
    expect(afterBackfill.has('q-0')).toBe(true);
    expect([...afterBackfill].sort()).toEqual([...relatedEnvelopeIds(state, ME)].sort());
  });

  it('字节水位只会让窗口更小,恒不让它更大', () => {
    const fat = createChannelState('c');
    let seq = 1;
    for (let index = 0; index < 20; index += 1) {
      apply(fat, ask(seq++, `q-${index}`, { text: 'x'.repeat(50_000) }), ME);
      apply(fat, answer(seq++, `a-${index}`, `q-${index}`), ME);
    }
    trimChannelState(fat, { maxRows: 40, maxBytes: 200_000 });
    expect(fat.rows.size).toBeLessThan(40);
  });

  it('水位记在 evictedThrough 上:窗口外的行恒不再被当成新行', () => {
    const state = channelWith(20);
    trimChannelState(state, { maxRows: 8, maxBytes: 1e9 });
    expect(state.evictedThrough).toBeGreaterThan(0);
    expect(Math.min(...state.rows.keys())).toBeGreaterThan(state.evictedThrough);
  });

  it('估字节只量顶层字符串,恒不整条序列化', () => {
    expect(estimateRowBytes({ payload: { text: 'x'.repeat(1000) } })).toBeGreaterThan(1000);
    expect(estimateRowBytes({})).toBeGreaterThan(0);
  });

  it('移动端水位是 500 行 / 8MB', () => {
    expect(MOBILE_WINDOW).toEqual({ maxRows: 500, maxBytes: 8 * 1024 * 1024 });
  });
});
