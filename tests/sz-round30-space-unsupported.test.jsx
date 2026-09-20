// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpaceAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

const unsupported = '当前 wire/session 没有空间治理结果投影；此版本仅展示 OBS 目录，不会伪造成功。';

afterEach(cleanup);

function renderUnsupportedSpace() {
  const submit = vi.fn();
  render(<SpaceAdministrationPanel
    channel={{ id: 'c0', qualified_name: 'c0' }}
    port={{
      disabled: true,
      unsupported,
      devices: [],
      commands: { submit },
    }}
    onClose={vi.fn()}
  />);
  return submit;
}

describe('round 30 space governance unsupported boundary', () => {
  it('[SZ-014..017] explains the disabled space capability and never offers a write', () => {
    const submit = renderUnsupportedSpace();

    expect(screen.getByRole('status').textContent).toContain(unsupported);
    expect(screen.getByRole('button', { name: '保存' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: '频道模板' }));
    expect(screen.getByRole('button', { name: '保存' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: '频道配置' }));
    expect(screen.getByRole('button', { name: '保存配置' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: '设备' }));
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'local-device' } });
    expect(screen.getByRole('button', { name: '创建设备' }).disabled).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });
});
