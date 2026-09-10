// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { normalizeDescribe } from '../src/model/capabilities.js';
import { Timeline } from '../src/ui/Timeline.jsx';
import { FoldableBody, foldCandidate } from '../src/ui/timeline/FoldableBody.jsx';

afterEach(cleanup);

const LONG = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行`).join('\n');
const SHORT = '三行\n而已\n真的';

describe('foldCandidate（量不到布局时的判据）', () => {
  it('短文本不折，长文本折，按行数或字符数二者取一', () => {
    expect(foldCandidate(SHORT)).toBe(false);
    expect(foldCandidate(LONG)).toBe(true);
    expect(foldCandidate('x'.repeat(1200))).toBe(true);
    expect(foldCandidate(Array.from({ length: 17 }, () => 'a').join('\n'))).toBe(false);
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

  it('例外位置（最新一轮）默认展开但仍可手动收起', () => {
    render(<FoldableBody id="m3" text={LONG} exempt expanded={false}><pre>{LONG}</pre></FoldableBody>);
    expect(document.querySelector('.message-fold.is-folded')).toBeTruthy();
    cleanup();
    render(<FoldableBody id="m3" text={LONG} exempt><pre>{LONG}</pre></FoldableBody>);
    expect(document.querySelector('.message-fold.is-folded')).toBeNull();
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy();
  });
});

const request = (id, text, sender = { kind: 'human', id: 'me' }) => ({
  id, kind: 'request', type: 'agent.ask', ts: Date.now(), sender, audience: ['agent'], visibility: 'public', payload: { text },
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
const capabilityIndex = new Map([['agent', { describe: normalizeDescribe({ class: 'agent', capabilities: {}, words: { 'agent.ask': {} } }) }]]);

describe('Timeline 正文自动折叠', () => {
  it('旧的长答案折起，最新一轮的长答案不折；人贴的长文同样折', () => {
    const state = createChannelState('c0');
    let seq = 0;
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: request('r1', '第一问') });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: done('r1-done', 'r1', LONG) });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: request('r2', LONG) });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: done('r2-done', 'r2', SHORT) });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: request('r3', '最后一问') });
    apply(state, { channel_id: 'c0', seq: ++seq, envelope: done('r3-done', 'r3', LONG) });
    render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilityIndex} />);
    const folded = [...document.querySelectorAll('.message-fold.is-folded')].map((node) => node.closest('[data-entry-id]')?.getAttribute('data-entry-id'));
    expect(folded).toEqual(['r1', 'r2']);
    const latest = document.querySelector('[data-entry-id="r3"]');
    expect(latest.querySelector('.message-fold.is-folded')).toBeNull();
    expect(latest.querySelector('.message-fold-toggle').textContent).toContain('收起');
  });

  it('手动展开的正文在重渲后仍是展开的', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: request('r1', '第一问') });
    apply(state, { channel_id: 'c0', seq: 2, envelope: done('r1-done', 'r1', LONG) });
    apply(state, { channel_id: 'c0', seq: 3, envelope: request('r2', '第二问') });
    apply(state, { channel_id: 'c0', seq: 4, envelope: done('r2-done', 'r2', SHORT) });
    const props = { state, roster, selfId: 'me', pending: [], approvalStates: {}, access: 'member_active', capabilityIndex };
    const { rerender } = render(<Timeline {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /展开全文/ }));
    rerender(<Timeline {...props} />);
    expect(document.querySelector('[data-entry-id="r1"] .message-fold.is-folded')).toBeNull();
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
});
