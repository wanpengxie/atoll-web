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
  it('keeps target controls visible but disabled until current authority is present', async () => {
    const user = userEvent.setup();
    const controlWaiting = renderWaiting(WAITING_ITEM);
    await user.click(screen.getByRole('tab', { name: /等待区/ }));

    const steer = screen.getByRole('button', { name: '插入指令' });
    const interrupt = screen.getByRole('button', { name: '停止' });
    expect(steer.disabled).toBe(true);
    expect(interrupt.disabled).toBe(true);
    expect(steer.getAttribute('title')).toBe('正在核验收件人');
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
