// @vitest-environment jsdom
// 设备管理 UI 是 src/ui/features/governance/GovernanceFeature.jsx 的
// SpaceDevices（挂在 SpaceAdministrationPanel 的"设备" tab 下）。空间治理命令
// 由 WorkspaceApp 的 submitSpaceGovernance 映射到 system.device.create /
// system.device.delete，等终态回来再刷新目录（那一半在
// workspace-real-runtime-composition 里测）。把设备挂到某个频道不在这里：它是
// 改那个频道的描述，在「频道详情 → 设置」里做（governance-feature-owner）。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

function renderDevicesTab(overrides = {}) {
  const submit = vi.fn().mockResolvedValue('request-1');
  render(<SpaceAdministrationPanel
    channel={{ id: 'channel-a', qualified_name: 'c0.channel-a' }}
    port={{
      disabled: false,
      devices: [
        { id: 'local-device', name: 'Local', online: true, attached: true },
        { id: 'mac-id', name: 'Mac', online: true, attached: false },
      ],
      commands: { submit },
      ...overrides,
    }}
    onClose={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('tab', { name: '设备' }));
  return submit;
}

describe('device administration (SpaceDevices)', () => {
  it('提交 create_device 动作，且没有认领/铸造类控件', () => {
    const submit = renderDevicesTab();
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: '创建设备' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ scope: 'space', action: 'create_device', payload: { name: 'laptop' } }));
    expect(screen.queryByText('认领设备')).toBeNull();
    expect(screen.queryByText(/铸造/)).toBeNull();
  });

  it('对不合法的设备展示名（含空格）没有任何客户端拦截，直接提交', () => {
    const submit = renderDevicesTab();
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'My Laptop' } });
    const button = screen.getByRole('button', { name: '创建设备' });
    expect(button.disabled).toBe(false); // 旧版会報 "设备名称须为..." 并拦截；新版只检查非空
    fireEvent.click(button);
    expect(submit).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('只列设备和退役入口；local-device 是节点自己的设备，不能退役', async () => {
    const submit = renderDevicesTab();
    expect(screen.getByText('local-device · 在线')).toBeTruthy();
    expect(screen.getByText('mac-id · 在线')).toBeTruthy();
    // 挂载不在空间管理里做。
    expect(screen.queryByRole('button', { name: '绑定当前频道' })).toBeNull();
    expect(screen.getByText('把设备挂到某个频道，在那个频道的「频道详情 → 设置」里做。')).toBeTruthy();
    const retire = screen.getAllByRole('button', { name: '退役' });
    expect(retire[0].disabled).toBe(true);
    expect(retire[1].disabled).toBe(false);
    fireEvent.click(retire[1]);
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ scope: 'space', action: 'retire_device', payload: { deviceId: 'mac-id' } }));
  });

  it('[AD-316] 设备列表只显示端口给的权威投影，刷新走同一个 space.commands port', async () => {
    // 用户能力：创建设备完成后，设备列表显示重新读取的权威 projection，而不是本地回执。
    // 不变量：终态之后的目录刷新由 WorkspaceApp 的 submitSpaceGovernance 做；
    // 这里的列表只渲染 port.devices，手动「刷新」请求 devices 投影。
    const submit = vi.fn().mockResolvedValue({ device_id: 'device-9', key: 'k' });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const port = { disabled: false, devices: [], commands: { submit, refresh } };
    const view = render(<SpaceAdministrationPanel port={port} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '设备' }));
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: '创建设备' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'space', action: 'create_device', payload: { name: 'laptop' },
    })));
    await screen.findByText('设备已创建。');
    // 回执本身不会变出一行设备。
    expect(screen.queryByText(/device-9/)).toBeNull();
    view.rerender(<SpaceAdministrationPanel port={{ ...port, devices: [{ id: 'device-9', name: 'laptop', online: false }] }} onClose={vi.fn()} />);
    expect(screen.getByText('device-9 · 离线')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(refresh).toHaveBeenCalledWith('devices');
  });
});
