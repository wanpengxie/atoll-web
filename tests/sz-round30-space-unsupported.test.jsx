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
    port={{
      disabled: true,
      unsupported,
      actorDescriptions: [{ name: 'writer', version: 1, ref: 'writer@1', class: 'claude', status: 'present' }],
      devices: [{ id: 'mac-id', name: 'Mac', online: true }],
      commands: { submit },
    }}
    onClose={vi.fn()}
  />);
  return submit;
}

describe('round 30 space governance unsupported boundary', () => {
  it('[SZ-014..017] explains the disabled space capability and never offers a write', () => {
    const submit = renderUnsupportedSpace();

    // 默认打开 Actor 描述页。
    expect(screen.getByRole('tab', { name: 'Actor 描述' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain(unsupported);
    fireEvent.change(screen.getByLabelText('Actor 描述名字'), { target: { value: 'writer' } });
    fireEvent.change(screen.getByLabelText('Actor 描述 Class'), { target: { value: 'claude' } });
    expect(screen.getByRole('button', { name: '新建' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '退役' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: '设备' }));
    expect(screen.getByRole('status').textContent).toContain(unsupported);
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'local-device' } });
    expect(screen.getByRole('button', { name: '创建设备' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '退役' }).disabled).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps the unsupported note off the global key tab, which uses the resource door', () => {
    renderUnsupportedSpace();
    fireEvent.click(screen.getByRole('tab', { name: '全局 key' }));
    expect(screen.queryByText(unsupported)).toBeNull();
  });
});
