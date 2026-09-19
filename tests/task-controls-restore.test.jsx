// @vitest-environment jsdom
// 恢复自 master:tests/task-controls.test.js（RT 域）。
// 旧结构 src/model/task-controls.js（taskControlContext / createWaitingTargetAuthority /
// controlLabel / extraControls）已删除。新结构把同一套按钮可用性判定重写成
// src/ui/timeline/useWaitingEditingController.jsx 内部的 waitingControlContext（未导出），
// 只能通过它渲染出的 WaitingLayer（导出组件）来断言可见行为——这也更贴合宪章
// "按行为恢复" 的要求：按钮是否出现才是用户可见事实,不是内部函数返回值。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { WaitingLayer } from '../src/ui/timeline/useWaitingEditingController.jsx';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

const SUPPORTED_CAPABILITY = { describe: { types: new Map([
  [ 'agent.replace', { inputSchema: { properties: { expected_hold_id: {} } } } ],
  [ 'agent.unhold', { inputSchema: { properties: { expected_hold_id: {} } } } ],
]) } };

function queuedTurn(id, { sender = { kind: 'human', id: 'me' }, audience = ['agent'], controls, steering = false, status = 'queued' } = {}) {
  const body = { status, ...(controls !== undefined ? { controls } : {}), ...(steering ? { steering: true } : {}) };
  return {
    requestId: id,
    request: { id, type: 'agent.ask', sender, audience, ts: 100, payload: { body: { text: id } } },
    terminal: null,
    local: false,
    provisional: [{ seq: 1, envelope: { payload: { body } } }],
  };
}

function baseState() {
  return { channelId: 'c1', timeline: [] };
}

function Harness({ turns, selfId = 'me', access = 'member_active', targetAuthority = null, capabilityIndex = new Map([['agent', SUPPORTED_CAPABILITY]]), onCancel = () => {}, onControl = () => {}, onEdit = () => {} }) {
  return <WaitingLayer
    turns={turns} state={baseState()} names={new Map()} selfId={selfId} access={access}
    targetAuthority={targetAuthority} capabilityIndex={capabilityIndex} editing={null}
    onCancel={onCancel} onControl={onControl} onEdit={onEdit}
  />;
}

const CURRENT_AUTHORITY = { current: true, actorIDs: new Set(['agent']) };

