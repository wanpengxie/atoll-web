// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceFeatureOverlays, WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

afterEach(cleanup);

function ChannelCreateHarness({ commands = {} }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>打开频道创建</button>
    {open && <WorkspaceRightPanel
      panel={{ kind: 'channel-administration', initialTab: 'overview' }}
      channel={{ id: 'c0', qualified_name: 'c0' }}
      governance={{ commands }}
      onClose={() => setOpen(false)}
    />}
  </>;
}

describe('N-R round 34 public picker/governance owner contracts', () => {
  it('keeps the public channel-create dialog focus-trapped and restores its opener on Escape', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<ChannelCreateHarness commands={{ submit: vi.fn() }} />);

    const opener = screen.getByRole('button', { name: '打开频道创建' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: '新建频道' });
    expect(document.activeElement).toBe(screen.getByLabelText('新频道名称'));
    expect(opener.inert).toBe(true);

    const focusable = [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )];
    expect(focusable.length).toBeGreaterThan(2);
    const first = focusable[0];
    const last = focusable.at(-1);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建频道' })).toBeNull());
    expect(opener.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('cancels the public channel-file picker on Escape without selecting a resource', () => {
    const onChoose = vi.fn();
    const onClose = vi.fn();
    render(<WorkspaceFeatureOverlays filePicker={{
      open: true,
      channel: { id: 'c0', qualified_name: 'c0' },
      files: {
        deviceId: 'local-device',
        devices: [{ id: 'local-device', name: 'local-device' }],
        entries: [{
          key: 'resource:c0:readme', kind: 'file', name: 'README.md',
          resourceId: 'daemon://local-device/c0/README.md', mediaType: 'text/markdown', size: 12,
        }],
        commands: {},
      },
      onChoose,
      onClose,
    }} />);

    expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('does not settle a picker from a stale files error before its refresh receipt', async () => {
    const onRequestSettled = vi.fn();
    const refresh = vi.fn().mockResolvedValue({ epoch: 8, rows: [] });
    const props = {
      open: true,
      requestId: 'picker-1',
      channel: { id: 'c0', qualified_name: 'c0' },
      files: {
        deviceId: 'local-device',
        entries: [],
        error: '旧刷新失败',
        refreshReceipt: {
          epoch: 7, channelId: 'c0', deviceId: 'local-device', phase: 'settled', error: '旧刷新失败',
        },
        commands: { refresh },
      },
      onRequestSettled,
    };
    const view = render(<WorkspaceFeatureOverlays filePicker={props} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(onRequestSettled).not.toHaveBeenCalled();

    view.rerender(<WorkspaceFeatureOverlays filePicker={{
      ...props,
      files: {
        ...props.files,
        refreshReceipt: {
          epoch: 8, channelId: 'c0', deviceId: 'local-device', phase: 'settled', error: '本次刷新失败',
        },
      },
    }} />);
    await waitFor(() => expect(onRequestSettled).toHaveBeenCalledWith(null, 'picker-1'));
  });

  it('carries the selected channel template through the public governance command port', async () => {
    const submit = vi.fn().mockResolvedValue('create-request');
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0', parent_id: null }}
      initialTab="overview"
      port={{
        children: [],
        channelTemplates: [{ id: 'team', name: 'Team' }],
        commands: { submit, refresh },
      }}
      onClose={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('combobox', { name: '频道模板' }));
    fireEvent.click(screen.getByRole('option', { name: 'Team' }));
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel',
      action: 'create_child',
      payload: {
        name: 'research',
        purpose: '',
        templateId: 'team',
        parentId: 'c0',
      },
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('directory'));
  });

  it('uses the stable template id and canonical parent id, never display names, for child creation', async () => {
    const submit = vi.fn().mockResolvedValue('create-request-parent-id');
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ChannelAdministrationPanel
      channel={{ id: 'channel:parent-7', qualified_name: '研究父频道' }}
      initialTab="overview"
      port={{
        children: [],
        channelTemplates: [{ id: 'registrar:team-v2', name: 'Team 模板（显示名）' }],
        commands: { submit, refresh },
      }}
      onClose={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'child-room' } });
    fireEvent.click(screen.getByRole('combobox', { name: '频道模板' }));
    fireEvent.click(screen.getByRole('option', { name: 'Team 模板（显示名）' }));
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel',
      action: 'create_child',
      payload: {
        name: 'child-room',
        purpose: '',
        templateId: 'registrar:team-v2',
        parentId: 'channel:parent-7',
      },
    }));
    const payload = submit.mock.calls[0][0].payload;
    expect(payload.parentName).toBeUndefined();
    expect(payload.templateName).toBeUndefined();
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('directory'));
  });
});
