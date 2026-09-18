// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 句柄寿命（agent B 根因 / agent R 实施，2026-09-18）
//
// history reveal operation 比它的网络请求活得久：请求在 history.intent_satisfied
// 结束（useReadingSession 在 promise 的 .finally 里清空 runwayRequestRef），而
// operation 还要走完 settle → pending-baseline-commit → committed-awaiting-layout，
// 一直活到 Timeline 的 layout effect acknowledge 为止。
//
// 凡是落在这两个时刻之间的一次用户输入：
//   - 正向（older）必须仍能续期 token.inputEpoch，否则 Timeline 的 exactOwner
//     （viewport.session.inputEpoch === bound.inputEpoch）永假，acknowledge 永不
//     发生，admission 永远停在 committed-awaiting-layout，后续 demand 全被
//     currentBlockingAdmission 扣留 —— 顶部永久卡死，不可自愈。
//   - 反向（newer/browse）必须仍能取消该 operation，否则"往回滚一下"这条唯一的
//     人工出路也被同一个失效句柄堵死。
//
// 这两条都只依赖 admission 已有的写入口（advanceInputEpoch / cancel），不新增
// 写入者、不新增真相、不加补偿。admission 模块侧的契约由
// tests/history-presentation-admission.test.js 单独钉住（直接绿，证明缺陷不在
// 该模块）；本文件钉的是送达侧。
// ---------------------------------------------------------------------------
import React, { useLayoutEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReadingSession } from '../src/ui/timeline/useReadingSession.js';
import { createHistoryPresentationAdmission } from '../src/model/history-presentation-admission.js';

afterEach(cleanup);

const CHANNEL = 'c0';
const VIEW_KEY = 'c0:mine';
const GENERATION = 7;

const item = (id, seq) => ({
  kind: 'standalone',
  seq,
  envelope: { id, seq, sender: { id: 'agent:test:1' }, payload: { text: id } },
});

const baselineRows = [
  { id: 'b', seqLow: 20, seqHigh: 20 },
  { id: 'c', seqLow: 30, seqHigh: 30 },
];

const meta = (operationID, sourceRevision, {
  channel = CHANNEL,
  viewKey = VIEW_KEY,
  generation = GENERATION,
} = {}) => ({
  operationID,
  viewID: viewKey,
  epoch: `${channel}:${generation}`,
  sourceRevision,
});

// 把 operation 推到 committed-awaiting-layout —— 也就是请求已结束、Timeline 还
// 没 acknowledge 的那段窗口。useReadingSession 生成的 historyRevealIntent 原样
// 作为 token，所以 operationID / activationID / inputEpoch 与生产完全一致。
function driveToAwaitingLayout(admission, intent, {
  channel = CHANNEL,
  viewKey = VIEW_KEY,
  generation = GENERATION,
} = {}) {
  const baseline = [item('b', 20), item('c', 30)];
  const withOlder = [item('a', 10), ...baseline];
  // 生产里 render 只 evaluate，发布权在 Timeline 的 committed layout effect；这里
  // 照样分两步，免得 render 评估自己取得权威。
  const commitAdmit = (items, sourceRevision) => {
    const candidate = admission.evaluate(channel, items, meta(intent.operationID, sourceRevision, {
      channel, viewKey, generation,
    }));
    admission.commitCandidate(channel, candidate);
    return candidate.items;
  };
  admission.begin(channel, intent);
  commitAdmit(baseline, 11);
  admission.observe(channel, withOlder, meta(intent.operationID, 12, { channel, viewKey, generation }));
  admission.settle(channel);
  commitAdmit(withOlder, 12);
  expect(admission.prepareCommit(channel, {
    revision: 12,
    sourceRevision: 12,
    rows: [{ id: 'b', body: item('b', 20) }, { id: 'c', body: item('c', 30) }],
  })).toBe(true);
  expect(admission.snapshot(channel).phase).toBe('committed-awaiting-layout');
}

// 挂真实 admission 实例与真实请求端口，走 useReadingSession 自己的 requestHistory
// 生成 operationID —— 不手工编造句柄。
async function mountReadingSession({
  channel = CHANNEL,
  viewKey = VIEW_KEY,
  generation = GENERATION,
  admission = createHistoryPresentationAdmission(),
} = {}) {
  const intents = [];
  const request = vi.fn(({ historyRevealIntent }) => {
    if (historyRevealIntent) intents.push(historyRevealIntent);
    return Promise.resolve({ kind: 'satisfied' });
  });
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(), save: vi.fn(() => true), deactivate: vi.fn(),
  };
  const entities = new Map(baselineRows.map((row) => [row.id, row]));
  let port = null;
  function Harness() {
    const reading = useReadingSession({
      channelID: channel,
      viewKey,
      snapshot: { revision: 11, sourceRevision: 11, rows: baselineRows, entities },
      history: {
        status: {
          attached: true, generation, messageCurrent: true, headSeq: 900,
          localReplicaReady: true, loading: false, hasOlder: true,
          presentationRevision: 11,
          presentationAdmission: admission,
          presentationAdmissionState: admission.snapshot(channel),
        },
        request,
      },
      viewSessions,
      historyViewSpec: { scope: 'mine', actorFilter: new Set() },
    });
    useLayoutEffect(() => { port = reading; }, [reading]);
    return null;
  }
  const mounted = render(<Harness />);
  await waitFor(() => expect(port?.activationID).toBeTruthy());

  // 一次真实的到顶取数，并让它 settle —— 这一刻 .finally 清空 runwayRequestRef，
  // 而 operation 才刚要进入它剩下的两个相位。
  await act(async () => { await port.onAtTop({}); });
  await act(async () => {});
  expect(intents.length).toBeGreaterThan(0);
  return { admission, intent: intents.at(-1), port: () => port, unmount: mounted.unmount };
}