describe('等待区控制按钮可用性（新结构 WaitingLayer）', () => {
  it('requires a writable channel and an advertised control：可写频道 + 账本宣告的控制词才出按钮', () => {
    const turn = queuedTurn('q1', { controls: [
      { word: 'agent.replace' },
      { word: 'agent.dismiss', payload: { target: 'q1' } },
      { word: 'agent.steer', payload: { target: 'q1' } },
    ] });
    const writable = render(<Harness turns={[turn]} access="member_active" targetAuthority={CURRENT_AUTHORITY} />);
    expect(writable.container.querySelector('.agent-wait-item button')).toBeTruthy();
    writable.unmount();

    const stale = render(<Harness turns={[turn]} access="member_stale" targetAuthority={CURRENT_AUTHORITY} />);
    // member_stale 下 canInsert/canEdit/canCancel 都应为假：新 controlsAllowed() 把撤回也纳入
    // writable 检查（比旧模型更严格——旧模型 canCancel 不看 writable，这里如实按新代码断言）。
    expect(stale.container.querySelector('.agent-wait-item button')).toBeNull();
  });

  it('lets any writing member act on work it did not send：非发送者、可写、target 权威已生效即可插入/编辑', () => {
    const turn = queuedTurn('q1', { controls: [
      { word: 'agent.replace' },
      { word: 'agent.steer', payload: { queued_request_id: 'q1', expected_turn_id: 'turn-1' } },
    ] });
    const view = render(<Harness turns={[turn]} selfId="other" access="member_active" targetAuthority={CURRENT_AUTHORITY} />);
    const buttons = [...view.container.querySelectorAll('.agent-wait-item button')].map((b) => b.textContent);
    expect(buttons).toEqual(expect.arrayContaining(['插入', '编辑']));
  });

  it('cancels your own request, and asks the holder to drop anyone else\'s：自己撤回 vs 请对方 dismiss', () => {
    const turn = queuedTurn('q1', { controls: [{ word: 'agent.dismiss', payload: { request_id: 'q1' } }] });
    const mine = render(<Harness turns={[turn]} selfId="me" access="member_active" />);
    const mineButton = mine.container.querySelector('.agent-wait-item button');
    expect(mineButton?.textContent).toBe('取消');
    expect(mineButton?.title).toBe('撤回你自己发出的这条请求');
    mine.unmount();

    const others = render(<Harness turns={[turn]} selfId="other" access="member_active" targetAuthority={CURRENT_AUTHORITY} />);
    const otherButton = [...others.container.querySelectorAll('.agent-wait-item button')].find((b) => b.textContent === '取消');
    expect(otherButton?.title).toBe('这条不是你发的，将请对方放弃它');
  });

  it('offers no drop for others when the holder does not advertise it：受理方未宣告 dismiss 就没有第三方取消按钮', () => {
    const turn = queuedTurn('q1', { controls: [{ word: 'agent.replace' }] });
    const view = render(<Harness turns={[turn]} selfId="other" access="member_active" targetAuthority={CURRENT_AUTHORITY} />);
    const cancelButton = [...view.container.querySelectorAll('.agent-wait-item button')].find((b) => b.textContent === '取消');
    expect(cancelButton).toBeUndefined();
  });

  it('draws nothing when the account advertises no controls：账本没宣告任何控制词就不画按钮', () => {
    const silent = queuedTurn('q1', { status: 'queued' }); // controls 字段缺失
    const view = render(<Harness turns={[silent]} selfId="me" access="member_active" />);
    // 自己发的仍可撤回（不依赖对方宣告什么），但没有插入/编辑等按钮。
    const buttons = [...view.container.querySelectorAll('.agent-wait-item button')].map((b) => b.textContent);
    expect(buttons).toEqual(['取消']);
  });

  it('routes unknown advertised words to the generic path with label fallback：未知控制词落入通用路径', () => {
    const turn = queuedTurn('q1', { controls: [
      { word: 'agent.replace' },
      { word: 'agent.escalate', label: '升级', payload: { request_id: 'q1' } },
      { word: 'agent.retry', payload: { request_id: 'q1', retry: true } },
    ] });
    const view = render(<Harness turns={[turn]} selfId="me" access="member_active" targetAuthority={CURRENT_AUTHORITY} />);
    const buttons = [...view.container.querySelectorAll('.agent-wait-item button')].map((b) => b.textContent);
    expect(buttons).toEqual(expect.arrayContaining(['升级', 'retry']));
  });

  it('keeps caller cancel but disables receiver-directed controls until exact roster authority is current：target 权威未知/已离席时插入编辑关闭但撤回仍在', () => {
    const turn = queuedTurn('q1', { controls: [
      { word: 'agent.replace' },
      { word: 'agent.steer', payload: { target: 'q1' } },
    ] });
    const unknown = render(<Harness turns={[turn]} selfId="me" access="member_active" targetAuthority={null} />);
    let buttons = [...unknown.container.querySelectorAll('.agent-wait-item button')].map((b) => b.textContent);
    expect(buttons).toEqual(['取消']); // 插入/编辑没有出现
    expect(unknown.container.querySelector('.agent-wait-paused')?.textContent).toBe('正在核验收件人');
    unknown.unmount();

    const departed = render(<Harness turns={[turn]} selfId="me" access="member_active" targetAuthority={{ current: true, actorIDs: new Set(['agent:worker:200']) }} />);
    buttons = [...departed.container.querySelectorAll('.agent-wait-item button')].map((b) => b.textContent);
    expect(buttons).toEqual(['取消']);
    expect(departed.container.querySelector('.agent-wait-paused')?.textContent).toBe('收件人已离席，等待账本关闭');
  });

  it('并入中的排队请求：插入/编辑清空，steering 事实为真', () => {
    // 旧测试只断言 canInsert/canEdit 为假（没断言 canCancel），新结构里自己发的请求撤回不受
    // steering 影响，这里如实保持一致，不额外收紧断言。
    const turn = queuedTurn('q1', { controls: [], steering: true });
    const view = render(<Harness turns={[turn]} selfId="me" access="member_active" targetAuthority={CURRENT_AUTHORITY} />);
    const buttons = [...view.container.querySelectorAll('.agent-wait-item button')].map((b) => b.textContent);
    expect(buttons).toEqual(['取消']); // 没有"插入"/"编辑"
    expect([...view.container.querySelectorAll('.agent-wait-paused')].some((el) => el.textContent === '正在并入…')).toBe(true);
  });

  it('fails closed when an actor control has no canonical payload：缺 actor payload 时不提供控制按钮', () => {
    const turn = queuedTurn('q1', { controls: [
      { word: 'agent.dismiss' },
      { word: 'agent.steer' },
      { word: 'agent.escalate', label: '升级' },
    ] });
    const view = render(<Harness turns={[turn]} selfId="other" access="member_active" targetAuthority={CURRENT_AUTHORITY} />);
    expect([...view.container.querySelectorAll('.agent-wait-item button')]).toHaveLength(0);
  });

  it('sends the actor-authored payload unchanged：发送 canonical payload 而不是重造 request target', () => {
    const onControl = vi.fn();
    const turn = queuedTurn('q1', { controls: [
      { word: 'agent.dismiss', payload: { request_id: 'canonical-q1', expected_state_revision: 8 } },
      { word: 'agent.steer', payload: { queued_request_id: 'canonical-q1', expected_turn_id: 'turn-8' } },
    ] });
    const view = render(<Harness
      turns={[turn]}
      selfId="other"
      access="member_active"
      targetAuthority={CURRENT_AUTHORITY}
      onControl={onControl}
    />);
    fireEvent.click([...view.container.querySelectorAll('.agent-wait-item button')].find((button) => button.textContent === '插入'));
    fireEvent.click([...view.container.querySelectorAll('.agent-wait-item button')].find((button) => button.textContent === '取消'));
    expect(onControl).toHaveBeenNthCalledWith(1, turn, 'agent', 'agent.steer', {
      queued_request_id: 'canonical-q1',
      expected_turn_id: 'turn-8',
    });
    expect(onControl).toHaveBeenNthCalledWith(2, turn, 'agent', 'agent.dismiss', {
      request_id: 'canonical-q1',
      expected_state_revision: 8,
    });
  });
});

