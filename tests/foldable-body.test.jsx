// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { normalizeDescribe } from '../src/model/capabilities.js';
import { createWaitingTargetAuthority } from '../src/model/task-controls.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { Timeline } from '../src/ui/Timeline.jsx';
import { FoldableBody, foldCandidate } from '../src/ui/timeline/FoldableBody.jsx';

vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => ({
  MessageList: (await import('./helpers/PresentationMessageList.jsx')).PresentationMessageList,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LONG = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行`).join('\n');
const SHORT = '三行\n而已\n真的';

describe('foldCandidate（量不到布局时的判据）', () => {
  it('短文本不折，长文本折，按行数或字符数二者取一', () => {
    expect(foldCandidate(SHORT)).toBe(false);
    expect(foldCandidate(LONG)).toBe(true);
    expect(foldCandidate('x'.repeat(1200))).toBe(true);
    expect(foldCandidate(Array.from({ length: 17 }, () => 'a').join('\n'))).toBe(false);
  });

  it('无换行的中英文长段落也按稳定的显示宽度估算', () => {
    expect(foldCandidate('中文段落'.repeat(160))).toBe(true);
    expect(foldCandidate('wrapped words '.repeat(90))).toBe(true);
  });
});

describe('FoldableBody', () => {
  it('长正文默认折起，带"展开全文"；点开后展开，再点收起', () => {
    const toggles = [];
    const { rerender } = render(<FoldableBody id="m1" text={LONG} onToggle={(id, expanded) => toggles.push([id, expanded])}><pre>{LONG}</pre></FoldableBody>);
    const button = screen.getByRole('button', { name: /展开全文/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.message-fold.is-folded')).toBeTruthy();
    fireEvent.click(button);
    expect(toggles).toEqual([['m1', true]]);
    rerender(<FoldableBody id="m1" text={LONG} expanded onToggle={(id, expanded) => toggles.push([id, expanded])}><pre>{LONG}</pre></FoldableBody>);
    expect(document.querySelector('.message-fold.is-folded')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(toggles.at(-1)).toEqual(['m1', false]);
  });

  it('短正文没有按钮', () => {
    render(<FoldableBody id="m2" text={SHORT}><p>{SHORT}</p></FoldableBody>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('.message-fold.is-folded')).toBeNull();
  });

  it('折叠资格不读 scrollHeight；只有实际折叠后才观察焦点边界', () => {
    const observe = vi.fn();
    const ResizeObserver = vi.fn(function Observer() { this.observe = observe; this.disconnect = vi.fn(); });
    vi.stubGlobal('ResizeObserver', ResizeObserver);
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get');
    const view = render(<FoldableBody id="stable-fold" text="一句话"><p>一句话</p></FoldableBody>);
    expect(ResizeObserver).not.toHaveBeenCalled();
    view.rerender(<FoldableBody id="stable-fold" text={LONG}><pre>{LONG}</pre></FoldableBody>);
    expect(ResizeObserver).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalled();
    expect(scrollHeight).not.toHaveBeenCalled();
    scrollHeight.mockRestore();
  });

  it('只把裁剪边界外的控件移出 Tab 序列，展开时精确恢复属性', () => {
    const rect = (top, bottom) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
      if (this.classList.contains('message-fold-content')) return rect(0, 100);
      if (this.dataset.position === 'visible') return rect(10, 30);
      if (this.dataset.position === 'hidden') return rect(120, 140);
      return rect(0, 10);
    });
    const view = render(<FoldableBody id="focus-boundary" text={LONG}>
      <div>
        <a href="/visible" data-position="visible">可见链接</a>
        <button type="button" data-position="hidden" tabIndex="4" aria-hidden="false">隐藏操作</button>
      </div>
    </FoldableBody>);
    const visible = screen.getByRole('link', { name: '可见链接' });
    const hidden = view.container.querySelector('[data-position="hidden"]');
    expect(visible.hasAttribute('tabindex')).toBe(false);
    expect(visible.hasAttribute('aria-hidden')).toBe(false);
    expect(hidden.getAttribute('tabindex')).toBe('-1');
    expect(hidden.getAttribute('aria-hidden')).toBe('true');

    view.rerender(<FoldableBody id="focus-boundary" text={LONG} expanded>
      <div>
        <a href="/visible" data-position="visible">可见链接</a>
        <button type="button" data-position="hidden" tabIndex="4" aria-hidden="false">隐藏操作</button>
      </div>
    </FoldableBody>);
    expect(hidden.getAttribute('tabindex')).toBe('4');
    expect(hidden.getAttribute('aria-hidden')).toBe('false');
    geometry.mockRestore();
  });

  it('例外位置（最新一轮）默认展开但仍可手动收起', () => {
    render(<FoldableBody id="m3" text={LONG} exempt expanded={false}><pre>{LONG}</pre></FoldableBody>);
    expect(document.querySelector('.message-fold.is-folded')).toBeTruthy();
    cleanup();
    render(<FoldableBody id="m3" text={LONG} exempt><pre>{LONG}</pre></FoldableBody>);
    expect(document.querySelector('.message-fold.is-folded')).toBeNull();
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy();
  });
});

const request = (id, text, sender = { kind: 'human', id: 'me' }, audience = ['agent']) => ({
  id, kind: 'request', type: 'agent.ask', ts: Date.now(), sender, audience, visibility: 'public', payload: { text },
});
const done = (id, parentId, text) => ({
  id, parent_id: parentId, kind: 'response', type: 'agent.ask', ts: Date.now(),
  sender: { kind: 'agent', id: 'agent' }, audience: ['me'], visibility: 'public', payload: { status: 'completed', text },
});
const progressText = (id, parentId, text) => ({
  id, parent_id: parentId, kind: 'response', type: 'agent.ask', ts: Date.now(),
  sender: { kind: 'agent', id: 'agent' }, audience: ['me'], visibility: 'public',
  payload: { status: 'processing', process: { kind: 'stage', stage: 'text', text } },
});
const roster = [{ id: 'me', kind: 'human', name: '我' }, { id: 'agent', kind: 'agent', name: 'Agent' }];
const capability = () => ({ describe: normalizeDescribe({ class: 'agent', capabilities: {}, words: { 'agent.ask': {} } }) });
const capabilityIndex = new Map([['agent', capability()]]);
const waitingRosterAuthority = createWaitingTargetAuthority({
  principalId: 'me',
  channelId: 'c0',
  generation: 1,
  rosterAuthority: {
    principalId: 'me', channelId: 'c0', generation: 1, current: true,
  },
  roster,
});
const authoritativeHistory = (state) => ({
  get status() {
    const headSeq = Number(state.lastSeq || 0);
    return {
      attached: true,
      generation: 1,
      messageCurrent: true,
      localReplicaReady: true,
      headSeq,
      presentationRevision: Number(state._timelineRevision || headSeq),
      coverage: headSeq > 0 ? [{ lowSeq: 1, highSeq: headSeq }] : [],
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: headSeq },
    };
  },
});

describe('Timeline 正文自动折叠', () => {
  it('历史长正文默认折起，当前 Presentation 的最后一条答案默认展开', () => {
    const state = createChannelState('c0');
    let seq = 0;
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: request('r1', '第一问') });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: done('r1-done', 'r1', LONG) });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: request('r2', LONG) });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: done('r2-done', 'r2', SHORT) });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: request('r3', '最后一问') });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: done('r3-done', 'r3', LONG) });
    render(<Timeline state={state} history={authoritativeHistory(state)} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilityIndex} />);
    const folded = [...document.querySelectorAll('.message-fold.is-folded')].map((node) => node.closest('[data-entry-id]')?.getAttribute('data-entry-id'));
    expect(folded).toEqual(['r1', 'r2']);
    const latest = document.querySelector('[data-entry-id="r3"]');
    expect(latest.querySelector('.message-fold.is-folded')).toBeNull();
    expect(latest.querySelector('.message-fold-toggle').textContent).toContain('收起');
  });

  it('append 后无 override 的旧 latest 转为历史折叠，新 latest 默认展开', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '第一问') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: done('r1-done', 'r1', LONG) });
    const props = { roster, selfId: 'me', pending: [], approvalStates: {}, access: 'member_active', capabilityIndex, history: authoritativeHistory(state) };
    const view = render(<Timeline {...props} state={state} />);
    const firstFold = document.querySelector('[data-entry-id="r1"] .response-body .message-fold');
    expect(firstFold.classList.contains('is-folded')).toBe(false);

    apply(state, { channel_id: 'c0', seq: 3, envelope: request('r2', '第二问') });
    apply(state, { channel_id: 'c0', seq: 4, envelope: done('r2-done', 'r2', LONG) });
    view.rerender(<Timeline {...props} state={state} />);
    expect(document.querySelector('[data-entry-id="r1"] .response-body .message-fold').classList.contains('is-folded')).toBe(true);
    expect(document.querySelector('[data-entry-id="r2"] .response-body .message-fold').classList.contains('is-folded')).toBe(false);
  });

  it('读者显式展开的正文不因 append 或重渲被默认推翻', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '第一问') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: done('r1-done', 'r1', LONG) });
    const props = { state, roster, selfId: 'me', pending: [], approvalStates: {}, access: 'member_active', capabilityIndex, history: authoritativeHistory(state) };
    const { rerender } = render(<Timeline {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    fireEvent.click(screen.getByRole('button', { name: /展开全文/ }));
    apply(state, { channel_id: 'c0', seq: 3, envelope: request('r2', '第二问') });
    apply(state, { channel_id: 'c0', seq: 4, envelope: done('r2-done', 'r2', SHORT) });
    rerender(<Timeline {...props} />);
    expect(document.querySelector('[data-entry-id="r1"] .response-body .message-fold.is-folded')).toBeNull();
  });

  it('忽略旧 tail 默认展开缓存，但保留读者跨重挂的显式 foldOverrides', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '第一问') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: done('r1-done', 'r1', LONG) });
    apply(state, { channel_id: 'c0', seq: 3, envelope: request('r2', '第二问') });
    apply(state, { channel_id: 'c0', seq: 4, envelope: done('r2-done', 'r2', LONG) });
    apply(state, { channel_id: 'c0', seq: 5, envelope: request('r3', '第三问') });
    apply(state, { channel_id: 'c0', seq: 6, envelope: done('r3-done', 'r3', LONG) });
    const viewSessions = createViewSessionStore({ storage: null });
    viewSessions.writeConversation('c0', {
      foldDefaults: ['r1:response'],
      foldOverrides: [['r2:response', true]],
    });

    render(<Timeline state={state} history={authoritativeHistory(state)} viewSessions={viewSessions} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilityIndex} />);
    expect(document.querySelector('[data-entry-id="r1"] .response-body .message-fold').classList.contains('is-folded')).toBe(true);
    expect(document.querySelector('[data-entry-id="r2"] .response-body .message-fold').classList.contains('is-folded')).toBe(false);
    expect(document.querySelector('[data-entry-id="r3"] .response-body .message-fold').classList.contains('is-folded')).toBe(false);
  });

  it('用户手动收起 latest 后，流式追加和 terminal 都不推翻 override', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '开始') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: progressText('r1-progress-1', 'r1', LONG) });
    const props = { state, roster, selfId: 'me', pending: [], approvalStates: {}, access: 'member_active', capabilityIndex, history: authoritativeHistory(state) };
    const view = render(<Timeline {...props} />);
    const responseFold = () => document.querySelector('[data-entry-id="r1"] .response-body .message-fold');
    expect(responseFold().classList.contains('is-folded')).toBe(false);
    fireEvent.click(responseFold().querySelector('.message-fold-toggle'));
    expect(responseFold().classList.contains('is-folded')).toBe(true);

    apply(state, { channel_id: 'c0', seq: 3, envelope: progressText('r1-progress-2', 'r1', '继续追加但不改变稳定行身份') });
    view.rerender(<Timeline {...props} />);
    expect(responseFold().classList.contains('is-folded')).toBe(true);

    apply(state, { channel_id: 'c0', seq: 4, envelope: done('r1-done', 'r1', LONG) });
    view.rerender(<Timeline {...props} />);
    expect(responseFold().classList.contains('is-folded')).toBe(true);
  });

  it('未操作的 processing latest 在 terminal 后仍保持默认展开', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '开始') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: progressText('r1-progress-1', 'r1', LONG) });
    const props = { state, roster, selfId: 'me', pending: [], approvalStates: {}, access: 'member_active', capabilityIndex, history: authoritativeHistory(state) };
    const view = render(<Timeline {...props} />);
    const responseFold = () => document.querySelector('[data-entry-id="r1"] .response-body .message-fold');
    expect(responseFold().classList.contains('is-folded')).toBe(false);
    apply(state, { channel_id: 'c0', seq: 3, envelope: done('r1-done', 'r1', LONG) });
    view.rerender(<Timeline {...props} />);
    expect(responseFold().classList.contains('is-folded')).toBe(false);
  });

  it('中间正文与最终答复共用整段对话的展开和收起范围', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '第一问') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: progressText('r1-progress', 'r1', LONG) });
    apply(state, { channel_id: 'c0', seq: 3, envelope: done('r1-done', 'r1', SHORT) });
    apply(state, { channel_id: 'c0', seq: 4, envelope: request('r2', '第二问') });
    apply(state, { channel_id: 'c0', seq: 5, envelope: done('r2-done', 'r2', SHORT) });
    render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilityIndex} />);

    const response = document.querySelector('[data-entry-id="r1"] .response-body .response-content');
    const fold = response.querySelector('.message-fold');
    expect(fold.classList.contains('is-folded')).toBe(true);
    expect(fold.querySelector('.message-fold-content').contains(response.querySelector('.agent-progress-text'))).toBe(true);
    expect(fold.querySelector('.message-fold-content').contains(response.querySelector('.agent-final-text'))).toBe(true);

    fireEvent.click(response.querySelector('.message-fold-toggle'));
    expect(fold.classList.contains('is-folded')).toBe(false);
    fireEvent.click(response.querySelector('.message-fold-toggle'));
    expect(fold.classList.contains('is-folded')).toBe(true);
  });

  it('同一 processing 阶段追加正文时不重建全量投影但仍更新可见内容', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '开始') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: progressText('r1-progress-1', 'r1', '第一段') });
    const props = {
      state, roster, selfId: 'me', pending: [], approvalStates: {},
      access: 'member_active', capabilityIndex, waitingRosterAuthority,
    };
    const { rerender } = render(<Timeline {...props} />);
    const version = state._timelineProjectionVersion;
    const controlVersion = state._timelineControlVersion;

    apply(state, { channel_id: 'c0', seq: 3, envelope: progressText('r1-progress-2', 'r1', '第二段') });
    expect(state._timelineProjectionVersion).toBe(version);
    expect(state._timelineControlVersion).toBe(controlVersion);
    rerender(<Timeline {...props} />);

    expect(screen.getByText('第一段')).toBeTruthy();
    expect(screen.getByText('第二段')).toBeTruthy();

    apply(state, { channel_id: 'c0', seq: 4, envelope: {
      ...progressText('r1-progress-3', 'r1', '第三段'),
      payload: { status: 'processing', controls: [{ word: 'agent.interrupt' }] },
    } });
    expect(state._timelineProjectionVersion).toBe(version);
    expect(state._timelineControlVersion).toBe(controlVersion + 1);
    expect(waitingRosterAuthority).toMatchObject({
      principalId: 'me', channelId: 'c0', generation: 1, current: true,
    });
    expect(waitingRosterAuthority.actorIDs).toEqual(new Set(['agent']));
    rerender(<Timeline {...props} />);
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy();
  });
});
