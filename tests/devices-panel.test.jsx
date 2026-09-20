// @vitest-environment jsdom
// 旧 src/ui/space/DevicesPanel.jsx 已删除。设备管理 UI 现在是
// src/ui/features/governance/GovernanceFeature.jsx 的 SpaceDevices（挂在
// SpaceAdministrationPanel 的"设备" tab 下）。重要背景（见 RM 账本）：
// src/app/WorkspaceApp.jsx 里 governancePort.space.commands.submit 恒
// `() => Promise.reject(...)`（源码注释："当前 wire/session 没有空间治理结果
// 投影...不会伪造成功"），且全 src 找不到 create_device/attach_device/
// detach_device/retire_device 到任何 system.device.* 协议词的映射——这是一条
// 明确写了理由的、生产环境里恒不可用的写路径，不是静默回归。这里只测组件自身
// 的渲染/交互契约（跟旧测试一样直接给 port 传 mock commands），不代表这条路径
// 在真实 App 里能跑通。
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

  it('按频道投影（attached）而不是清单顺序决定绑定/解绑按钮可用性', () => {
    renderDevicesTab();
    // 新版 small 文案只有 "{id} · 在线/离线 · 已绑定/未绑定"，不再包含旧版的
    // "默认存储" 标记（见 RM 账本，默认存储指示丢失，单独记为观察项）。
    expect(screen.getByText('local-device · 在线 · 已绑定')).toBeTruthy();
    expect(screen.getByText('mac-id · 在线 · 未绑定')).toBeTruthy();
    const attachButtons = screen.getAllByRole('button', { name: '绑定当前频道' });
    const detachButtons = screen.getAllByRole('button', { name: '解绑' });
    expect(attachButtons[0].disabled).toBe(true); // local-device 已绑定，不能再绑
    expect(detachButtons[0].disabled).toBe(false);
    expect(attachButtons[1].disabled).toBe(false); // mac-id 未绑定，可以绑
    expect(detachButtons[1].disabled).toBe(true);
  });

  it('[AD-316] 设备命令 terminal 后刷新权威投影', async () => {
    // 用户能力：创建设备完成后，设备列表应重新读取权威 projection，而不是停留在旧清单。
    // 不变量：terminal 事实是命令完成边界；UI 不能把本地 submit 回执冒充设备已落地。
    // 公共 owner：SpaceAdministrationPanel → SpaceDevices 的 space.commands port。
    // 当前 owner 在 terminal 后通过同一 space.commands port 请求 devices refresh。
    const submit = vi.fn().mockResolvedValue('request-1');
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<SpaceAdministrationPanel
      channel={{ id: 'channel-a', qualified_name: 'c0.channel-a' }}
      port={{
        disabled: false,
        devices: [],
        commands: { submit, refresh },
      }}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('tab', { name: '设备' }));
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: '创建设备' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'space', action: 'create_device', payload: { name: 'laptop' },
    })));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