describe('【缺陷探测】processing 态的"停止"按钮是否仍要求可写频道 + 账本宣告 agent.interrupt', () => {
  it('旧模型 canStop 要求 writable+advertised；新结构 TurnCard 的“停止”按钮不做任何检查即可点击', () => {
    const turn = {
      requestId: 'p1',
      request: { id: 'p1', type: 'agent.ask', sender: { kind: 'human', id: 'me' }, audience: ['agent'], ts: 100, payload: { body: { text: 'hi' } } },
      terminal: null,
      local: false,
      thread: [],
      // 受理方账本上最新一帧根本没有宣告 agent.interrupt（等价于旧测试 “draws nothing when the
      // account advertises no controls” 的 processing 分支：controls 缺失）。
      provisional: [{ seq: 1, envelope: { payload: { body: { status: 'processing', turn_id: 'turn-7' } } } }],
    };
    const row = { id: 'p1', contentRevision: 0, visualSlotID: 'p1', body: { kind: 'turn', turn, thread: [] } };
    function Harness2() {
      const { renderRow } = useTimelineRowRenderer({
        state: { channelId: 'c1', narration: [] }, names: new Map(), selfId: 'me',
        presentationEditing: null, browsingExpandedSlots: new Set(), effectiveFoldOverrides: new Map(),
        approvalStates: {}, onTaskControl: () => {}, startEditing: () => {},
      });
      return renderRow(row);
    }
    const view = render(<Harness2 />);
    const stopButton = [...view.container.querySelectorAll('button')].find((b) => b.textContent === '停止');
    // 旧断言（task-controls.test.js "draws nothing when the account advertises no controls"）：
    // 受理方账本没有宣告 agent.interrupt 时 canStop 必须为 false，不应出现"停止"按钮。
    // 保留这条原始断言——不放宽——让它在新结构上如实红/绿。
    expect(stopButton).toBeFalsy();
  });
});
