// @vitest-environment jsdom

// 行子树的重算时机由 rowRenderRevision 声明，不该由 Timeline 自身的重渲染次数
// 决定。MessageRow 的 memo 比较 (row, revision, renderRow, presentationState)：
// 只要 renderRow 每帧换身份，已装入窗口内的每一行都会在任何一次 Timeline 重渲染
// 里整棵重建。本文件把「同一批事实 ⇒ 同一个 renderRow」钉成契约，并同时钉住它的
// 反面：行真正消费的事实一变，renderRow 必须换身份；只被行调用的命令式回调换了
// 身份，行必须仍然调用到最新那一个。

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { TYPES } from '../src/protocol/vocab.js';
import { Timeline } from '../src/ui/Timeline.jsx';

const listProbe = vi.hoisted(() => ({ props: null }));

// These cases exercise the default following role, whose canonical renderer
// is FollowingTailList. LegendMessageList is mounted only after a browsing
// handoff and therefore cannot observe ordinary timeline rerenders.
vi.mock('../src/ui/timeline/FollowingTailList.jsx', () => ({
  FollowingTailList(props) {
    listProbe.props = props;
    return <div data-testid="retention-list">{props.snapshot.rows.map((row) => (
      <React.Fragment key={row.id}>{props.renderRow(row)}</React.Fragment>
    ))}</div>;
  },
}));

afterEach(() => {
  cleanup();
  listProbe.props = null;
});

function append(state, seq, envelope) {
  apply(state, { channel_id: state.channelId, seq, envelope });
}

function processingChannel() {
  const state = createChannelState('c0');
  append(state, 1, {
    id: 'work',
    kind: 'request',
    type: TYPES.agentAsk,
    ts: 100,
    sender: { kind: 'human', id: 'me' },
    audience: ['agent'],
    visibility: 'public',
    payload: { body: { text: 'work' } },
  });
  append(state, 2, {
    id: 'work-progress',
    parent_id: 'work',
    kind: 'response',
    type: TYPES.agentAsk,
    ts: 110,
    sender: { kind: 'agent', id: 'agent' },
    audience: ['me'],
    visibility: 'public',
    payload: { body: { status: 'processing', controls: [{ word: TYPES.agentInterrupt, payload: { target: 'work' } }] } },
  });
  return state;
}

const roster = [
  { id: 'me', kind: 'human', name: '我' },
  { id: 'agent', kind: 'agent', name: 'Agent' },
];

function baseProps(state, overrides = {}) {
  return {
    state,
    roster,
    selfId: 'me',
    pending: [],
    approvalStates: {},
    controlStates: {},
    access: 'member_active',
    waitingRosterAuthority: { current: true, actorIDs: new Set(['agent']) },
    ...overrides,
  };
}

it('一次不改变任何行事实的重渲染保留同一个 renderRow', () => {
  const props = baseProps(processingChannel());
  const view = render(<Timeline {...props} />);
  const first = listProbe.props.renderRow;
  expect(typeof first).toBe('function');

  view.rerender(<Timeline {...props} />);
  expect(listProbe.props.renderRow).toBe(first);

  view.rerender(<Timeline {...props} />);
  expect(listProbe.props.renderRow).toBe(first);
});

it('只被行调用的命令式回调换身份不重建行，且行调用到最新的那一个', () => {
  const props = baseProps(processingChannel());
  const first = vi.fn();
  const view = render(<Timeline {...props} onTaskControl={first} />);
  const renderRow = listProbe.props.renderRow;

  const second = vi.fn();
  view.rerender(<Timeline {...props} onTaskControl={second} onCancel={() => {}} />);
  expect(listProbe.props.renderRow).toBe(renderRow);

  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  expect(second.mock.calls[0][0]).toMatchObject({ channelId: 'c0', actorId: 'agent', type: TYPES.agentInterrupt });
});

it('行真正消费的事实一变就换 renderRow', () => {
  const props = baseProps(processingChannel());
  const view = render(<Timeline {...props} />);
  const first = listProbe.props.renderRow;

  view.rerender(<Timeline {...baseProps(props.state, {
    roster: props.roster,
    approvalStates: props.approvalStates,
    controlStates: props.controlStates,
    pending: props.pending,
    waitingRosterAuthority: props.waitingRosterAuthority,
    access: 'member_readonly',
  })} />);
  expect(listProbe.props.renderRow).not.toBe(first);
});

it('行摘要换了编码仍然一格一格分得清，且没事时一字不变', () => {
  const props = baseProps(processingChannel());
  const view = render(<Timeline {...props} />);
  const row = listProbe.props.snapshot.rows[0];
  const revision = () => listProbe.props.rowRevision(0, row);
  const base = revision();

  view.rerender(<Timeline {...props} />);
  expect(listProbe.props.snapshot.rows[0]).toBe(row);
  expect(revision()).toBe(base);

  const seen = new Set([base]);
  const variants = [
    { controlStates: { 'c0:work:cancel': { phase: 'sending' } } },
    { turnDetail: { selected: { requestId: 'work' } } },
    { capabilityIndex: new Map([['agent', { loading: true }]]) },
    { capabilityIndex: new Map([['agent', { error: '不可达' }]]) },
    { waitingRosterAuthority: { current: true, actorIDs: new Set(['other']) } },
    { access: 'member_readonly' },
    { onReply: () => {} },
    { onCreateTask: () => {} },
  ];
  for (const variant of variants) {
    view.rerender(<Timeline {...props} {...variant} />);
    const next = revision();
    expect(seen.has(next), `${JSON.stringify(Object.keys(variant))} 没有改变行摘要`).toBe(false);
    seen.add(next);
  }
});
