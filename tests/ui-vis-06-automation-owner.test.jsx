// @vitest-environment jsdom
// UI-VIS-06 public owner contract.  These tests exercise the existing
// TasksFeature -> WorkspaceApp command port -> ChannelAutomationPanel path;
// they do not add a second timer store or invent a protocol adapter.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TasksFeature } from '../src/ui/features/tasks/TasksFeature.jsx';
import { TaskDetailPanel } from '../src/ui/features/tasks/TaskDetailPanel.jsx';
import { ChannelAutomationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { FEATURE_COMMAND_STATE, FEATURE_TASK_ACTION } from '../src/model/feature-tasks.js';

afterEach(cleanup);

const automationItem = Object.freeze({
  key: 'automation:c0:timer-1',
  id: 'timer-1',
  nativeId: 'timer-1',
  channelId: 'c0',
  kind: 'automation',
  title: '本设备提醒',
  state: 'waiting',
  localScope: 'this_device',
  provenance: 'local_durable',
  actionableBySelf: true,
  actions: [FEATURE_TASK_ACTION.cancelAutomation],
  diagnostic: { msgType: 'agent.ask', payload: { text: '本设备提醒' } },
});

describe('UI-VIS-06 automation public owner path', () => {
  it('routes the Tasks entry to the existing ChannelAutomationPanel command', () => {
    const openAutomation = vi.fn();
    render(<TasksFeature port={{
      items: [], waiting: [], pageSize: 120,
      automation: { state: FEATURE_COMMAND_STATE.ready },
      creation: { state: FEATURE_COMMAND_STATE.unsupported, providers: [] },
      commands: { openAutomation },
    }} />);

    fireEvent.click(screen.getByRole('button', { name: '安排自动动作' }));
    expect(openAutomation).toHaveBeenCalledTimes(1);
  });

  it('routes the task detail cancel action with the durable timer id', async () => {
    const cancelAutomation = vi.fn().mockResolvedValue({ status: 'cancelled' });
    render(<TaskDetailPanel port={{
      selectedItem: automationItem,
      commandStates: new Map(),
      commands: { cancelAutomation },
    }} />);

    const cancel = screen.getByRole('button', { name: '取消本设备自动动作' });
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    await waitFor(() => expect(cancelAutomation).toHaveBeenCalledWith({
      item: automationItem,
      timerId: 'timer-1',
    }));
  });

  it('keeps create and cancel on the ChannelAutomationPanel public command port', async () => {
    const after = vi.fn().mockResolvedValue({ timer_id: 'timer-1' });
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' });
    render(<ChannelAutomationPanel
      channel={{ id: 'c0' }}
      port={{ disabled: false, records: [], commands: { after, cancel } }}
      onClose={() => {}}
    />);

    fireEvent.click(screen.getByRole('button', { name: '创建定时动作' }));
    await waitFor(() => expect(after).toHaveBeenCalledWith({
      channelId: 'c0',
      durationMs: 5000,
      msgType: 'agent.ask',
      payload: { text: '定时提醒' },
    }));
    await waitFor(() => expect(screen.getByLabelText('待取消 timer ID').value).toBe('timer-1'));

    fireEvent.click(screen.getByRole('button', { name: '取消定时动作' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({
      channelId: 'c0',
      timerId: 'timer-1',
    }));
  });
});