it('请求 settle 之后继续向上输入仍然续期同一个 admission operation', async () => {
  const { admission, intent, port } = await mountReadingSession();
  driveToAwaitingLayout(admission, intent);

  const boundBefore = admission.bindPresentation(CHANNEL, 12).inputEpoch;
  expect(boundBefore).toBe(intent.inputEpoch);

  // 用户没有停手，继续往上滚。
  act(() => port().onUserControl({ direction: 'older', gestureID: 'wheel-up-2', geometryRevision: 2 }));

  // Timeline 的 exactOwner 比的就是这两个值；它们必须仍然相等。
  const sessionEpoch = port().getSession().inputEpoch;
  expect(sessionEpoch).toBeGreaterThan(boundBefore);
  expect(admission.bindPresentation(CHANNEL, 12).inputEpoch).toBe(sessionEpoch);
  expect(admission.snapshot(CHANNEL).phase).toBe('committed-awaiting-layout');

  // 续期之后 Timeline 能正常 acknowledge，operation 正常收尾。
  expect(admission.acknowledge(CHANNEL, admission.snapshot(CHANNEL).committed.commitID)).toBe(true);
  expect(admission.snapshot(CHANNEL).phase).toBe('idle');
});

it('请求 settle 之后反向输入仍然能取消同一个 admission operation', async () => {
  const { admission, intent, port } = await mountReadingSession();
  driveToAwaitingLayout(admission, intent);

  // 用户往回滚一下 —— 这是产品里唯一的人工出路，必须走得通。
  act(() => port().onUserControl({ direction: 'newer', gestureID: 'wheel-down-1', geometryRevision: 3 }));

  expect(admission.snapshot(CHANNEL).phase).not.toBe('committed-awaiting-layout');
  expect(admission.snapshot(CHANNEL).phase).toBe('idle');
});

it('presentation choice 不取消 admission，也不取得浏览权', async () => {
  const { admission, intent, port } = await mountReadingSession();
  driveToAwaitingLayout(admission, intent);
  const before = port().getSession();

  let accepted;
  act(() => { accepted = port().takeFocusedContentControl({ source: 'user', reason: 'fold-choice' }); });

  expect(accepted).toBe(false);
  expect(port().getSession()).toBe(before);
  expect(admission.snapshot(CHANNEL).phase).toBe('committed-awaiting-layout');
  expect(admission.bindPresentation(CHANNEL, 12).inputEpoch).toBe(before.inputEpoch);
});

it('纯内容布局回调没有阅读意图权威，不取消 operation 也不新建浏览导航', async () => {
  const { admission, intent, port } = await mountReadingSession();
  driveToAwaitingLayout(admission, intent);
  const before = port().getSession();

  act(() => port().takeFocusedContentControl({ source: 'layout', reason: 'content-layout' }));

  expect(port().getSession()).toBe(before);
  expect(admission.snapshot(CHANNEL).phase).toBe('committed-awaiting-layout');
  expect(admission.bindPresentation(CHANNEL, 12).inputEpoch).toBe(before.inputEpoch);
});

it('切频道后新频道 focused edit 只取消自己的 operation，不取得退休频道句柄', async () => {
  const admission = createHistoryPresentationAdmission();
  const first = await mountReadingSession({ admission });
  driveToAwaitingLayout(admission, first.intent);
  first.unmount();

  const second = await mountReadingSession({
    admission,
    channel: 'c1',
    viewKey: 'c1:mine',
  });
  driveToAwaitingLayout(admission, second.intent, { channel: 'c1', viewKey: 'c1:mine' });
  const before = second.port().getSession().inputEpoch;

  act(() => second.port().takeFocusedContentControl({ source: 'user', reason: 'edit-message' }));

  expect(second.port().getSession()).toMatchObject({ mode: 'browsing', inputEpoch: before + 1 });
  expect(admission.snapshot('c1').phase).toBe('idle');
  expect(admission.snapshot(CHANNEL).phase).toBe('committed-awaiting-layout');
});

it('重连 generation 后用户上滑不续期退休 generation 的 operation', async () => {
  const { admission, intent, port } = await mountReadingSession();
  const retired = Object.freeze({ ...intent, epoch: `${CHANNEL}:${GENERATION - 1}` });
  admission.begin(CHANNEL, retired);
  const tokenEpoch = admission.snapshot(CHANNEL).token.inputEpoch;

  act(() => port().onUserControl({ direction: 'older', gestureID: 'wheel-after-reconnect' }));

  expect(port().getSession().inputEpoch).toBeGreaterThan(tokenEpoch);
  expect(admission.snapshot(CHANNEL)).toMatchObject({
    phase: 'pending',
    token: { operationID: retired.operationID, epoch: retired.epoch, inputEpoch: tokenEpoch },
  });
});
