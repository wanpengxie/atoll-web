// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceFeatureOverlays } from '../src/ui/features/WorkspaceFeatures.jsx';

afterEach(cleanup);

describe('Workspace Files → Composer picker port', () => {
  it('uses the Files projection and returns the selected resource without a second store', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onClose = vi.fn();
    const entry = {
      key: 'resource:c0:readme',
      kind: 'file',
      name: 'README.md',
      resourceId: 'daemon://local-device/c0/README.md',
      mediaType: 'text/markdown',
      size: 12,
    };
    render(<div><button type="button" data-testid="outside">outside</button><WorkspaceFeatureOverlays filePicker={{
      open: true,
      channel: { id: 'c0', qualified_name: 'c0' },
      files: {
        deviceId: 'local-device',
        devices: [{ id: 'local-device', name: 'local-device' }],
        entries: [entry],
        commands: {},
      },
      onChoose,
      onClose,
    }} /></div>);

    const dialog = screen.getByRole('dialog', { name: '从频道文件选择' });
    const close = screen.getByRole('button', { name: '关闭频道文件选择' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(screen.getByTestId('outside').getAttribute('aria-hidden')).toBe('true');
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.click(screen.getByRole('button', { name: /README\.md/ }));
    expect(onChoose).toHaveBeenCalledWith(entry);
    await user.click(screen.getByRole('button', { name: '关闭频道文件选择' }));
    expect(onClose).toHaveBeenCalled();
    expect(dialog).toBeTruthy();
  });

  it('settles the caller when the current refresh receipt reports an error while keeping the error dialog visible', async () => {
    const onRequestSettled = vi.fn();
    const refresh = vi.fn(() => Promise.resolve());
    const baseFiles = {
      deviceId: 'local-device',
      refreshReceipt: {
        epoch: 3, channelId: 'c0', deviceId: 'local-device', directory: '', phase: 'pending', error: '',
      },
      // An older global error is still present, but must not settle this
      // request before its own receipt arrives.
      error: '旧请求失败',
      commands: { refresh },
    };
    const { rerender } = render(<WorkspaceFeatureOverlays filePicker={{
      open: true,
      channel: { id: 'c0', qualified_name: 'c0' },
      files: baseFiles,
      onRequestSettled,
      onClose: vi.fn(),
    }} />);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(onRequestSettled).not.toHaveBeenCalled();
    rerender(<WorkspaceFeatureOverlays filePicker={{
      open: true,
      channel: { id: 'c0', qualified_name: 'c0' },
      files: {
        ...baseFiles,
        refreshReceipt: {
          epoch: 4, channelId: 'c0', deviceId: 'local-device', directory: '', phase: 'settled', error: '目录读取失败',
        },
      },
      onRequestSettled,
      onClose: vi.fn(),
    }} />);

    await waitFor(() => expect(onRequestSettled).toHaveBeenCalledWith(null, undefined));
    expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('目录读取失败');
  });

  it('settles a refresh rejection against the current picker request', async () => {
    const onRequestSettled = vi.fn();
    render(<WorkspaceFeatureOverlays filePicker={{
      open: true,
      requestId: 7,
      channel: { id: 'c0', qualified_name: 'c0' },
      files: {
        deviceId: 'local-device',
        commands: { refresh: vi.fn().mockRejectedValue(new Error('refresh failed')) },
      },
      onRequestSettled,
      onClose: vi.fn(),
    }} />);

    await waitFor(() => expect(onRequestSettled).toHaveBeenCalledWith(null, 7));
    expect(screen.getByRole('dialog', { name: '从频道文件选择' })).toBeTruthy();
  });
});
