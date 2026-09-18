import { describe, expect, it, vi } from 'vitest';
import {
  acceptAgentProbe,
  advanceAgentProbeGeneration,
  agentProbeEntry,
  beginAgentProbe,
  clearProbeSlots,
  createAgentProbeLifecycle,
  failAgentProbe,
  observeAgentProbe,
  PROBE_MIN_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  releaseAgentProbe,
  retryFailedAgentProbe,
} from '../src/model/agent-probe-lifecycle.js';

describe('automatic actor probe lifecycle', () => {
  it('stops after a failed terminal until an explicit retry', () => {
    const lifecycle = createAgentProbeLifecycle();
    advanceAgentProbeGeneration(lifecycle);
    const send = vi.fn(() => 'describe-1');
    const first = beginAgentProbe(lifecycle, 'c0:agent');
    acceptAgentProbe(lifecycle, first, send());

    observeAgentProbe(lifecycle, 'c0:agent', {
      requestId: 'describe-1', loading: false, describe: null, error: { code: 'unavailable' },
    });
    expect(beginAgentProbe(lifecycle, 'c0:agent')).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);

    expect(retryFailedAgentProbe(lifecycle, 'c0:agent')).toBe(true);
    const retry = beginAgentProbe(lifecycle, 'c0:agent');
    acceptAgentProbe(lifecycle, retry, send());
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps one request across the receipt-before-feed gap', () => {
    const lifecycle = createAgentProbeLifecycle();
    advanceAgentProbeGeneration(lifecycle);
    const send = vi.fn(() => 'describe-1');
    const first = beginAgentProbe(lifecycle, 'c0:agent');
    acceptAgentProbe(lifecycle, first, send());

    // capabilityIndex has no row yet, but the durable receipt already named
    // the request. Re-running the effect must not submit describe-2.
    expect(agentProbeEntry(lifecycle, 'c0:agent')).toMatchObject({
      requestId: 'describe-1', phase: 'awaiting-ledger',
    });
    const duplicate = beginAgentProbe(lifecycle, 'c0:agent');
    if (duplicate) acceptAgentProbe(lifecycle, duplicate, send());
    expect(duplicate).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect([...lifecycle.liveRequestIds]).toEqual(['describe-1']);
  });

  it('does not let an old connection Promise unlock the new generation', () => {
    const lifecycle = createAgentProbeLifecycle();
    const send = vi.fn()
      .mockReturnValueOnce('stale-describe')
      .mockReturnValueOnce('current-describe');
    const t0 = 1_700_000_000_000;
    advanceAgentProbeGeneration(lifecycle);
    const oldConnection = beginAgentProbe(lifecycle, 'c0:agent', { now: t0 });
    send();

    advanceAgentProbeGeneration(lifecycle);
    // 换代不再等于放行：必须同时越过频次闸门，所以这里推进一分钟。
    const t1 = t0 + PROBE_MIN_INTERVAL_MS;
    const newConnection = beginAgentProbe(lifecycle, 'c0:agent', { now: t1 });
    const currentRequestId = send();
    expect(acceptAgentProbe(lifecycle, oldConnection, 'stale-describe')).toBe(false);
    expect(failAgentProbe(lifecycle, oldConnection)).toBe(false);
    const duplicate = beginAgentProbe(lifecycle, 'c0:agent', { now: t1 });
    if (duplicate) send();
    expect(duplicate).toBeNull();

    acceptAgentProbe(lifecycle, newConnection, currentRequestId);
    expect(send).toHaveBeenCalledTimes(2);
    expect([...lifecycle.liveRequestIds]).toEqual(['current-describe']);
    expect(agentProbeEntry(lifecycle, 'c0:agent')).toMatchObject({
      generation: 2, requestId: 'current-describe', phase: 'awaiting-ledger',
    });
  });

  // 以下两条锁死 owner 2026-09-18 的硬闸门。它们对应的真实事故是：前端服务挂掉后
  // 浏览器不停重连，每次重连都清空抑制表，三小时发出 1200 条探测塞满对端在站账。
  it('rate-limits reconnect storms: one probe per minute even across generations', () => {
    const lifecycle = createAgentProbeLifecycle();
    const send = vi.fn(() => 'describe');
    const t0 = 1_700_000_000_000;
    advanceAgentProbeGeneration(lifecycle);
    const first = beginAgentProbe(lifecycle, 'c0:agent', { now: t0 });
    expect(first).not.toBeNull();
    acceptAgentProbe(lifecycle, first, send());

    // 一分钟内断线重连 20 次：一条都不许再发。
    for (let i = 1; i <= 20; i += 1) {
      advanceAgentProbeGeneration(lifecycle);
      const blocked = beginAgentProbe(lifecycle, 'c0:agent', { now: t0 + i * 1_000 });
      if (blocked) acceptAgentProbe(lifecycle, blocked, send());
      expect(blocked).toBeNull();
    }
    expect(send).toHaveBeenCalledTimes(1);

    // 越过一分钟后放行一条。
    advanceAgentProbeGeneration(lifecycle);
    const allowed = beginAgentProbe(lifecycle, 'c0:agent', { now: t0 + PROBE_MIN_INTERVAL_MS });
    expect(allowed).not.toBeNull();
    acceptAgentProbe(lifecycle, allowed, send());
    expect(send).toHaveBeenCalledTimes(2);
  });

  // 2026-09-18 "又不能切换了"的根因：手动刷新把上一条的 requestId 从 liveRequestIds
  // 摘掉，能力索引只认活请求，于是新结果到达前能力先变空，面板刚开就被重置关掉。
  // 刷新是追加证据，不是先清空再取。
  it('a manual release keeps the last good request id live until a newer probe lands', () => {
    const lifecycle = createAgentProbeLifecycle();
    const t0 = 1_700_000_000_000;
    advanceAgentProbeGeneration(lifecycle);
    const first = beginAgentProbe(lifecycle, 'c0:agent', { now: t0 });
    acceptAgentProbe(lifecycle, first, 'describe-1');
    expect([...lifecycle.liveRequestIds]).toEqual(['describe-1']);

    // App 的 authorizeProbe 是 clearProbeSlots + releaseAgentProbe 一起调：真人不受闸门。
    clearProbeSlots(lifecycle, 'c0:agent');
    releaseAgentProbe(lifecycle, 'c0:agent');
    expect([...lifecycle.liveRequestIds]).toEqual(['describe-1']);

    const second = beginAgentProbe(lifecycle, 'c0:agent', { now: t0 + 1 });
    expect(second).not.toBeNull();
    // 发出但尚未回执：旧证据仍在。
    expect([...lifecycle.liveRequestIds]).toEqual(['describe-1']);
    acceptAgentProbe(lifecycle, second, 'describe-2');
    // 新旧并存，由索引按 requestSeq 合并决定谁是当前值。
    expect([...lifecycle.liveRequestIds].sort()).toEqual(['describe-1', 'describe-2']);
  });

  it('a forced probe (roster "刷新能力" button) also keeps the previous id live', () => {
    const lifecycle = createAgentProbeLifecycle();
    advanceAgentProbeGeneration(lifecycle);
    const first = beginAgentProbe(lifecycle, 'c0:agent');
    acceptAgentProbe(lifecycle, first, 'describe-1');
    const forced = beginAgentProbe(lifecycle, 'c0:agent', { force: true });
    acceptAgentProbe(lifecycle, forced, 'describe-2');
    expect([...lifecycle.liveRequestIds].sort()).toEqual(['describe-1', 'describe-2']);
  });

  it('fails a probe the ledger never answers after one minute', () => {
    const lifecycle = createAgentProbeLifecycle();
    const t0 = 1_700_000_000_000;
    advanceAgentProbeGeneration(lifecycle);
    const probe = beginAgentProbe(lifecycle, 'c0:agent', { now: t0 });
    acceptAgentProbe(lifecycle, probe, 'describe-1');

    // 对端卡死：账本永远停在 loading，没有任何终态。
    const stuck = { requestId: 'describe-1', loading: true, describe: null };
    expect(observeAgentProbe(lifecycle, 'c0:agent', stuck, false, t0 + 59_000))
      .toMatchObject({ phase: 'awaiting-ledger' });
    expect(observeAgentProbe(lifecycle, 'c0:agent', stuck, false, t0 + PROBE_TIMEOUT_MS))
      .toMatchObject({ phase: 'failed' });
    expect([...lifecycle.liveRequestIds]).toEqual([]);
  });
});
