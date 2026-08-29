// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevicesPanel } from '../src/ui/space/DevicesPanel.jsx';

afterEach(cleanup);

const roster = [{ id: 'system', kind: 'system', name: 'system' }];

function renderPanel(overrides = {}) {
  const onSubmit = vi.fn(async () => 'request-1');
  render(<DevicesPanel
    channel={{ id: 'channel-a', qualified_name: 'c0.channel-a' }}
    states={[]}
    version={0}
    daemons={[{ id: 'local-device', name: 'Local', online: true }, { id: 'mac-id', name: 'Mac', online: true }]}
    channelDevices={[{ id: 'local-device', name: 'Local', online: true, defaultStorage: true }]}
    registrarRoster={roster}
    disabled={false}
    onSubmit={onSubmit}
    onRefresh={() => {}}
    {...overrides}
  />);
  return onSubmit;
}

describe('device administration uses the real registry vocabulary', () => {
  it('creates with system.device.create and exposes no mint/claim controls', async () => {
    const onSubmit = renderPanel();
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: '创建设备' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ msgType: 'system.device.create', payload: { name: 'laptop' } });
    expect(screen.queryByText('认领设备')).toBeNull();
  });

  it('rejects a display caption where the registry requires a stable name', async () => {
    const onSubmit = renderPanel();
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'My Laptop' } });
    fireEvent.click(screen.getByRole('button', { name: '创建设备' }));
    expect((await screen.findByRole('alert')).textContent).toContain('设备名称须为');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('takes binding/default state from the channel projection, not inventory order', () => {
    renderPanel();
    expect(screen.getByText(/local-device · 在线 · 已绑定 · 默认存储/)).toBeTruthy();
    const attachButtons = screen.getAllByRole('button', { name: '绑定当前频道' });
    const detachButtons = screen.getAllByRole('button', { name: '解绑' });
    expect(attachButtons[0].disabled).toBe(true);
    expect(detachButtons[0].disabled).toBe(false);
    expect(attachButtons[1].disabled).toBe(false);
    expect(detachButtons[1].disabled).toBe(true);
  });

  it('refreshes the authoritative projection after an operation reaches terminal state', async () => {
    const onRefresh = vi.fn();
    renderPanel({
      states: [{ turns: new Map([['request-1', { terminal: { payload: { status: 'completed' } } }]]) }],
      onRefresh,
    });
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: '创建设备' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });
});
