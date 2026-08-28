// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { useUiWords } from '../src/app/hooks/useUiWords.js';
import { apply, createChannelState } from '../src/model/fold.js';
import { snapshot } from '../src/model/ui-words.js';

afterEach(cleanup);

const SELF = 'human:root:1';
const SESSION = { id: 's-abc', label: 'Mac Chrome' };

// 造一条真的从账本折出来的 ui 请求——不手搓 state,因为手搓的 state 证明不了
// fold 会不会把它放进去。
function stateWith(type, body) {
  const state = createChannelState('c0');
  apply(state, {
    channel_id: 'c0', seq: 1,
    envelope: {
      id: 'req-1', channel_id: 'c0', kind: 'request', type,
      sender: { id: 'agent:claude:1' }, audience: [SELF],
      payload: { body }, visibility: 'public',
    },
  }, SELF);
  return state;
}

function Harness({ state, session, actions, resolve, version }) {
  const statesRef = useRef(new Map([['c0', state]]));
  const wireRef = useRef({ resolve });
  useUiWords({
    channelStatesRef: statesRef,
    version,
    session,
    selfIdFor: () => SELF,
    wireRef,
    actions,
    readSnapshot: () => snapshot({ session, channelId: 'c0', view: 'dynamic', channels: [{ id: 'c0' }] }),
    enabled: true,
  });
  return null;
}

describe('ui.* 到了浏览器会被执行并回帧', () => {
  it('ui.state 被受理并回一个带快照的 resolve', async () => {
    const resolve = vi.fn().mockResolvedValue({});
    const state = stateWith('ui.state', { session: SESSION.id });
    // 前置:fold 真的把它收进来了。这一条不成立,后面全是空转。
    expect(state.uiRequests.size).toBe(1);

    render(<Harness state={state} session={SESSION} actions={{ navigate: vi.fn(), open: vi.fn() }} resolve={resolve} version={1} />);

    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    const frame = resolve.mock.calls[0][0];
    expect(frame.req_id).toBe('req-1');
    expect(frame.result.route.channel_id).toBe('c0');
    expect(frame.error).toBeUndefined();
  });

  it('ui.navigate 真的调了切频道那个动作', async () => {
    const resolve = vi.fn().mockResolvedValue({});
    const navigate = vi.fn();
    const state = stateWith('ui.navigate', { session: SESSION.id, channel_id: 'c0' });
    render(<Harness state={state} session={SESSION} actions={{ navigate, open: vi.fn() }} resolve={resolve} version={1} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('c0', ''));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
  });

  // 请求要等终态回到账本才从 uiRequests 消失,期间会重复渲染。做过的不能再做一次
  // ——navigate 重复只是多余,任何有副作用的词就是错的。
  it('重复渲染不会把同一条执行两次', async () => {
    const resolve = vi.fn().mockResolvedValue({});
    const navigate = vi.fn();
    const state = stateWith('ui.navigate', { session: SESSION.id, channel_id: 'c0' });
    const props = { state, session: SESSION, actions: { navigate, open: vi.fn() }, resolve };
    const { rerender } = render(<Harness {...props} version={1} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    rerender(<Harness {...props} version={2} />);
    rerender(<Harness {...props} version={3} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  // 这个 effect 每次重渲染都会清理重跑,而算出一帧要 await。曾经中途看 cancelled
  // 直接 return,结果卡在"答案已经算出来了、但没发出去",而且它已经被记成做过了,
  // 于是永远不会重试——症状是"发过去石沉大海",跟功能看不出关系。
  it('执行途中重渲染,答案照样发得出去', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const resolve = vi.fn().mockResolvedValue({});
    const navigate = vi.fn(async () => { await gate; });
    const state = stateWith('ui.navigate', { session: SESSION.id, channel_id: 'c0' });
    const props = { state, session: SESSION, actions: { navigate, open: vi.fn() }, resolve };

    const { rerender } = render(<Harness {...props} version={1} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    // 正卡在动作里的时候连着重渲染几次。
    rerender(<Harness {...props} version={2} />);
    rerender(<Harness {...props} version={3} />);
    release();
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
  });

  // 点名了别的屏幕:这块屏什么都不做,也不回帧。
  it('点名别人的屏幕就完全不掺和', async () => {
    const resolve = vi.fn().mockResolvedValue({});
    const navigate = vi.fn();
    const state = stateWith('ui.navigate', { session: 's-phone', channel_id: 'c0' });
    render(<Harness state={state} session={SESSION} actions={{ navigate, open: vi.fn() }} resolve={resolve} version={1} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(navigate).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
