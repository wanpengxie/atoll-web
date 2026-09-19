// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksFeature } from '../src/ui/features/tasks/TasksFeature.jsx';
import { FEATURE_COMMAND_STATE, FEATURE_WAITING_CONTROL } from '../src/model/feature-tasks.js';

afterEach(cleanup);

const WAITING_ITEM = {
  key: 'waiting:c0:r1',
  requestId: 'r1',
  channelId: 'c0',
  title: '继续工作',
  state: 'processing',
  actorId: 'agent:worker:1',
  actions: [FEATURE_WAITING_CONTROL.steer, FEATURE_WAITING_CONTROL.interrupt],
};

function renderWaiting(item, controlWaiting = vi.fn()) {
  render(<TasksFeature port={{
    waiting: [item],
    waitingState: FEATURE_COMMAND_STATE.ready,
    supportedWaitingControls: new Set(Object.values(FEATURE_WAITING_CONTROL)),
    commands: { controlWaiting },
  }} />);
  return controlWaiting;
}

describe('TasksFeature waiting target controls', () => {
  it('keeps cached waiting facts visible but hides controls until current authority is present', async () => {
    const user = userEvent.setup();
    const controlWaiting = renderWaiting(WAITING_ITEM);
    await user.click(screen.getByRole('tab', { name: /等待区/ }));

    expect(screen.getByText('继续工作', { exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '插入指令' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
    expect(controlWaiting).not.toHaveBeenCalled();
  });

  it('hides all waiting controls while the tail or roster authority is stale, then restores them', async () => {
    const user = userEvent.setup();
    const controlWaiting = vi.fn();
    const { rerender } = render(<TasksFeature port={{
      waiting: [{
        ...WAITING_ITEM,
        targetAuthority: {
          current: false,
          rosterCurrent: true,
          controlCurrent: false,
          actorIDs: new Set(['agent:worker:1']),
        },
      }],
      waitingState: FEATURE_COMMAND_STATE.ready,
      supportedWaitingControls: new Set(Object.values(FEATURE_WAITING_CONTROL)),
      commands: { controlWaiting },
    }} />);
    await user.click(screen.getByRole('tab', { name: /等待区/ }));
    expect(screen.getByText('继续工作', { exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '插入指令' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();

    rerender(<TasksFeature port={{
      waiting: [{
        ...WAITING_ITEM,
        targetAuthority: {
          current: true,
          rosterCurrent: true,
          controlCurrent: true,
          actorIDs: new Set(['agent:worker:1']),
        },
      }],
      waitingState: FEATURE_COMMAND_STATE.ready,
      supportedWaitingControls: new Set(Object.values(FEATURE_WAITING_CONTROL)),
      commands: { controlWaiting },
    }} />);
    expect(screen.getByRole('button', { name: '插入指令' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: '停止' }).disabled).toBe(false);

    rerender(<TasksFeature port={{
      waiting: [{
        ...WAITING_ITEM,
        targetAuthority: {
          current: false,
          rosterCurrent: false,
          controlCurrent: true,
          actorIDs: new Set(['agent:worker:1']),
        },
      }],
      waitingState: FEATURE_COMMAND_STATE.ready,
      supportedWaitingControls: new Set(Object.values(FEATURE_WAITING_CONTROL)),
      commands: { controlWaiting },
    }} />);
    expect(screen.queryByRole('button', { name: '插入指令' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
    expect(controlWaiting).not.toHaveBeenCalled();
  });

  it('enables both target controls only for an authority containing the waiting actor', async () => {
    const user = userEvent.setup();
    const controlWaiting = renderWaiting({
      ...WAITING_ITEM,
      targetAuthority: { current: true, actorIDs: new Set(['agent:worker:1']) },
    });
    await user.click(screen.getByRole('tab', { name: /等待区/ }));

    await user.click(screen.getByRole('button', { name: '插入指令' }));
    expect(controlWaiting).toHaveBeenCalledWith({ item: expect.objectContaining({ requestId: 'r1' }), type: FEATURE_WAITING_CONTROL.steer });
  });
});
